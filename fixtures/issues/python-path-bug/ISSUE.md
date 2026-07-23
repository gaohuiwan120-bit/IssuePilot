# resolve_data_path joins incorrectly

## Description
`resolve_data_path` in `app/paths.py` ignores base.

## Actual Behavior
Returns filename only

## Expected Behavior
Returns base/filename joined path

## Steps to Reproduce
1. python -m pytest -q

## Acceptance Criteria
- joined path includes base
