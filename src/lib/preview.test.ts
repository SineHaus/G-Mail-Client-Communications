// Preview sign-in: only this project's previews, and a pass works only where it was meant to. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { isOwnPreview, makePreviewPass, readPreviewPass } from "./preview.ts";

const LIVE = "client-communications-dashboard-a1b2c3d4e-terg3.vercel.app";
const SECRET = "x".repeat(40);
const PREVIEW = "https://client-communications-dashboard-git-claude-start-b-3cd703-terg3.vercel.app";

test("only previews of this project, on this team, count", () => {
  assert.equal(isOwnPreview(PREVIEW, LIVE), true);
  assert.equal(isOwnPreview("https://client-communications-dashboard-git-x-otherteam.vercel.app", LIVE), false);
  assert.equal(isOwnPreview("https://evil.example.com", LIVE), false);
  assert.equal(isOwnPreview(`${PREVIEW}/somewhere`, LIVE), false);
  assert.equal(isOwnPreview(PREVIEW.replace("https", "http"), LIVE), false);
  assert.equal(isOwnPreview(PREVIEW, undefined), false);
});

test("a pass signs in only on the preview it was made for, and only for a minute", async () => {
  const pass = await makePreviewPass("leo@x.com", PREVIEW, SECRET, 1_000_000);
  assert.equal(await readPreviewPass(pass, PREVIEW, SECRET, 1_000_000 + 30_000), "leo@x.com");
  assert.equal(await readPreviewPass(pass, PREVIEW, SECRET, 1_000_000 + 61_000), null);
  assert.equal(await readPreviewPass(pass, "https://other-preview.vercel.app", SECRET, 1_000_000), null);
  assert.equal(await readPreviewPass(pass, PREVIEW, "y".repeat(40), 1_000_000), null);
  assert.equal(await readPreviewPass(pass.replace(/.$/, (c) => (c === "A" ? "B" : "A")), PREVIEW, SECRET, 1_000_000), null);
});
