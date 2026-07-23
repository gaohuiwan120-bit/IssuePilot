import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.paths import resolve_data_path

p = resolve_data_path("/data", "a.txt").replace("\\", "/")
if "/data/" not in p and not p.endswith("data/a.txt"):
    print("FAIL resolve_data_path")
    raise SystemExit(1)
print("PASS resolve_data_path")
