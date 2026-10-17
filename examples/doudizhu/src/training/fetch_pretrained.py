"""Fetch the publicly redistributed DouZero WP baseline at a pinned Git commit.

The original Google Drive URL in kwai/DouZero currently returns 404. These files
are the WP baseline redistributed by DouZero_API, not an authenticated copy of
that unavailable download. Code/source attribution: Apache-2.0 upstream repos.
"""
import json
import os
from pathlib import Path
import sys
from urllib.request import urlopen

from douzero_adapter import ROLES, create_learner, import_pretrained

COMMIT = "ca8c841552e08d602ad326d2c7450b683bf41226"
SOURCE = "https://github.com/pineoncellar/DouZero_API/tree/" + COMMIT + "/baselines/douzero_WP"


def fetch(directory):
    target = Path(directory)
    target.mkdir(parents=True, exist_ok=True)
    for role in ROLES:
        path = target / (role + ".ckpt")
        temporary = path.with_suffix(".download")
        try:
            url = "https://raw.githubusercontent.com/pineoncellar/DouZero_API/" + COMMIT + "/baselines/douzero_WP/" + path.name
            with urlopen(url, timeout=60) as source, temporary.open("wb") as output:
                while block := source.read(1048576):
                    output.write(block)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)
    model, _, _ = create_learner(extended=False)
    import_pretrained(model, target, extended=False)
    provenance = {"objective": "wp", "source": SOURCE, "commit": COMMIT,
                  "origin": "https://github.com/kwai/DouZero#evaluation",
                  "license": "https://github.com/pineoncellar/DouZero_API/blob/" + COMMIT + "/LICENSE",
                  "officialBytesVerified": False}
    (target / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    return provenance


if __name__ == "__main__":
    directory = sys.argv[1] if len(sys.argv) == 2 else None
    if not directory:
        raise SystemExit("Usage: fetch_pretrained.py DIRECTORY")
    print(json.dumps({"directory": str(Path(directory).resolve()), **fetch(directory)}))
