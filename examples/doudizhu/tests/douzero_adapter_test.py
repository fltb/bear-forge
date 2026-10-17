import copy
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "training"))
import numpy as np
import torch
from douzero_adapter import encode_episode, DECK, ROLES, STATE_EXTRA, ACTION_EXTRA, encode, learn, pattern_features, create_learner, import_pretrained, score
from douzero_service import LearnerService


def visible(seat="0"):
    hands = {"0": DECK[:20], "1": DECK[20:37], "2": DECK[37:]}
    return {"observation": {"phase": "playing", "actor": seat, "landlord": "0",
        "hand": hands[seat], "counts": {"0": 20, "1": 17, "2": 17}, "last": None,
        "highBid": 1, "doubles": {"0": None, "1": False, "2": False},
        "redoubled": False, "bottom": DECK[17:20]}, "events": [{"type": "deal", "deal": 1}]}


def single(observation):
    rank = observation["observation"]["hand"][0]
    return {"kind": "play", "cards": [rank], "pattern": {"kind": "single", "high": rank, "length": 1}}


class AdapterTests(unittest.TestCase):
    def test_roles_visible_features_and_interpretations(self):
        for seat, role in zip(("0", "1", "2"), ROLES):
            observation = visible(seat)
            encoded = encode(observation, [single(observation)])
            self.assertEqual(encoded[0], role)
            self.assertTrue(all(np.isfinite(value).all() for value in encoded[1:]))
            poisoned = copy.deepcopy(observation)
            poisoned["state"] = {"hands": "must never be read", "seed": 999}
            for a, b in zip(encoded[1:], encode(poisoned, [single(poisoned)])[1:]):
                np.testing.assert_array_equal(a, b)
        action = single(visible())
        changed = copy.deepcopy(action)
        changed["pattern"]["length"] = 2
        self.assertFalse(np.array_equal(pattern_features(action), pattern_features(changed)))
        invalid = visible()
        invalid["observation"]["counts"]["1"] = 16
        with self.assertRaisesRegex(ValueError, "counts"):
            encode(invalid, [single(invalid)])

    def test_upstream_update_checkpoint_and_resume(self):
        self.assertEqual(learn.__module__, "douzero.dmc.dmc")
        service = LearnerService()
        service.dispatch({"command": "configure", "batchSamples": 1})
        rows = [{"observation": visible(seat), "action": single(visible(seat)), "return": 1 if seat == "0" else -1}
                for seat in ("0", "1", "2")]
        before = {role: service.model.get_model(role).dense6.weight.detach().clone() for role in ROLES}
        updated = service.dispatch({"command": "learn", "version": service.version, "rows": rows})
        for role in ROLES:
            self.assertEqual(updated["updates"][role], 1)
            self.assertFalse(torch.equal(before[role], service.model.get_model(role).dense6.weight))
            self.assertTrue(np.isfinite(list(updated["stats"][role].values())).all())
        query = {"command": "score", "observation": visible(), "actions": [single(visible())]}
        scores = service.dispatch(query)
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "model.pt")
            service.dispatch({"command": "save", "path": path, "metadata": {"nextSeed": 8}})
            restored = LearnerService(900)
            loaded = restored.dispatch({"command": "load", "path": path})
            self.assertEqual(loaded["metadata"], {"nextSeed": 8})
            self.assertEqual(restored.dispatch(query), scores)
            for learner in (service, restored):
                learner.dispatch({"command": "learn", "version": learner.version, "rows": rows})
            for role in ROLES:
                self.assertEqual(restored.updates[role], 2)
                for key, value in service.model.get_model(role).state_dict().items():
                    self.assertTrue(torch.equal(value, restored.model.get_model(role).state_dict()[key]))

    def test_pretrained_column_mapping_preserves_all_role_scores_and_rejects_bad_weights(self):
        original, _, _ = create_learner(extended=False)
        extended, _, _ = create_learner(seed=99)
        with tempfile.TemporaryDirectory() as directory:
            for role in ROLES:
                torch.save(original.get_model(role).state_dict(), Path(directory) / (role + ".ckpt"))
            import_pretrained(extended, directory)
            for seat, role in zip(("0", "1", "2"), ROLES):
                observation = visible(seat)
                actions = [single(observation), {"kind": "pass"}]
                np.testing.assert_allclose(score(original, observation, actions), score(extended, observation, actions), atol=1e-6, rtol=1e-5)
                network = extended.get_model(role)
                split = original.get_model(role).dense1.in_features - 54
                self.assertEqual(torch.count_nonzero(network.dense1.weight[:, split:split + STATE_EXTRA]).item(), 0)
                self.assertEqual(torch.count_nonzero(network.dense1.weight[:, -ACTION_EXTRA:]).item(), 0)
            state = original.get_model("landlord").state_dict()
            del state["dense6.bias"]
            torch.save(state, Path(directory) / "landlord.ckpt")
            with self.assertRaisesRegex(ValueError, "Invalid pretrained"):
                import_pretrained(extended, directory)

    def test_episode_end_labels_are_not_replaced_with_batch_boundaries(self):
        observation = visible()
        rows = [{"observation": observation, "action": single(observation), "return": 1} for _ in range(2)]
        first = encode_episode(rows)["landlord"]
        second = encode_episode(rows)["landlord"]
        batch, tail = (first + second)[:3], (first + second)[3:]
        self.assertEqual([sample[-1] for sample in batch], [False, True, False])
        self.assertEqual([sample[-1] for sample in tail], [True])


    def test_legacy_checkpoint_counts_are_preserved_separately(self):
        service = LearnerService()
        service.dispatch({"command": "configure", "batchSamples": 1})
        rows = [{"observation": visible(), "action": single(visible()), "return": 1}]
        service.dispatch({"command": "learn", "version": service.version, "rows": rows})
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "model.pt")
            service.dispatch({"command": "save", "path": path, "metadata": {}})
            state = torch.load(path, weights_only=True)
            for key in ("learnedSamples", "legacyLearnedSamples", "pending", "pendingSamples", "batchSamples", "modelKind", "pretrained"):
                state.pop(key, None)
            torch.save(state, path)
            restored = LearnerService()
            restored.dispatch({"command": "load", "path": path})
            self.assertEqual(restored.samples, 1)
            self.assertEqual(restored.legacy_learned_samples, 1)
            restored.dispatch({"command": "configure", "batchSamples": 1})
            restored.dispatch({"command": "learn", "version": restored.version, "rows": rows})
            self.assertEqual(restored.samples, 2)
            self.assertEqual(sum(restored.learned_samples.values()) + restored.legacy_learned_samples, 2)


    def test_cross_episode_batch_tail_survives_restore_without_fake_done_or_dropped_rows(self):
        service = LearnerService()
        service.dispatch({"command": "configure", "batchSamples": 3})
        rows = [{"observation": visible(seat), "action": single(visible(seat)), "return": 1 if seat == "0" else -1}
                for seat in ("0", "1", "2")]
        for _ in range(2):
            service.dispatch({"command": "learn", "version": service.version, "rows": rows})
        self.assertEqual(service.samples, 6)
        self.assertEqual(list(service.updates.values()), [0, 0, 0])
        self.assertEqual([len(service.pending[r]) for r in ROLES], [2, 2, 2])
        self.assertTrue(all(sample[-1] for samples in service.pending.values() for sample in samples))
        with self.assertRaisesRegex(ValueError, "queued"):
            service.dispatch({"command": "configure", "batchSamples": 2})
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "model.pt")
            service.dispatch({"command": "save", "path": path, "metadata": {"nextSeed": 9}})
            restored = LearnerService(123)
            restored.dispatch({"command": "load", "path": path})
            for learner in (service, restored):
                learner.dispatch({"command": "learn", "version": learner.version, "rows": rows})
                self.assertEqual(learner.samples, 9)
                self.assertEqual(list(learner.updates.values()), [1, 1, 1])
                self.assertEqual(list(learner.learned_samples.values()), [3, 3, 3])
                self.assertFalse(any(learner.pending.values()))
            for role in ROLES:
                for key, value in service.model.get_model(role).state_dict().items():
                    self.assertTrue(torch.equal(value, restored.model.get_model(role).state_dict()[key]))
            with self.assertRaisesRegex(ValueError, "version"):
                restored.dispatch({"command": "learn", "version": "stale", "rows": rows})


if __name__ == "__main__":
    unittest.main()
