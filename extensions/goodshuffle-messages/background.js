// TERG Goodshuffle messages (Chrome extension, Manifest V3).
//
// Every 2 minutes, in the Chrome that is signed in to Goodshuffle Pro:
//  1. Checks Goodshuffle is signed in as support@theeventrentalguys.com. If not, it stops: nothing is read or sent.
//  2. Asks the dashboard which projects to read, reads their client conversation from Goodshuffle and copies
//     the messages to the dashboard (Claude drafts replies there).
//  3. Takes replies that someone APPROVED in the dashboard, opens that conversation in Goodshuffle's own
//     Messages window, types exactly the approved text into the reply box, presses Send Message, and checks
//     Goodshuffle shows the reply. A reply that fails is never retried by itself.
//
// It never sends a reply that wasn't approved in the dashboard, and never changes anything else in Goodshuffle.

const GSP = "https://pro.goodshuffle.com";
const SUPPORT = "support@theeventrentalguys.com";
const EVERY_MINUTES = 2;
const MAX_SENDS_PER_RUN = 3;

const schedule = () => chrome.alarms.create("tick", { periodInMinutes: EVERY_MINUTES });
chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
chrome.alarms.onAlarm.addListener((a) => a.name === "tick" && tick());
chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg?.type !== "runNow") return false;
  tick().finally(() => respond({ ok: true }));
  return true;
});

let running = null;
function tick() {
  if (!running) running = run().finally(() => (running = null));
  return running;
}

async function setStatus(ok, text) {
  await chrome.storage.local.set({ status: { ok, text, at: Date.now() } });
  await chrome.action.setBadgeText({ text: ok ? "" : "!" });
  if (!ok) await chrome.action.setBadgeBackgroundColor({ color: "#b91c1c" });
}

// ---------- Talking to the dashboard ----------

async function dashboard(op, extra = {}) {
  const { dashboard: base, token } = await chrome.storage.local.get(["dashboard", "token"]);
  const res = await fetch(`${base}/api/goodshuffle`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ op, ...extra }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `The dashboard answered ${res.status}.`);
  return data;
}

// ---------- Reading Goodshuffle (only GET requests the Messages window itself makes) ----------

async function gspDirect(path) {
  const res = await fetch(GSP + path, { credentials: "include", headers: { accept: "application/json" } });
  if (!res.ok || !(res.headers.get("content-type") || "").includes("json")) throw new Error(`Goodshuffle answered ${res.status}.`);
  return res.json();
}

/** The same request made from inside an open Goodshuffle tab, if the direct one isn't signed in. */
async function gspInTab(path) {
  const tabs = await chrome.tabs.query({ url: `${GSP}/*` });
  if (!tabs.length) throw new Error("Open Goodshuffle Pro in a tab of this Chrome, signed in as support@.");
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tabs[0].id },
    world: "MAIN",
    func: async (p) => {
      try {
        const r = await fetch(p, { headers: { accept: "application/json" } });
        if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) return { error: `Goodshuffle answered ${r.status}.` };
        return { data: await r.json() };
      } catch (e) {
        return { error: String(e) };
      }
    },
    args: [path],
  });
  if (!result || result.error) throw new Error(result?.error || "Couldn't read Goodshuffle.");
  return result.data;
}

let useTab = false;
async function gsp(path) {
  if (!useTab) {
    try {
      return await gspDirect(path);
    } catch {
      useTab = true;
    }
  }
  return gspInTab(path);
}

/** The Goodshuffle login in this Chrome, or "" if none. */
async function whoIsSignedIn() {
  try {
    const auth = await gsp("/app/login/isAuthenticated");
    return String(auth?.userIdentity?.email || "").trim().toLowerCase();
  } catch {
    return "";
  }
}

const messagesOf = async (projectId) => (await gsp(`/app/conversation/getMessagesForTransaction?transactionID=${encodeURIComponent(projectId)}`))?.client?.messages ?? [];

/** Project ids in Goodshuffle's own unread list, when it can be read (best effort). */
async function unreadProjects() {
  try {
    const data = await gsp("/app/conversation/listTransactions?page=0&pageSize=25&unreadOnly=true&includeArchived=true&myProjectsOnly=false");
    const ids = new Set();
    const walk = (v, depth = 0) => {
      if (!v || typeof v !== "object" || depth > 4) return;
      if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
      for (const [k, x] of Object.entries(v)) {
        if (/^transaction(ID|Id)$/.test(k) && /^\d{4,12}$/.test(String(x))) ids.add(String(x));
        else walk(x, depth + 1);
      }
    };
    walk(data);
    return [...ids];
  } catch {
    return [];
  }
}

// ---------- One run ----------

