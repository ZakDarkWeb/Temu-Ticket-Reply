const DEFAULT_DELAY_MS = 2500;
const JOB_KEY_PREFIX = "temuTicketJob:";
const FAILURE_KEY = "temuTicketAutomationFailures";
const CONFIG_KEY = "temuTicketAutomationConfig";
const STATE_KEY = "temuTicketBatchState";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jobKey(tabId) {
  return `${JOB_KEY_PREFIX}${tabId}`;
}

async function setBadge(text, color = "#16803c") {
  await chrome.action.setBadgeText({ text: String(text).slice(0, 4) });
  await chrome.action.setBadgeBackgroundColor({ color });
}

async function updateBatchState(ticketId, success) {
  const stored = await chrome.storage.local.get(STATE_KEY);
  const state = stored[STATE_KEY];
  if (!state || !ticketId) return;

  const completedIds = new Set(Array.isArray(state.completedIds) ? state.completedIds : []);
  const reservedIds = new Set(Array.isArray(state.reservedIds) ? state.reservedIds : []);
  const reservedAt = { ...(state.reservedAt || {}) };
  reservedIds.delete(ticketId);
  delete reservedAt[ticketId];
  if (success) completedIds.add(ticketId);

  await chrome.storage.local.set({
    [STATE_KEY]: {
      signature: state.signature || "",
      completedIds: [...completedIds],
      reservedIds: [...reservedIds],
      reservedAt
    }
  });
}

// If an automation tab is closed by the user before reporting a result,
// drop its job and release the ticket reservation so it can be retried immediately.
chrome.tabs.onRemoved.addListener((tabId) => {
  (async () => {
    const stored = await chrome.storage.local.get(jobKey(tabId));
    const job = stored[jobKey(tabId)];
    if (!job) return;
    await chrome.storage.local.remove(jobKey(tabId));
    await updateBatchState(job.id, false);
  })().catch((error) => console.error("Tab cleanup failed", error));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;

  if (message.type === "OPEN_TICKET_AUTOMATION_TABS") {
    const jobs = Array.isArray(message.jobs) ? message.jobs : [];
    const delayMs = Number(message.delayMs) > 0 ? Number(message.delayMs) : DEFAULT_DELAY_MS;

    if (!jobs.length) {
      sendResponse({ ok: false, opened: 0, error: "No ticket jobs received." });
      return;
    }

    (async () => {
      let opened = 0;
      const openedIds = [];
      for (const job of jobs) {
        try {
          const tab = await chrome.tabs.create({ url: job.url, active: false });
          if (tab.id != null) {
            await chrome.storage.local.set({
              [jobKey(tab.id)]: {
                id: job.id,
                message: job.message,
                createdAt: Date.now()
              }
            });
            opened += 1;
            openedIds.push(job.id);
          }
        } catch (error) {
          console.error("Could not open automation tab", error);
        }
        if (opened < jobs.length) await sleep(delayMs);
      }
      await setBadge(opened, opened ? "#16803c" : "#b3261e");
      sendResponse({ ok: opened > 0, opened, requested: jobs.length, openedIds });
    })().catch((error) => {
      console.error("Ticket batch launcher failed", error);
      sendResponse({ ok: false, opened: 0, requested: jobs.length, openedIds: [] });
    });
    return true;
  }

  if (message.type === "GET_TICKET_JOB") {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ ok: false });
      return;
    }

    chrome.storage.local.get(jobKey(tabId)).then((result) => {
      const job = result[jobKey(tabId)];
      sendResponse({ ok: Boolean(job), job: job || null });
    });
    return true;
  }

  if (message.type === "TICKET_AUTOMATION_RESULT") {
    const tabId = sender.tab?.id;
    const job = message.job || {};
    const success = Boolean(message.success);

    if (tabId == null) {
      sendResponse({ ok: false });
      return;
    }

    (async () => {
      await chrome.storage.local.remove(jobKey(tabId));
      await updateBatchState(job.id, success);

      const configResult = await chrome.storage.local.get(CONFIG_KEY);
      const autoClose = configResult[CONFIG_KEY]?.autoClose !== false;

      if (success) {
        sendResponse({ ok: true, closed: autoClose });
        if (autoClose) {
          setTimeout(() => chrome.tabs.remove(tabId).catch(() => {}), 700);
        }
      } else {
        const stored = await chrome.storage.local.get(FAILURE_KEY);
        const failures = Array.isArray(stored[FAILURE_KEY]) ? stored[FAILURE_KEY] : [];
        failures.unshift({
          ticketId: job.id || "",
          message: message.error || "Unknown automation failure",
          url: sender.tab?.url || "",
          time: new Date().toISOString()
        });
        await chrome.storage.local.set({ [FAILURE_KEY]: failures.slice(0, 50) });
        sendResponse({ ok: true, closed: false });
      }
    })();
    return true;
  }
});
