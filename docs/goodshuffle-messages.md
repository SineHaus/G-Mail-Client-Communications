# Goodshuffle Pro messages in the dashboard

Leo's direction (Nov 20): replies to Goodshuffle Pro messages go out through Goodshuffle's own Messages
window in his Chrome, signed in only as support@theeventrentalguys.com. Every reply is approved in the
dashboard first. Goodshuffle has no API, so a small Chrome extension does the reading and the typing.

## How it works

1. **Read.** Every 2 minutes the extension (`extensions/goodshuffle-messages`) checks which Goodshuffle login
   this Chrome has (`/app/login/isAuthenticated`). Anything other than support@ and it stops: nothing is
   read or sent. Otherwise it asks the dashboard which projects to read and reads their client conversation
   (`/app/conversation/getMessagesForTransaction?transactionID=…`, the same request the Messages window makes),
   then copies the messages to the dashboard (`POST /api/goodshuffle`, with a device token from Settings).
2. **Which projects.** A customer's Goodshuffle message also arrives at support@ as an email whose subject
   names the project ("Re: … (Project #232040555)"). The dashboard asks for a project when such an email is
   newer than its last read, when a reply to it is on its way, and once an hour for known conversations. The
   extension also adds Goodshuffle's own unread list when it can read it.
3. **Draft.** When the newest message in a conversation is the customer's, Claude drafts a reply with the
   usual rules (never offers delivery or pickup dates, placeholders like [PRICE] for what Leo fills in) and
   no sign-off, since Goodshuffle adds Leo's signature by itself. It shows in the Inbox's Goodshuffle Pro box.
4. **Approve.** Someone with Approve on the account edits it if needed and presses Approve, then confirms.
   That's the only way a reply reaches the extension. Decline, Save edits and Redraft work as for emails.
5. **Send.** The extension claims the approved reply (once), checks again that Goodshuffle is signed in as
   support@ and that the customer hasn't written again since the draft, opens the conversation
   (`/ui/message/inbox/<project>`) in a small window, presses **Reply**, checks the reply is addressed to this
   project's customer with this project's subject, types the approved text above the signature, checks the box
   holds exactly that text, presses **Send Message**, and closes the window. It then checks Goodshuffle shows
   the reply and marks it Sent in the dashboard.
6. **When something's off,** it stops without sending and the dashboard shows the reason on the card. A reply
   is never retried by itself. If Send Message was pressed but the reply couldn't be seen afterwards, the card
   says to check Goodshuffle first, and Approve refuses while Goodshuffle shows a newer reply from support@.

## Setting it up (Leo)

1. Run `supabase/migrations/007_goodshuffle_messages.sql` in Supabase → SQL Editor (after 006).
2. In the dashboard, **Settings → Goodshuffle messages → Connect a Chrome**. Copy the dashboard address and
   the token it shows (shown once).
3. In the Chrome on the MacBook Pro that's signed in to Goodshuffle Pro as support@: open
   `chrome://extensions`, turn on **Developer mode**, press **Load unpacked**, and choose the
   `extensions/goodshuffle-messages` folder from this repository (download the repository as a ZIP from
   GitHub and unzip it, or use a clone).
4. Click the extension's icon (pin it from the puzzle-piece menu), paste the address and token, press
   **Save and check now**, and choose **Allow** when Chrome asks to reach the dashboard. The status line says
   what it saw ("Signed in as support@. Read 3 conversations.").
5. Leave that Chrome open. A red **!** on the icon means it needs attention; click it to see why.

To stop it: Settings → Disconnect, or remove the extension in `chrome://extensions`.

## What Goodshuffle looks like (read-only look, Nov 20)

- Signed in as support@. Messages are emails between support@ and the customer (`medium: EMAIL`), each with
  `id`, `date`, `eventType` (`USER_MESSAGE` or `SYSTEM_ACTION`), `sender` (customers have a `contactID`),
  `messageText` (HTML), `subject`, and `fromCurrentUser`.
- The reply box is a Quill editor (`.gsp-compose-message-input-wrapper .ql-editor`). Reply fills in the
  customer and the subject; the send button is **Send Message** and stays off until there's text.

## Not known yet

- Whether reading a conversation through Goodshuffle marks its messages as read in Goodshuffle's own inbox.
  It may, since it's the same request the Messages window makes.
- The exact format of `listTransactions` (the unread list); the extension reads it only if it can and doesn't
  depend on it.
- Whether the signature sits inside the reply box or under it; the extension handles both.

The first approved reply is the real test of the send steps. Approve one short reply while watching the
window the extension opens, then check the conversation in Goodshuffle.
