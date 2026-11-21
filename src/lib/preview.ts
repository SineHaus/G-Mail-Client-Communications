// Preview deployments (one per pull request) sign in through the live dashboard, because Google only
// returns sign-ins to the live dashboard's address. The live dashboard signs the person in with Google,
// then hands them back to the preview with a one-minute pass that only that preview accepts.
// Pure module except for the HMAC (Web Crypto), so it works in route handlers. Tested in preview.test.ts.

export const isPreview = () => process.env.VERCEL_ENV === "preview";

/** This preview's own address (its branch address, which stays the same across pushes). */
export function previewOrigin(): string | null {
  const host = process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL;
  return host ? `https://${host}` : null;
}

/** The live dashboard's address, as Vercel gives it to every deployment. */
export function liveOrigin(): string | null {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return host ? `https://${host}` : null;
}

/**
 * Whether `origin` is a preview of this same Vercel project. The live dashboard's own Vercel address
 * looks like <project>-<hash>-<team>.vercel.app and its previews like <project>-git-<branch>-<team>.vercel.app.
 */
export function isOwnPreview(origin: string, liveVercelHost: string | undefined): boolean {
  const m = /^(.+)-[a-z0-9]{7,12}-([a-z0-9-]+)\.vercel\.app$/.exec(liveVercelHost ?? "");
  if (!m) return false;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.port || u.pathname !== "/" || u.search || u.hash || u.username) return false;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${esc(m[1])}-git-[a-z0-9-]+-${esc(m[2])}\\.vercel\\.app$`).test(u.hostname);
}

// ---------- The pass (signed with SESSION_SECRET, which the preview shares with the live dashboard) ----------

const PASS_SECONDS = 60;

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): string {
  return atob(s.replace(/-/g, "+").replace(/_/g, "/"));
}

async function sign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`preview-pass:${data}`))));
}

/** A pass for `email` to sign in to the preview at `origin`, good for one minute. */
export async function makePreviewPass(email: string, origin: string, secret: string, now = Date.now()): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ email, aud: origin, exp: Math.floor(now / 1000) + PASS_SECONDS })));
  return `${payload}.${await sign(payload, secret)}`;
}

/** The email on a pass, if it's genuine, unexpired and made for this preview (`origin`). */
export async function readPreviewPass(pass: string, origin: string, secret: string, now = Date.now()): Promise<string | null> {
  const [payload, sig] = pass.split(".");
  if (!payload || !sig) return null;
  const expected = await sign(payload, secret);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff) return null;
  try {
    const p = JSON.parse(fromB64url(payload)) as { email?: string; aud?: string; exp?: number };
    if (p.aud !== origin || typeof p.exp !== "number" || p.exp < Math.floor(now / 1000) || typeof p.email !== "string") return null;
    return p.email;
  } catch {
    return null;
  }
}
