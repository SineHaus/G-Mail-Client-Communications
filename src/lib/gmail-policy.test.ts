// Guarantees the dashboard can't change the Gmail mailbox beyond sending approved replies and the
// read/unread (UNREAD) label. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  assertAllowedGmailBody,
  assertAllowedGmailCall,
  GMAIL_SCOPES,
  grantedCanModify,
  grantedScopesAreSafe,
  isGmailScopeError,
  LOGIN_SCOPES,
  loginScopesAreSafe,
  markReadRequest,
  markUnreadRequest,
} from "./gmail-policy.ts";

test("OAuth scopes are exactly gmail.readonly + gmail.send + gmail.modify", () => {
  assert.deepEqual([...GMAIL_SCOPES].sort(), [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
  ]);
});

test("signing in asks for identity only, never mailbox access", () => {
  assert.deepEqual([...LOGIN_SCOPES], ["openid", "email"]);
  assert.equal(loginScopesAreSafe("openid https://www.googleapis.com/auth/userinfo.email"), true);
  assert.equal(loginScopesAreSafe("openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.readonly"), false);
  assert.equal(loginScopesAreSafe("https://www.googleapis.com/auth/userinfo.email"), false);
  assert.equal(loginScopesAreSafe(undefined), false);
});

test("granted-scope check: read + send required, modify optional, nothing broader", () => {
  const readSend = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send";
  const all = GMAIL_SCOPES.join(" ");
  assert.equal(grantedScopesAreSafe(all), true);
  assert.equal(grantedCanModify(all), true);
  assert.equal(grantedScopesAreSafe(readSend), true); // older connection, or modify unticked
  assert.equal(grantedCanModify(readSend), false);
  assert.equal(grantedScopesAreSafe(`${all} https://mail.google.com/`), false);
  assert.equal(grantedScopesAreSafe(`${all} https://www.googleapis.com/auth/gmail.settings.basic`), false);
  assert.equal(grantedScopesAreSafe("https://www.googleapis.com/auth/gmail.readonly"), false);
  assert.equal(grantedScopesAreSafe("https://www.googleapis.com/auth/gmail.modify"), false);
  assert.equal(grantedScopesAreSafe(undefined), false);
  assert.equal(grantedCanModify(undefined), false);
});

test("allowed calls: read-only fetch/sync/push + messages.send + read/unread", () => {
  for (const [m, p] of [
    ["GET", "profile"],
    ["GET", "messages?q=newer_than%3A14d&maxResults=100"],
    ["GET", "messages/18c2f0a1b2c3d4e5?format=full"],
    ["GET", "messages/18c2f0a1b2c3d4e5?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References"],
    ["GET", "history?startHistoryId=123&historyTypes=messageAdded"],
    ["POST", "watch"],
    ["POST", "stop"],
    ["POST", "messages/send"],
    ["POST", "messages/batchModify"],
    ["POST", "messages/18c2f0a1b2c3d4e5/modify"],
  ]) assert.doesNotThrow(() => assertAllowedGmailCall(m, p), `${m} ${p}`);
});

test("blocked: every destructive Gmail call, thread-wide changes and label admin", () => {
  for (const [m, p] of [
    ["POST", "messages/batchDelete"],
    ["POST", "threads/abc/modify"],
    ["POST", "messages/abc/trash"],
    ["POST", "messages/abc/untrash"],
    ["POST", "threads/abc/trash"],
    ["DELETE", "messages/abc"],
    ["DELETE", "threads/abc"],
    ["POST", "messages/import"],
    ["POST", "messages"],
    ["POST", "drafts"],
    ["POST", "drafts/send"],
    ["POST", "labels"],
    ["PATCH", "labels/Label_1"],
    ["GET", "messages/abc/modify"],
    ["POST", "messages/abc/def/modify"],
    ["POST", "messages/../threads/abc/modify"],
    ["GET", "messages/abc?format=full/../modify"],
    ["POST", "settings/filters"],
  ]) assert.throws(() => assertAllowedGmailCall(m, p), /Blocked Gmail API call/, `${m} ${p}`);
});

