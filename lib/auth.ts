/**
 * Where to send the user after sign-in. Only same-site paths are allowed: a single leading slash that isn't
 * followed by another slash or a backslash ("//evil.com", "/\evil.com"), and the resolved URL must stay on our origin
 * (the URL parser drops tabs and newlines, so "/\t/evil.com" would otherwise turn into "//evil.com").
 */
export function safeNextPath(next: string | null | undefined, origin: string): string {
  if (!next || !/^\/(?![\/\\])/.test(next)) return "/";
  try {
    return new URL(next, origin).origin === origin ? next : "/";
  } catch {
    return "/";
  }
}
