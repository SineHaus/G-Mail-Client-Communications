/**
 * Cleans the ANTHROPIC_API_KEY value as pasted into Vercel, and describes it safely when Anthropic refuses it.
 * Never returns or logs the key itself: the hint shows only its start type, last 4 characters and length.
 */

/** Strips what a paste often adds: quotes, a `NAME=` prefix, spaces and line breaks. Keys contain none of these. */
export function cleanApiKey(raw: string | undefined | null): string | undefined {
  let v = (raw ?? "").trim();
  v = v.replace(/^(export\s+)?ANTHROPIC_API_KEY\s*=\s*/i, "");
  for (let i = 0; i < 3; i++) {
    const m = v.match(/^(["'`“”‘’])([\s\S]*)(["'`“”‘’])$/);
    if (!m) break;
    v = m[2].trim();
  }
  v = v.replace(/\s+/g, "");
  return v || undefined;
}

/** Plain words for a refused key, safe to show on the dashboard (no secret). */
export function describeRefusedKey(raw: string | undefined | null): string {
  const key = cleanApiKey(raw);
  if (!key) return "No ANTHROPIC_API_KEY is set for this deployment. Add it in Vercel → Settings → Environment Variables (tick Production), then redeploy.";
  const tail = key.length > 8 ? key.slice(-4) : "";
  const which = tail ? `The key ending in ${tail} (${key.length} characters)` : `The key (${key.length} characters)`;
  let why = "";
  if (/^sk-ant-admin/i.test(key)) why = " It's an Admin key, which can't write drafts; make a regular API key instead.";
  else if (!/^sk-ant-/i.test(key)) why = " It doesn't start with sk-ant-, so it may be incomplete or not an Anthropic API key.";
  return `${which} was refused by Anthropic.${why} Check that the same key is active in the Anthropic Console and saved as ANTHROPIC_API_KEY in Vercel, then redeploy.`;
}
