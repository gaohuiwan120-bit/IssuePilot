# Missing config key maxRetries

## Description
`loadConfig` in `src/config.js` does not require maxRetries.

## Actual Behavior
Returns config without maxRetries

## Expected Behavior
Throws CONFIG_MISSING when maxRetries absent

## Steps to Reproduce
1. node test/config.test.js

## Acceptance Criteria
- missing maxRetries throws CONFIG_MISSING
