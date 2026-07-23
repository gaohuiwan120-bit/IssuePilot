export function validateUser(user) {
  if (!user || typeof user !== "object") return { ok: false, error: "INVALID" };
  // BUG: empty string is treated as present
  if (user.email === undefined || user.email === null) return { ok: false, error: "EMAIL_REQUIRED" };
  return { ok: true };
}
