import { request } from "node:http";
const req = request({ host: "example.com", path: "/", method: "GET", timeout: 3000 }, (res) => {
  console.log("NETWORK_OK", res.statusCode);
  process.exit(0);
});
req.on("error", (e) => {
  console.error("NETWORK_BLOCKED", e.code || e.message);
  process.exit(1);
});
req.end();
