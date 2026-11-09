// Guards multi-account isolation. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { decryptToken, encryptToken } from "./token-crypto.ts";

const KEY = Buffer.alloc(32, 7).toString("base64");

test("refresh tokens round-trip through AES-256-GCM and aren't stored in plain text", () => {
  const enc = encryptToken("1//refresh-token-abc", "leonel@x.com", KEY);
  assert.doesNotMatch(enc, /refresh-token-abc/);
  assert.equal(decryptToken(enc, "leonel@x.com", KEY), "1//refresh-token-abc");
  assert.notEqual(encryptToken("same", "a@x.com", KEY), encryptToken("same", "a@x.com", KEY)); // random IV
});

test("an encrypted token copied to another account's row will not decrypt", () => {
  const enc = encryptToken("token-for-a", "a@x.com", KEY);
  assert.throws(() => decryptToken(enc, "b@x.com", KEY));
});

test("tampered ciphertext or wrong key is rejected", () => {
  const enc = encryptToken("token", "a@x.com", KEY);
  const parts = enc.split(":");
  parts[3] = Buffer.from("tampered!").toString("base64");
  assert.throws(() => decryptToken(parts.join(":"), "a@x.com", KEY));
  assert.throws(() => decryptToken(enc, "a@x.com", Buffer.alloc(32, 9).toString("base64")));
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f) ? [p] : [];
  });
}

const ACCOUNT_TABLES = ["emails", "drafts", "clients", "projects", "style_examples"];

test("every query on an account-owned table is scoped by account_id", () => {
  const src = new URL("../", import.meta.url).pathname;
  const misses: string[] = [];
  for (const file of sourceFiles(src)) {
    const text = readFileSync(file, "utf8");
    const re = /\.from\("([a-z_]+)"\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (!ACCOUNT_TABLES.includes(m[1])) continue;
      // The query chain: from .from( up to the next .from( / end of statement.
      const rest = text.slice(m.index + 1);
      const end = Math.min(...[rest.indexOf(".from("), rest.search(/;\s*$/m), 1200].filter((i) => i >= 0));
      const chain = rest.slice(0, end);
      // A query may opt out only with an explicit marker right above it (aggregate counts, no row data).
      const exempt = /isolation-exempt:/.test(text.slice(Math.max(0, m.index - 300), m.index));
      if (!/account_id/.test(chain) && !exempt) {
        const line = text.slice(0, m.index).split("\n").length;
        misses.push(`${file.replace(src, "src/")}:${line} .from("${m[1]}")`);
      }
    }
  }
  assert.deepEqual(misses, [], `Unscoped queries:\n${misses.join("\n")}`);
});

test("pages never select the encrypted token column", () => {
  const src = new URL("../", import.meta.url).pathname;
  for (const file of sourceFiles(src)) {
    if (/lib\/(google|accounts)\.ts$/.test(file) || /lib\/token-crypto\.ts$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /select\([^)]*refresh_token_encrypted/, `${file} selects the encrypted token`);
    assert.doesNotMatch(text, /from\("gmail_accounts"\)\s*\.select\("\*/, `${file} selects * from gmail_accounts`);
  }
});
