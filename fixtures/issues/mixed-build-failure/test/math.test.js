import { add } from "../src/math.js";
if (add(1, 2) !== 3) {
  console.error("FAIL add");
  process.exit(1);
}
console.log("PASS add");