async function run() {
  const { dashboard: base, token } = await chrome.storage.local.get(["dashboard", "token"]);
  if (!base || !token) return setStatus(false, "Not set up yet. Add the dashboard address and token from the dashboard's Settings.");
  try {
    const who = await whoIsSignedIn();
    if (who !== SUPPORT) {
      // Tell the dashboard what it saw (it refuses everything), then stop. Nothing is read or sent.
      await dashboard("work", { signedInAs: who || "not signed in" }).catch(() => {});
      return setStatus(false, who ? `Goodshuffle is signed in as ${who}. This only works signed in as ${SUPPORT}, so it did nothing.` : `Goodshuffle isn't signed in in this Chrome. Sign in as ${SUPPORT}.`);
    }

    const work = await dashboard("work", { signedInAs: who });
    const ids = [...new Set([...(work.projects || []), ...(await unreadProjects())])].slice(0, 30);
    const projects = [];
    for (const projectId of ids) {
      try {
        projects.push({ projectId, messages: await messagesOf(projectId) });
      } catch (e) {
        console.warn("couldn't read project", projectId, e);
      }
    }
    if (projects.length) await dashboard("sync", { signedInAs: who, projects });

    let sent = 0;
    let failed = 0;
    for (let i = 0; i < MAX_SENDS_PER_RUN && work.approvedReplies > 0; i++) {
      const { reply } = await dashboard("claim", { signedInAs: who });
      if (!reply) break;
      if (await sendOne(reply)) sent++;
      else failed++;
    }
    await setStatus(
      failed === 0,
      `Signed in as support@. Read ${projects.length} conversation${projects.length === 1 ? "" : "s"}.` +
        (sent ? ` Sent ${sent} approved repl${sent === 1 ? "y" : "ies"}.` : "") +
        (failed ? ` ${failed} approved repl${failed === 1 ? "y" : "ies"} couldn't be sent; the dashboard shows why.` : ""),
    );
  } catch (e) {
    await setStatus(false, e instanceof Error ? e.message : String(e));
  }
}

// ---------- Sending one approved reply ----------

const toText = (html) =>
  String(html || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
const timeOf = (m) => new Date(m.date).getTime() || 0;

async function sendOne(reply) {
  let win = null;
  let pressed = false;
  try {
    if ((await whoIsSignedIn()) !== SUPPORT) throw new Error("Goodshuffle isn't signed in as support@ any more, so the reply wasn't sent.");
    const before = await messagesOf(reply.gsp_project_id);
    const inbound = before.filter((m) => m.eventType !== "SYSTEM_ACTION" && !m.fromCurrentUser).sort((a, b) => timeOf(b) - timeOf(a))[0];
    if (!inbound) throw new Error("Couldn't find the customer's message in Goodshuffle, so the reply wasn't sent.");
    if (reply.in_reply_to && String(inbound.id) !== reply.in_reply_to) {
      throw new Error("The customer wrote again after this reply was drafted, so it wasn't sent. Read the new message, then approve again.");
    }

    const startedAt = Date.now();
    win = await chrome.windows.create({ url: `${GSP}/ui/message/inbox/${encodeURIComponent(reply.gsp_project_id)}`, type: "popup", width: 1000, height: 820, focused: true });
    const tabId = win.tabs[0].id;
    await loaded(tabId);
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: typeReplyAndSend,
      args: [reply.body, reply.gsp_project_id, norm(inbound.sender?.fullName), norm(inbound.sender?.email), SUPPORT],
    });
    pressed = !!result?.pressed;
    if (!result?.ok) throw new Error(result?.error || "Couldn't type the reply into Goodshuffle.");

    const id = await confirmSent(reply, startedAt);
    if (!id) throw new Error("Pressed Send Message in Goodshuffle but couldn't see the reply there afterwards. Check the conversation in Goodshuffle before sending again.");
    await dashboard("result", { signedInAs: SUPPORT, id: reply.id, sent: true, gspMessageId: id });
    return true;
  } catch (e) {
    let msg = e instanceof Error ? e.message : String(e);
    if (pressed && !/Check the conversation/.test(msg)) msg += " Send Message was pressed, so check the conversation in Goodshuffle before sending again.";
    await dashboard("result", { signedInAs: SUPPORT, id: reply.id, sent: false, error: msg }).catch(() => {});
    return false;
  } finally {
    if (win) chrome.windows.remove(win.id).catch(() => {});
  }
}

function loaded(tabId) {
  return new Promise((resolve) => {
    const done = () => (chrome.tabs.onUpdated.removeListener(on), clearTimeout(t), resolve());
    const on = (id, info) => id === tabId && info.status === "complete" && done();
    const t = setTimeout(done, 30_000);
    chrome.tabs.onUpdated.addListener(on);
  });
}

