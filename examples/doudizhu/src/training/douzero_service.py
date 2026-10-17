"""Line-delimited local process interface to the existing DouZero learner."""
import json
import os
from pathlib import Path
import sys
import tempfile
import uuid
import resource
from time import perf_counter
import signal
from collections import Counter

import numpy as np
import torch

from douzero_adapter import ENCODER, ROLES, create_learner, score, import_pretrained, encode_episode, update_encoded

UPSTREAM = "718a5c920bf3361e34178a38f3b80458e176b351"


class LearnerService:
    def __init__(self, seed=7):
        self.model, self.optimizers, self.flags = create_learner(seed)
        self.version = str(uuid.uuid4())
        self.updates = {role: 0 for role in ROLES}
        self.samples = 0
        self.legacy_learned_samples = 0
        self.learned_samples = {role: 0 for role in ROLES}
        self.pending = {role: [] for role in ROLES}
        self.batch_samples = 3200
        self.model_kind = "extended"
        self.pretrained = None
        self.metrics = {"encodeMilliseconds": 0, "inferenceMilliseconds": 0, "updateMilliseconds": 0}
        self.candidates = Counter()
        self.ambiguous_requests = 0
        self.ambiguous_extras = 0

    def status(self):
        total = sum(self.candidates.values())
        def percentile(fraction):
            seen = 0
            for size, count in sorted(self.candidates.items()):
                seen += count
                if seen >= total * fraction:
                    return size
            return None
        return {"version": self.version, "updates": self.updates,
                "samples": self.samples, "learnedSamples": self.learned_samples,
                "legacyLearnedSamples": self.legacy_learned_samples,
                "pendingSamples": {role: len(rows) for role, rows in self.pending.items()},
                "batchSamples": self.batch_samples, "modelKind": self.model_kind,
                "pretrained": self.pretrained, "encoder": ENCODER, "upstream": UPSTREAM,
                "metrics": {**self.metrics, "inferenceRequests": total,
                    "ambiguousRequests": self.ambiguous_requests, "ambiguousCandidateExtras": self.ambiguous_extras,
                    "candidateP50": percentile(.5), "candidateP95": percentile(.95),
                    "candidateMax": max(self.candidates, default=0),
                    "peakRssBytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if sys.platform == "darwin" else 1024)}}

    def dispatch(self, message):
        command = message["command"]
        if command == "status":
            return self.status()
        if command == "score":
            values = score(self.model, message["observation"], message["actions"], metrics=self.metrics)
            self.candidates[len(message["actions"])] += 1
            duplicates = len(message["actions"]) - len({tuple(sorted(action.get("cards", []))) for action in message["actions"]})
            self.ambiguous_requests += int(duplicates > 0)
            self.ambiguous_extras += duplicates
            return {"index": int(np.argmax(values)), "version": self.version,
                    "encoder": ENCODER, "values": values}
        if command == "configure":
            size = message["batchSamples"]
            if not isinstance(size, int) or isinstance(size, bool) or not 1 <= size <= 10000:
                raise ValueError("Invalid batch sample count")
            if any(self.pending.values()) and size != self.batch_samples:
                raise ValueError("Cannot change batch size with queued samples")
            self.batch_samples = size
            return self.status()
        if command == "import-pretrained":
            if self.samples or any(self.pending.values()) or any(self.updates.values()):
                raise ValueError("Cannot replace an existing training state")
            kind = message.get("mode", "extended")
            if kind not in ("original", "extended"):
                raise ValueError("Invalid pretrained mode")
            model, optimizers, flags = create_learner(extended=kind == "extended")
            import_pretrained(model, message["directory"], extended=kind == "extended")
            self.model, self.optimizers, self.flags = model, optimizers, flags
            self.model_kind = kind
            provenance = Path(message["directory"]) / "provenance.json"
            self.pretrained = json.loads(provenance.read_text()) if provenance.exists() else {"source": "local-unverified"}
            self.version = str(uuid.uuid4())
            return self.status()
        if command == "learn":
            if self.model_kind != "extended":
                raise ValueError("Original baseline is frozen; initialize an extended learner")
            if message["version"] != self.version:
                raise ValueError("Episode policy version does not match the frozen model")
            rows = message["rows"]
            if not rows or len(rows) > 10000:
                raise ValueError("Expected one bounded, completed episode")
            started = perf_counter()
            grouped = encode_episode(rows)
            self.metrics["encodeMilliseconds"] += (perf_counter() - started) * 1000
            stats = {}
            for role, samples in grouped.items():
                self.pending[role].extend(samples)
                while len(self.pending[role]) >= self.batch_samples:
                    started = perf_counter()
                    batch = self.pending[role][:self.batch_samples]
                    stats[role] = update_encoded(self.model, self.optimizers, self.flags, role, batch)
                    del self.pending[role][:self.batch_samples]
                    self.updates[role] += 1
                    self.learned_samples[role] += len(batch)
                    self.metrics["updateMilliseconds"] += (perf_counter() - started) * 1000
            self.samples += len(rows)
            if stats:
                self.version = str(uuid.uuid4())
            return {**self.status(), "stats": stats}
        if command == "save":
            target = Path(message["path"])
            target.parent.mkdir(parents=True, exist_ok=True)
            numpy_state = np.random.get_state()
            state = {"format": 1, **self.status(), "torch_version": str(torch.__version__),
                     "models": {role: self.model.get_model(role).state_dict() for role in ROLES},
                     "optimizers": {role: self.optimizers[role].state_dict() for role in ROLES},
                     "torch_rng": torch.get_rng_state(),
                     "numpy_rng": [numpy_state[0], numpy_state[1].tolist(), *numpy_state[2:]],
                     "pending": self.pending,
                     "metadata": message["metadata"]}
            fd, temporary = tempfile.mkstemp(dir=target.parent, prefix=target.name + ".", suffix=".tmp")
            try:
                with os.fdopen(fd, "wb") as stream:
                    torch.save(state, stream)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, target)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
            return self.status()
        if command == "load":
            state = torch.load(message["path"], map_location="cpu", weights_only=True)
            if state["format"] != 1 or state["encoder"] != ENCODER or state["upstream"] != UPSTREAM:
                raise ValueError("Incompatible checkpoint")
            if state["torch_version"] != str(torch.__version__):
                raise ValueError("Checkpoint PyTorch version differs from the locked environment")
            kind = state.get("modelKind", "extended")
            self.model, self.optimizers, self.flags = create_learner(extended=kind == "extended")
            self.model_kind = kind
            self.batch_samples = state.get("batchSamples", 3200)
            self.pending = state.get("pending", {role: [] for role in ROLES})
            self.learned_samples = state.get("learnedSamples", {role: 0 for role in ROLES})
            self.legacy_learned_samples = state.get("legacyLearnedSamples", state["samples"] if "learnedSamples" not in state else 0)
            self.pretrained = state.get("pretrained")
            for role in ROLES:
                self.model.get_model(role).load_state_dict(state["models"][role])
                self.optimizers[role].load_state_dict(state["optimizers"][role])
            torch.set_rng_state(state["torch_rng"])
            rng = state["numpy_rng"]
            np.random.set_state((rng[0], np.asarray(rng[1], dtype=np.uint32), *rng[2:]))
            self.version, self.updates, self.samples = state["version"], state["updates"], state["samples"]
            return {**self.status(), "metadata": state["metadata"]}
        raise ValueError("Unknown learner command")


def main():
    # The TS owner handles Ctrl-C at a completed-game boundary and sends close.
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    service = LearnerService(int(sys.argv[1]) if len(sys.argv) > 1 else 7)
    for line in sys.stdin:
        message = None
        try:
            message = json.loads(line)
            if message["command"] == "close":
                print(json.dumps({"id": message["id"], "ok": True, "value": None}), flush=True)
                return
            result = service.dispatch(message)
            print(json.dumps({"id": message["id"], "ok": True, "value": result}, allow_nan=False), flush=True)
        except Exception as error:
            print(json.dumps({"id": message.get("id") if isinstance(message, dict) else None,
                              "ok": False, "error": str(error)}), flush=True)


if __name__ == "__main__":
    main()
