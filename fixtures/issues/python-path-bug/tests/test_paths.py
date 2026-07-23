from app.paths import resolve_data_path

def test_resolve_joins():
    p = resolve_data_path("/data", "a.txt").replace("\\", "/")
    assert "/data/" in p or p.endswith("data/a.txt")
