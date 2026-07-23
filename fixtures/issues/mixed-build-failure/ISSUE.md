# TypeScript build fails on bad type

## Description
`src/math.ts` / `src/math.js` `add` returns wrong type.

## Actual Behavior
tests fail and build exits non-zero

## Expected Behavior
add(1,2)===3 and build succeeds

## Steps to Reproduce
1. node test/math.test.js
2. npm run build
