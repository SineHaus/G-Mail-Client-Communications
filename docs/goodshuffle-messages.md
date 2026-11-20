# Goodshuffle Pro messages in the dashboard (plan, not built)

Leo's direction (Nov 20): replies to Goodshuffle Pro messages go out through Goodshuffle's own Messages
window in his Chrome (Mac or Windows), signed in only as support@theeventrentalguys.com. Every reply is
approved in the dashboard first. Goodshuffle has no API, so the dashboard can't read or send these itself.

## What's already covered by email

Goodshuffle's quote and invoice emails carry "(Project #…)" in the subject. When a customer replies to one,
the reply reaches support@ as a normal email, and the dashboard already shows it in the Inbox's Goodshuffle
Pro box with a drafted reply. Those replies go out by email from support@, which keeps the project number in
the subject. What's missing is messages written inside Goodshuffle Pro's Messages window.

## Proposed build: a small Chrome extension in Leo's Chrome

1. **Read messages.** The extension runs only on pro.goodshuffle.com. While Goodshuffle is open, it reads
   new customer messages from the Messages window and sends them to the dashboard
   (`POST /api/goodshuffle/messages`, with a device token Leo creates in Settings). Each message is stored
   with its Goodshuffle project number and linked to the customer and quote card.
2. **Draft.** Claude drafts a reply the same way it does for emails (same rules: never offers delivery or
   pickup dates). It shows in the Inbox's Goodshuffle Pro box and in the thread side panel.
3. **Approve.** Approve in the dashboard is the yes for that one reply, with exactly the text shown. The reply
   goes into a send queue (`goodshuffle_outbox`).
4. **Send.** The extension picks up approved replies, opens that project's conversation in the Messages
   window, enters the text and sends it, then reads the page back and marks the reply sent in the dashboard
   only once Goodshuffle shows it. If anything doesn't match (another project, text changed, send failed), it
   stops and the card shows what happened.

Safety rules built into the extension:

- It checks the signed-in Goodshuffle account is support@theeventrentalguys.com before reading or sending,
  and does nothing on any other account.
- It only sends replies approved in the dashboard, once each, and never sends anything on its own.
- It never touches billing, payments, project items or settings in Goodshuffle.

## Other ways, and why not

- **Claude in Chrome, one session per reply:** works without new code, but each reply needs a Claude session
  to open Goodshuffle and type it, so it's slower, and nothing comes into the dashboard on its own.
- **Goodshuffle's message notification emails:** if Goodshuffle emails support@ when a customer writes in the
  Messages window, the dashboard could read those notices without an extension. Replying by email to a notice
  probably doesn't land back in Goodshuffle, so sending would still need the extension. Not yet checked.

## Needed from Leo before building

- One look at the Messages window in his Chrome, signed in as support@, so the extension matches Goodshuffle's
  page. Nothing is sent during that look.
- Which computer runs it (Mac or Windows). Chrome needs to stay open with Goodshuffle signed in for messages
  to come in and approved replies to go out.
- Migration 007 (`goodshuffle_messages`, `goodshuffle_outbox`) when the build lands.
