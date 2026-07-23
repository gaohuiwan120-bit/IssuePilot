import { validateUser } from "../src/validate.js";
const r = validateUser({ email: "" });
if (r.ok !== false || r.error !== "EMAIL_REQUIRED") {
  console.error("FAIL validateUser empty email");
  process.exit(1);
}
console.log("PASS validateUser");
