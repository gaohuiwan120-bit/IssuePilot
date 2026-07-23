import { loadConfig } from "../src/config.js";
let threw = false;
try {
  loadConfig("config/app.json");
} catch (e) {
  threw = e.message === "CONFIG_MISSING";
}
if (!threw) {
  console.error("FAIL config missing maxRetries");
  process.exit(1);
}
console.log("PASS config");
