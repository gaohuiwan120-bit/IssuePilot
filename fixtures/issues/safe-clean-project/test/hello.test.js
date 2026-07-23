import { hello } from "../src/hello.js";
if (hello("x") !== "hello x") {
  console.error("FAIL");
  process.exit(1);
}
console.log("PASS");
