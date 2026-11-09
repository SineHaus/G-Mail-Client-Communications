// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReplyRaw,
  decodeB64Url,
  encodeB64Url,
  extractBody,
  htmlToText,
  parseAddressList,
  replySubject,
  stripQuoted,
  type GmailMessage,
} from "./email-parse.ts";

test("parseAddressList handles names, quotes and commas", () => {
  assert.deepEqual(parseAddressList('"Doe, Jane" <Jane@Example.com>, bob@y.com'), [
    { name: "Doe, Jane", email: "jane@example.com" },
    { name: "", email: "bob@y.com" },
  ]);
  assert.deepEqual(parseAddressList("Maria Lopez <maria@x.co>"), [{ name: "Maria Lopez", email: "maria@x.co" }]);
});

test("stripQuoted removes Gmail-style quoted history", () => {
  const t = "Hi Leonel,\n\nDo you have 20 round tables?\n\nThanks,\nMaria\n\nOn Mon, Nov 3, 2026 at 9:14 AM Leonel <l@erg.com> wrote:\n> Hello\n> there";
  assert.equal(stripQuoted(t), "Hi Leonel,\n\nDo you have 20 round tables?\n\nThanks,\nMaria");
});

test("stripQuoted handles wrapped 'On ... wrote:' and Outlook headers", () => {
  assert.equal(stripQuoted("Sounds good\n\nOn Mon, Nov 3, 2026 at 9:14 AM Leonel <l@erg.com>\nwrote:\n> old"), "Sounds good");
  assert.equal(stripQuoted("Yes please\n\nFrom: Leonel\nSent: Monday\nTo: me"), "Yes please");
  assert.equal(stripQuoted("Ok\n-----Original Message-----\nold"), "Ok");
});

test("htmlToText converts basic HTML", () => {
  assert.equal(htmlToText("<p>Hi&nbsp;there</p><p>Line 2<br>Line 3</p><style>x{}</style>"), "Hi there\nLine 2\nLine 3");
});

test("extractBody prefers text/plain inside multipart", () => {
  const msg: GmailMessage = {
    id: "1",
    threadId: "t",
    payload: {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/html", body: { data: encodeB64Url("<b>HTML</b>") } },
        { mimeType: "text/plain", body: { data: encodeB64Url("Plain ✓") } },
      ],
    },
  };
  assert.equal(extractBody(msg), "Plain ✓");
});

test("replySubject adds Re: once", () => {
  assert.equal(replySubject("Tent quote"), "Re: Tent quote");
  assert.equal(replySubject("RE: Tent quote"), "RE: Tent quote");
});

test("buildReplyRaw produces a threaded UTF-8 reply", () => {
  const raw = decodeB64Url(
    buildReplyRaw({
      from: '"Leonel" <l@erg.com>',
      to: "maria@x.co",
      subject: "Fiesta – mesas",
      body: "Hola María,\nSí tenemos.\n\nLeonel\nThe Event Rental Guys",
      inReplyTo: "<abc@mail.gmail.com>",
      references: "<root@mail.gmail.com>",
    }),
  );
  const [head, b64] = raw.split("\r\n\r\n");
  assert.match(head, /^Subject: =\?UTF-8\?B\?/m);
  assert.match(head, /^In-Reply-To: <abc@mail.gmail.com>$/m);
  assert.match(head, /^References: <root@mail.gmail.com> <abc@mail.gmail.com>$/m);
  const subj = head.match(/=\?UTF-8\?B\?(.+)\?=/)![1];
  assert.equal(Buffer.from(subj, "base64").toString("utf8"), "Re: Fiesta – mesas");
  assert.equal(Buffer.from(b64.replace(/\r\n/g, ""), "base64").toString("utf8"), "Hola María,\r\nSí tenemos.\r\n\r\nLeonel\r\nThe Event Rental Guys");
});
