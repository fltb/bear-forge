"""Visible Bear Forge observations adapted to the pinned upstream DouZero learner.

The upstream Python game Env is never constructed or stepped here. Models,
optimizers and learn() come from DouZero; only feature/trajectory adaptation lives
in this module. See pyproject.toml and uv.lock for the upstream source pin.
"""
from collections import Counter
from types import SimpleNamespace
import threading
from time import perf_counter

import numpy as np
import torch
from douzero.dmc.dmc import learn
from douzero.dmc.models import Model
from douzero.dmc.utils import create_optimizers
from douzero.env.env import get_obs, _cards2array

ROLES = ("landlord", "landlord_down", "landlord_up")
PATTERNS = ("single", "pair", "triple", "tripleSingle", "triplePair", "straight",
            "pairs", "airplane", "airplaneSingle", "airplanePair", "fourSingles",
            "fourPairs", "bomb", "rocket")
ENCODER = "bear-competitive-2016-douzero-v1"
ACTION_EXTRA = len(PATTERNS) + 2
STATE_EXTRA = 5 + 54 + ACTION_EXTRA
DECK = [rank for rank in range(3, 16) for _ in range(4)] + [16, 17]


def cards(values):
    if any(not isinstance(rank, int) or rank < 3 or rank > 17 for rank in values):
        raise ValueError("Invalid visible card rank")
    return [{15: 17, 16: 20, 17: 30}.get(rank, rank) for rank in values]


def pattern_features(action):
    vector = np.zeros(ACTION_EXTRA, dtype=np.float32)
    if action["kind"] == "pass":
        return vector
    if action["kind"] != "play":
        raise ValueError("The upstream learner only trains the playing phase")
    pattern = action["pattern"]
    vector[PATTERNS.index(pattern["kind"])] = 1
    vector[-2:] = [pattern["high"] / 17, pattern["length"] / 12]
    return vector


def encode(visible, actions):
    """No seed, audit records or complete state are accepted as model features."""
    observation = visible["observation"]
    if observation["phase"] != "playing" or not actions:
        raise ValueError("Expected a playing observation and exact candidates")
    landlord = int(observation["landlord"])
    seats = {str((landlord + offset) % 3): role for offset, role in enumerate(ROLES)}
    role = seats[observation["actor"]]
    played = {position: [] for position in ROLES}
    last = {position: [] for position in ROLES}
    sequence = []
    bombs = 0
    # A redeal starts a new public play history; never import earlier hands.
    events = visible["events"]
    start = max((i for i, event in enumerate(events) if event["type"] == "deal"), default=-1)
    for event in events[start + 1:]:
        if event["type"] not in ("play", "pass"):
            continue
        position = seats[event["actor"]]
        move = event["play"]["cards"] if event["type"] == "play" else []
        converted = cards(move)
        played[position].extend(converted)
        last[position] = converted
        sequence.append(converted)
        if event["type"] == "play" and event["play"]["pattern"]["kind"] in ("bomb", "rocket"):
            bombs += 1
    hand = cards(observation["hand"])
    remaining = Counter(cards(DECK))
    remaining.subtract(hand)
    for moves in played.values():
        remaining.subtract(moves)
    if any(count < 0 for count in remaining.values()):
        raise ValueError("Visible cards exceed the deck")
    # This is the inferable union of opponents' cards, never either private hand.
    other = sorted(remaining.elements())
    counts = {seats[seat]: count for seat, count in observation["counts"].items()}
    if len(other) != sum(count for position, count in counts.items() if position != role):
        raise ValueError("Visible counts disagree with public play history")
    current = observation["last"]["play"] if observation["last"] else {"kind": "pass"}
    legal = [cards(action["cards"]) if action["kind"] == "play" else [] for action in actions]
    raw = get_obs(SimpleNamespace(player_position=role, player_hand_cards=hand,
        other_hand_cards=other, last_move=cards(current.get("cards", [])),
        played_cards=played, last_move_dict=last, num_cards_left_dict=counts,
        bomb_num=bombs, card_play_action_seq=sequence, legal_actions=legal))
    doubles = observation["doubles"]
    if doubles is None or observation["bottom"] is None:
        raise ValueError("Playing must follow the public reveal")
    public = np.concatenate((np.asarray([observation["highBid"] / 3,
        *[float(bool(doubles[str((landlord + offset) % 3)])) for offset in range(3)],
        float(observation["redoubled"])], dtype=np.float32),
        _cards2array(cards(observation["bottom"])), pattern_features(current)))
    # The landlord's own double is null in this game's rules, equivalent to no double.
    no_action = np.concatenate((raw["x_no_action"], public)).astype(np.float32)
    action_rows = np.stack([np.concatenate((_cards2array(move), pattern_features(action)))
                            for move, action in zip(legal, actions)]).astype(np.float32)
    return role, no_action, raw["z"].astype(np.float32), action_rows