/** Goodshuffle shows a reply from support@ with the approved words, sent after we started. Returns its id. */
async function confirmSent(reply, startedAt) {
  const words = norm(reply.body).slice(0, 60);
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const msgs = await messagesOf(reply.gsp_project_id).catch(() => []);
    const mine = msgs.find((m) => m.fromCurrentUser && timeOf(m) >= startedAt - 120_000 && norm(toText(m.messageText)).includes(words));
    if (mine) return String(mine.id);
  }
  return null;
}

/**
 * Runs inside Goodshuffle's Messages window (the page's own context). Self-contained: Chrome copies only
 * this function into the page. Presses Reply, types the approved text at the top of the reply box (above the
 * signature Goodshuffle adds), checks the box holds exactly that text and the reply goes to this project's
 * customer, then presses Send Message. Any doubt: stop without sending.
 */
async function typeReplyAndSend(body, projectId, customerName, customerEmail, support) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const waitFor = async (fn, ms = 20000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(250);
    }
    return null;
  };
  try {
    const auth = await fetch("/app/login/isAuthenticated", { headers: { accept: "application/json" } }).then((r) => r.json());
    if (clean(auth?.userIdentity?.email).toLowerCase() !== support) return { ok: false, error: "Goodshuffle isn't signed in as support@, so the reply wasn't sent." };
    if (!location.pathname.includes(`/ui/message/inbox/${projectId}`)) return { ok: false, error: "Goodshuffle didn't open this project's conversation, so the reply wasn't sent." };

    const buttons = () => [...document.querySelectorAll("button")];
    const replyBtn = await waitFor(() => buttons().find((b) => /^(reply )?reply$/i.test(clean(b.textContent))));
    if (!replyBtn) return { ok: false, error: "Couldn't find Goodshuffle's Reply button, so the reply wasn't sent." };
    replyBtn.click();

    const box = await waitFor(() => document.querySelector(".gsp-compose-message-input-wrapper .ql-editor") || document.querySelector(".ql-editor"));
    if (!box) return { ok: false, error: "Goodshuffle's reply box didn't open, so the reply wasn't sent." };
    let composer = box;
    while (composer.parentElement && !buttons().some((b) => composer.contains(b) && /send message$/i.test(clean(b.textContent)))) composer = composer.parentElement;
    const sendBtn = () => buttons().find((b) => composer.contains(b) && /send message$/i.test(clean(b.textContent)));
    if (!sendBtn()) return { ok: false, error: "Couldn't find Goodshuffle's Send Message button, so the reply wasn't sent." };

    // The reply goes to this project's customer (To) with this project's subject.
    const around = clean(composer.innerText.replace(box.innerText, ""));
    const toOk = (customerName && around.toLowerCase().includes(customerName.toLowerCase())) || (customerEmail && around.toLowerCase().includes(customerEmail.toLowerCase()));
    if (!toOk) return { ok: false, error: `Goodshuffle's reply wasn't addressed to ${customerName || customerEmail || "the customer"}, so it wasn't sent.` };
    if (!around.includes(projectId)) return { ok: false, error: `Goodshuffle's reply subject didn't name project #${projectId}, so it wasn't sent.` };

    // The box should be empty or hold only the signature.
    const pre = clean(box.innerText);
    if (pre && !(pre.length < 400 && /leonel|event rental guys/i.test(pre))) return { ok: false, error: "Goodshuffle's reply box already had other text in it, so the reply wasn't sent." };

    const text = body + (pre ? "\n\n" : "");
    const quill = box.closest(".ql-container")?.__quill;
    if (quill && typeof quill.insertText === "function") {
      quill.insertText(0, text, "user");
    } else {
      box.focus();
      const range = document.createRange();
      range.setStart(box.firstChild || box, 0);
      range.collapse(true);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      text.split("\n").forEach((line, i) => {
        if (i) document.execCommand("insertParagraph");
        if (line) document.execCommand("insertText", false, line);
      });
    }
    await sleep(600);
    const now = clean(box.innerText);
    if (!now.startsWith(clean(body)) || clean(now.slice(clean(body).length)) !== pre) {
      if (quill) quill.deleteText(0, text.length, "user");
      return { ok: false, error: "The text in Goodshuffle's reply box didn't match the approved reply, so it wasn't sent." };
    }

    const send = await waitFor(() => (sendBtn() && !sendBtn().disabled ? sendBtn() : null), 10000);
    if (!send) return { ok: false, error: "Goodshuffle's Send Message button didn't turn on, so the reply wasn't sent." };
    send.click();
    await sleep(2000);
    return { ok: true, pressed: true };
  } catch (e) {
    return { ok: false, error: `Something went wrong in Goodshuffle (${String(e).slice(0, 200)}), so the reply wasn't sent.` };
  }
}
