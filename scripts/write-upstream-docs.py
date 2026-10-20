from pathlib import Path
DOCS = Path(__file__).resolve().parent.parent / "docs" / "upstream"
DOCS.mkdir(parents=True, exist_ok=True)
files = {
extension-points.md: "#
