from app.parse import parse_int

def test_parse_bad():
    assert parse_int("abc") is None

def test_parse_ok():
    assert parse_int("3") == 3
