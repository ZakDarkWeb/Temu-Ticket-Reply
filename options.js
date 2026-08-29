const CONFIG_KEY = "temuTicketAutomationConfig";
const MAX_CHARS = 1500;
const DEFAULT_MESSAGES = [
  "Thank you for your patience. Your order is currently being processed and will be shipped shortly. We apologize for any inconvenience caused by the delay.",
  "We appreciate your understanding. Your order is in process and will be dispatched as soon as possible. Sorry for the delay.",
  "Thanks for waiting. Your order is being prepared for shipment and will be sent out soon. We regret the delay and appreciate your patience.",
  "Your order is currently in processing and will ship at the earliest. We apologize for the wait and thank you for your continued patience.",
  "We're working on getting your order shipped as quickly as possible. Thank you for bearing with us, and sorry for the delay.",
  "We sincerely apologize for the delay. Your order is currently being processed and will be shipped very soon. Thank you for your continued patience.",
  "Please accept our apologies for the delay in shipment. Your order is being finalized for dispatch and will be on its way shortly.",
  "Your order is in the final stages of processing and will be shipped without further delay. We appreciate your patience and understanding.",
  "We understand the wait has been longer than expected. Your order is actively being processed and will ship soon. Thank you for your patience.",
  "Rest assured, your order is being handled and will be dispatched shortly. We apologize for the delay and value your patience.",
  "Our team is currently processing your order and it will be shipped at the earliest opportunity. Thank you for understanding, and sorry for the inconvenience.",
  "We're finalizing your order for shipment now. It will be dispatched shortly, and we truly appreciate your patience during this delay.",
  "Your patience is greatly appreciated. The order is progressing through processing and will be shipped very soon. We apologize for the delay caused.",
  "We are actively working to get your order shipped as soon as possible. Thank you for your patience, and we apologize for any inconvenience.",
  "Your order is being prepared for dispatch and will ship shortly. We appreciate your continued patience and apologize for the delay."
];

const list = document.getElementById("messages");
const status = document.getElementById("status");
let messages = [];

function showStatus(text, error = false) {
  status.textContent = text;
  status.style.color = error ? "#b3261e" : "#16803c";
}

function render() {
  list.innerHTML = messages.map((message, index) => `
    <div class="message-row" data-index="${index}">
      <div class="row-head"><span class="variant">Variant ${index + 1}</span><span class="counter" data-counter>${message.length}/${MAX_CHARS}</span></div>
      <textarea maxlength="${MAX_CHARS}" data-message aria-label="Variant ${index + 1}">${escapeHtml(message)}</textarea>
      <div class="row-actions">
        <div class="move-actions">
          <button class="icon-btn" type="button" data-action="up" aria-label="Move up" title="Move up" ${index === 0 ? "disabled" : ""}>↑</button>
          <button class="icon-btn" type="button" data-action="down" aria-label="Move down" title="Move down" ${index === messages.length - 1 ? "disabled" : ""}>↓</button>
        </div>
        <button class="delete-btn" type="button" data-action="delete">Delete message</button>
      </div>
    </div>
  `).join("");

  list.querySelectorAll("textarea[data-message]").forEach((field) => {
    field.addEventListener("input", () => {
      const row = field.closest(".message-row");
      row.querySelector("[data-counter]").textContent = `${field.value.length}/${MAX_CHARS}`;
      row.querySelector("[data-counter]").style.color = field.value.length >= MAX_CHARS ? "#b3261e" : "";
    });
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function readFields() {
  return [...list.querySelectorAll("textarea[data-message]")].map((field) => field.value.trim());
}

list.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const row = button.closest(".message-row");
  const index = Number(row.dataset.index);
  const action = button.dataset.action;

  // Keep any unsaved edits before reordering/deleting.
  messages = readFields();

  if (action === "delete") {
    if (messages.length === 1) {
      showStatus("At least one message is required.", true);
      return;
    }
    messages.splice(index, 1);
  } else if (action === "up" && index > 0) {
    [messages[index - 1], messages[index]] = [messages[index], messages[index - 1]];
  } else if (action === "down" && index < messages.length - 1) {
    [messages[index + 1], messages[index]] = [messages[index], messages[index + 1]];
  }
  render();
});

document.getElementById("add").addEventListener("click", () => {
  messages = readFields();
  messages.push("");
  render();
  list.lastElementChild?.querySelector("textarea")?.focus();
  showStatus("New message added. Write it and save changes.");
});

document.getElementById("save").addEventListener("click", async () => {
  const values = readFields();
  const tooLong = values.findIndex((message) => message.length > MAX_CHARS);
  if (!values.length || values.some((message) => !message)) {
    showStatus("Every message must contain text.", true);
    return;
  }
  if (tooLong >= 0) {
    showStatus(`Variant ${tooLong + 1} is over ${MAX_CHARS} characters.`, true);
    return;
  }
  messages = values;
  const existing = await chrome.storage.local.get(CONFIG_KEY);
  const config = existing[CONFIG_KEY] || {};
  await chrome.storage.local.set({ [CONFIG_KEY]: { ...config, messages } });
  showStatus(`${messages.length} message${messages.length === 1 ? "" : "s"} saved successfully.`);
  render();
});

chrome.storage.local.get(CONFIG_KEY).then((result) => {
  const saved = result[CONFIG_KEY]?.messages;
  const cleaned = Array.isArray(saved) ? saved.filter((message) => typeof message === "string" && message.trim()) : [];
  messages = cleaned.length ? cleaned : [...DEFAULT_MESSAGES];
  render();
});
