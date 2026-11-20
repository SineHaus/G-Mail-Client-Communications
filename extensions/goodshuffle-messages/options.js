// Settings for the extension: the dashboard address and the device token from the dashboard's Settings.
const $ = (id) => document.getElementById(id);

async function showStatus() {
  const { status } = await chrome.storage.local.get("status");
  const el = $("status");
  if (!status) return;
  el.textContent = `${status.ok ? "OK" : "Problem"} (${new Date(status.at).toLocaleString()})\n${status.text}`;
  el.className = status.ok ? "" : "bad";
}

async function load() {
  const { dashboard = "", token = "" } = await chrome.storage.local.get(["dashboard", "token"]);
  $("dashboard").value = dashboard;
  $("token").value = token;
  await showStatus();
}

$("save").addEventListener("click", async () => {
  let origin;
  try {
    origin = new URL($("dashboard").value.trim()).origin;
  } catch {
    $("status").textContent = "The dashboard address doesn't look right. Copy it from the dashboard's Settings.";
    $("status").className = "bad";
    return;
  }
  const token = $("token").value.trim();
  if (!/^gsp_[A-Za-z0-9_-]{20,}$/.test(token)) {
    $("status").textContent = "The token doesn't look right. Copy it from the dashboard's Settings (it starts with gsp_).";
    $("status").className = "bad";
    return;
  }
  // Chrome asks once for permission to talk to the dashboard's address.
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) {
    $("status").textContent = "Chrome needs permission to reach the dashboard. Press Save again and choose Allow.";
    $("status").className = "bad";
    return;
  }
  await chrome.storage.local.set({ dashboard: origin, token });
  $("status").textContent = "Saved. Checking…";
  $("status").className = "";
  await chrome.runtime.sendMessage({ type: "runNow" });
  await showStatus();
});

$("run").addEventListener("click", async () => {
  $("status").textContent = "Checking…";
  await chrome.runtime.sendMessage({ type: "runNow" });
  await showStatus();
});

chrome.storage.onChanged.addListener((c) => c.status && showStatus());
load();
