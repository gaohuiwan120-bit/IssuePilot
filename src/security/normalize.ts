/**
 * Normalize shell-ish command strings to reduce trivial bypasses
 * (extra whitespace, case, simple wrapper forms).
 */
export function normalizeCommand(raw: string): string {
  let s = String(raw ?? "");
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  // Strip common wrappers: bash -lc '...', sh -c "...", powershell -Command ...
  s = s.replace(/^((?:\/usr\/bin\/)?(?:bash|sh|zsh))\s+(-lc?|-c)\s+/i, "");
  s = s.replace(/^powershell(?:\.exe)?\s+(-NoProfile\s+)?-Command\s+/i, "");
  s = s.replace(/^cmd(?:\.exe)?\s+\/[cCkK]\s+/i, "");
  // Unwrap surrounding quotes once
  if (
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith('"') && s.endsWith('"'))
  ) {
    s = s.slice(1, -1);
  }
  s = s.replace(/\\\n/g, " ");
  s = s.replace(/[ \t\f\v]+/g, " ").trim();
  return s.toLowerCase();
}

export function collapseWhitespace(raw: string): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}