def create_learner(seed=7, threads=2, extended=True):
    torch.set_num_threads(threads)
    torch.manual_seed(seed)
    np.random.seed(seed)
    model = Model(device="cpu")
    for network in model.get_models().values() if extended else ():
        # Preserve the upstream LSTM/MLP architecture, adding our rule features.
        network.dense1 = torch.nn.Linear(network.dense1.in_features + STATE_EXTRA + ACTION_EXTRA, 512)
    flags = SimpleNamespace(training_device="cpu", learning_rate=1e-4, momentum=0,
                            epsilon=1e-5, alpha=0.99, max_grad_norm=40)
    optimizers = create_optimizers(flags, model)
    return model, optimizers, flags


def score(model, visible, actions, chunk_size=256, metrics=None):
    started = perf_counter()
    role, no_action, history, candidates = encode(visible, actions)
    encoded = perf_counter()
    values = []
    network = model.get_model(role)
    if network.dense1.in_features in (501, 612):
        no_action = no_action[:-STATE_EXTRA]
        candidates = candidates[:, :54]
    network.eval()
    with torch.inference_mode():
        for start in range(0, len(actions), chunk_size):
            chunk = candidates[start:start + chunk_size]
            x = np.concatenate((np.repeat(no_action[None, :], len(chunk), axis=0), chunk), axis=1)
            z = np.repeat(history[None, :, :], len(chunk), axis=0)
            values.extend(network(torch.from_numpy(z), torch.from_numpy(x), return_value=True)["values"].flatten().tolist())
    if not np.isfinite(values).all():
        raise ValueError("Non-finite model scores")
    if metrics is not None:
        metrics["encodeMilliseconds"] += (encoded - started) * 1000
        metrics["inferenceMilliseconds"] += (perf_counter() - encoded) * 1000
    return values


def import_pretrained(model, directory, extended=True):
    """Strictly load all roles; insert new columns without shifting old features."""
    from pathlib import Path
    states = {}
    for role in ROLES:
        state = torch.load(Path(directory) / (role + ".ckpt"), map_location="cpu", weights_only=True)
        reference = Model(device="cpu").get_model(role).state_dict()
        if set(state) != set(reference) or any(state[key].shape != value.shape
                or not torch.isfinite(state[key]).all() for key, value in reference.items()):
            raise ValueError("Invalid pretrained parameters for " + role)
        if extended:
            original = state["dense1.weight"]
            split = original.shape[1] - 54
            expanded = torch.zeros_like(model.get_model(role).dense1.weight)
            expanded[:, :split] = original[:, :split]
            expanded[:, split + STATE_EXTRA:split + STATE_EXTRA + 54] = original[:, split:]
            state["dense1.weight"] = expanded
        states[role] = state
    for role, state in states.items():
        model.get_model(role).load_state_dict(state, strict=True)


def encode_episode(rows):
    grouped = {role: [] for role in ROLES}
    for row in rows:
        reward = row["return"]
        if reward not in (-1, 1):
            raise ValueError("Expected terminal team win/loss return")
        role, x, z, actions = encode(row["observation"], [row["action"]])
        grouped[role].append((torch.from_numpy(x), torch.from_numpy(z),
                              torch.from_numpy(actions[0]), reward, False))
    for samples in grouped.values():
        if samples:
            *features, _ = samples[-1]
            samples[-1] = (*features, True)
    return grouped


def update_encoded(model, optimizers, flags, role, samples):
    x, z, actions, returns, done = zip(*samples)
    batch = {"obs_x_no_action": torch.stack(x)[:, None, :],
             "obs_z": torch.stack(z)[:, None, :, :],
             "obs_action": torch.stack(actions)[:, None, :],
             "target": torch.tensor(returns, dtype=torch.float32)[:, None],
             "episode_return": torch.tensor(returns, dtype=torch.float32)[:, None],
             "done": torch.tensor(done, dtype=torch.bool)[:, None]}
    model.get_model(role).train()
    stats = learn(role, {}, model.get_model(role), batch, optimizers[role], flags, threading.Lock())
    # Upstream's logging mean is undefined for a chunk with no actual episode end.
    # Keep true done flags; do not manufacture an episode boundary for this metric.
    return {key: value if np.isfinite(value) else None for key, value in stats.items()}


def update_episode(model, optimizers, flags, rows, metrics=None):
    """Compatibility helper; production queues encoded episodes across games."""
    started = perf_counter()
    grouped = encode_episode(rows)
    encoded = perf_counter()
    stats = {role: update_encoded(model, optimizers, flags, role, samples)
             for role, samples in grouped.items() if samples}
    if metrics is not None:
        metrics["encodeMilliseconds"] += (encoded - started) * 1000
        metrics["updateMilliseconds"] += (perf_counter() - encoded) * 1000
    return stats