test("read/unread requests may only touch the UNREAD label", () => {
  const ok = [markReadRequest(["18c2f0a1b2c3d4e5", "18c2f0a1b2c3d4e6"]), markUnreadRequest("18c2f0a1b2c3d4e5")];
  for (const r of ok) {
    assert.doesNotThrow(() => assertAllowedGmailCall("POST", r.path));
    assert.doesNotThrow(() => assertAllowedGmailBody("POST", r.path, JSON.stringify(r.body)));
  }
  const bad: [string, unknown][] = [
    ["messages/batchModify", { ids: ["abc"], removeLabelIds: ["INBOX"] }], // archive
    ["messages/batchModify", { ids: ["abc"], removeLabelIds: ["UNREAD", "INBOX"] }],
    ["messages/batchModify", { ids: ["abc"], addLabelIds: ["UNREAD"] }],
    ["messages/batchModify", { ids: ["abc"], removeLabelIds: ["UNREAD"], addLabelIds: ["TRASH"] }],
    ["messages/batchModify", { ids: [], removeLabelIds: ["UNREAD"] }],
    ["messages/batchModify", { ids: ["a/b"], removeLabelIds: ["UNREAD"] }],
    ["messages/batchModify", { ids: Array(1001).fill("abc"), removeLabelIds: ["UNREAD"] }],
    ["messages/batchModify", { removeLabelIds: ["UNREAD"] }],
    ["messages/batchModify", null],
    ["messages/batchModify", "not json"],
    ["messages/abc/modify", { addLabelIds: ["STARRED"] }],
    ["messages/abc/modify", { addLabelIds: ["TRASH"] }],
    ["messages/abc/modify", { removeLabelIds: ["UNREAD"] }],
    ["messages/abc/modify", { addLabelIds: ["UNREAD"], removeLabelIds: ["INBOX"] }],
    ["messages/abc/modify", {}],
  ];
  for (const [p, body] of bad) {
    assert.throws(
      () => assertAllowedGmailBody("POST", p, typeof body === "string" ? body : JSON.stringify(body)),
      /Blocked Gmail API call/,
      `${p} ${JSON.stringify(body)}`,
    );
  }
});

test("a missing scope is recognised, and a rate limit is not mistaken for one", () => {
  assert.equal(isGmailScopeError(403, '{"error":{"code":403,"message":"Request had insufficient authentication scopes.","errors":[{"reason":"insufficientPermissions"}],"status":"PERMISSION_DENIED","details":[{"reason":"ACCESS_TOKEN_SCOPE_INSUFFICIENT"}]}}'), true);
  assert.equal(isGmailScopeError(403, '{"error":{"errors":[{"reason":"rateLimitExceeded"}]}}'), false);
  assert.equal(isGmailScopeError(401, "insufficientPermissions"), false);
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f) && !/gmail-policy\.ts$/.test(f) ? [p] : [];
  });
}

// Label requests are built only in gmail-policy.ts (UNREAD only, body-checked), so nothing else may spell one out.
test("no source file contains label-changing Gmail code or calls Gmail outside google.ts", () => {
  const forbidden = [
    /batchModify/i,
    /\/modify\b/i,
    /\.modify\s*\(/i,
    /removeLabelIds|addLabelIds/,
    /["'`]UNREAD["'`]/,
    /\/(trash|untrash|batchDelete)\b/i,
    /gmail\.modify|mail\.google\.com\/?["'`\s]/i,
    /gmail\w*\s*(<[^>]*>)?\(\s*(\w+,\s*)?["'`]drafts/, // a Gmail call to the drafts endpoint
    /users\/me\/drafts/,
  ];
  const src = new URL("../", import.meta.url).pathname;
  for (const file of sourceFiles(src)) {
    const text = readFileSync(file, "utf8");
    for (const re of forbidden) assert.doesNotMatch(text, re, `${file} matches ${re}`);
    if (!file.endsWith("/lib/google.ts")) {
      assert.doesNotMatch(text, /gmail\.googleapis\.com/, `${file} calls the Gmail API directly; use lib/google.ts`);
    }
  }
});

test("rate-limit errors are recognised (429, or 403 with a rate-limit reason) and other 403s are not", async () => {
  const { isGmailRateLimit } = await import("./gmail-policy.ts");
  assert.equal(isGmailRateLimit(429, ""), true);
  assert.equal(
    isGmailRateLimit(403, '{"error":{"code":403,"message":"Quota exceeded for quota metric \'Total Query Cost\'","errors":[{"reason":"rateLimitExceeded"}]}}'),
    true,
  );
  assert.equal(isGmailRateLimit(403, '{"error":{"code":403,"message":"Insufficient Permission","errors":[{"reason":"insufficientPermissions"}]}}'), false);
  assert.equal(isGmailRateLimit(500, "rateLimitExceeded"), false);
});
