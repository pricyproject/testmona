// Only honor a `next`/redirect target that is a same-origin, root-relative
// path. This blocks open-redirect attacks via crafted login links (e.g.
// `next=//evil.com`, `next=https://evil.com`, `next=javascript:...`) which
// could otherwise send a freshly-authenticated user to an attacker-controlled
// destination.
export const resolveSafeRedirect = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const value = raw.trim();
  if (!value.startsWith('/')) return null;        // must be root-relative
  if (value.startsWith('//') || value.startsWith('/\\')) return null; // protocol-relative
  // eslint-disable-next-line no-control-regex -- intentionally rejecting control chars
  if (value.includes('\\') || /[\x00-\x1f\x7f]/.test(value)) return null; // backslashes / control chars
  // Avoid bouncing back to the auth screens (which would loop or strip `next`).
  if (value === '/login' || value.startsWith('/login?') || value.startsWith('/login/')) return null;
  if (value === '/signup' || value.startsWith('/signup?') || value.startsWith('/signup/')) return null;
  return value;
};
