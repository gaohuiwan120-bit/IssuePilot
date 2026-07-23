import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.parse import parse_int

if parse_int("abc") is not None:
    print("FAIL parse_int bad input")
    raise SystemExit(1)
if parse_int("3") != 3:
    print("FAIL parse_int ok")
    raise SystemExit(1)
print("PASS parse_int")
