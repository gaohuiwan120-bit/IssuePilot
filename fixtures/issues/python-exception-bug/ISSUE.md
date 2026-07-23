# parse_int does not handle ValueError

## Description
`parse_int` in `app/parse.py` crashes on bad input.

## Actual Behavior
Traceback ValueError

## Expected Behavior
Returns None on invalid int

## Steps to Reproduce
1. python -m pytest -q

Stack Trace:
```
File "app/parse.py", line 2, in parse_int
    return int(text)
ValueError: invalid literal
```
