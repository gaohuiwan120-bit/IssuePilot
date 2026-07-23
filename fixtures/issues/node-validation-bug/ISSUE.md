# validateUser throws on empty email

## Description
`validateUser` in `src/validate.js` accepts empty email.

## Actual Behavior
Empty string returns ok:true

## Expected Behavior
Empty email should return ok:false with error EMAIL_REQUIRED

## Steps to Reproduce
1. Run node test/validate.test.js
2. Observe failure EMAIL_REQUIRED

## Acceptance Criteria
- Empty email rejected
- test/validate.test.js passes
