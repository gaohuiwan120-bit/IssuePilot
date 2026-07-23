import { writeFileSync } from "node:fs";
try {
  writeFileSync("/workspace/should-not-write.txt", "nope");
  console.log("WRITE_OK");
  process.exit(0);
} catch (e) {
  console.error("WRITE_BLOCKED");
  process.exit(1);
}
