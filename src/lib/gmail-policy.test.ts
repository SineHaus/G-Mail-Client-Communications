// Guarantees the dashboard can never change the Gmail mailbox. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { assertAllowedGmailCall, GMAIL_SCOPES, grantedScopesAreSafe } from "./gmail-policy.ts";

test("OAuth scopes are exactly gmail.readonly + gmail.send", () => {
  assert.deepEqual([...GMAIL_SCOPES].sort(), [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
  ]);
});

test("granted-scope check rejects broader or missing access", () => {
  const ok = GMAIL_SCOPES.join(" ");
  assert.equal(grantedScopesAreSafe(ok), true);
  assert.equal(grantedScopesAreSafe(`${ok} https://www.googleapis.com/auth/gmail.modify`), false);
  assert.equal(grantedScopesAreSafe(`${ok} https://mail.google.com/`), false);
  assert.equal(grantedScopesAreSafe("https://www.googleapis.com/auth/gmail.readonly"), false);
  assert.equal(grantedScopesAreSafe(undefined), false);
});

test("allowed calls: read-only fetch/sync/push + messages.send", () => {
  for (const [m, p] of [
    ["GET", "profile"],
    ["GET", "messages?q=newer_than%3A14d&maxResults=100"],
    ["GET", "messages/18c2f0a1b2c3d4e5?format=full"],
    ["GET", "messages/18c2f0a1b2c3d4e5?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References"],
    ["GET", "history?startHistoryId=123&historyTypes=messageAdded"],
    ["POST", "watch"],
    ["POST", "messages/send"],
  ]) assert.doesNotThrow(() => assertAllowedGmailCall(m, p), `${m} ${p}`);
});

test("blocked: every label-changing or destructive Gmail call", () => {
  for (const [m, p] of [
    ["POST", "messages/abc/modify"],
    ["POST", "messages/batchModify"],
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
    ["POST", "stop"],
    ["GET", "messages/abc/modify"],
    ["GET", "messages/abc?format=full/../modify"],
    ["POST", "settings/filters"],
  ]) assert.throws(() => assertAllowedGmailCall(m, p), /Blocked Gmail API call/, `${m} ${p}`);
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f) && !/gmail-policy\.ts$/.test(f) ? [p] : [];
  });
}

test("no source file contains label-changing Gmail code or calls Gmail outside google.ts", () => {
  const forbidden = [
    /batchModify/i,
    /\/modify\b/i,
    /\.modify\s*\(/i,
    /removeLabelIds|addLabelIds/,
    /["'`]UNREAD["'`]/,
    /\/(trash|untrash|batchDelete)\b/i,
    /gmail\.modify|mail\.google\.com\/?["'`\s]/i,
    /\/drafts\b/,
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
