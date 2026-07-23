export function validateUser(user) {
  if (!user || typeof user !== "object") return { ok: false, error: "INVALID" };
  if (!user.email || String(user.email).trim() === "") return { ok: false, error: "EMAIL_REQUIRED" };
  return { ok: true };
}
