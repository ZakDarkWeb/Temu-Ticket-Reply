const BATCH_SIZE = 10;
const TAB_DELAY_MS = 2500;
const STATE_KEY = "temuTicketBatchState";
const CONFIG_KEY = "temuTicketAutomationConfig";
const DRAG_STATE_KEY = "temuTicketCardPosition";
const MINIMIZED_STATE_KEY = "temuTicketCardMinimized";
const CARD_ID = "temu-ticket-batch-card";
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

function getSessionId() {
  return new URL(window.location.href).searchParams.get("_x_sessn_id") || "";
}

function ticketUrl(ticketId) {
  const params = new URLSearchParams({
    ticket_id: ticketId,
    page: "1",
    size: "20",
    status: "1",
    sub_status: "100"
  });
  const sessionId = getSessionId();
  if (sessionId) params.set("_x_sessn_id", sessionId);
  return `${window.location.origin}/ticket-detail.html?${params.toString()}`;
}

function extractTicketId(value) {
  const digits = String(value || "").replace(/[^0-9]/g, "");
  const match = digits.match(/\d{13,20}/);
  return match ? match[0] : "";
}

function getTicketItems() {
  const items = [];
  const seen = new Set();

  for (const row of document.querySelectorAll("tbody tr")) {
    const viewNode = [...row.querySelectorAll("a, button")]
      .find((node) => (node.textContent || "").trim().toLowerCase() === "view");
    if (!viewNode) continue;

    const firstCell = row.querySelector("td, [role='cell']");
    const ticketId = extractTicketId(firstCell?.textContent || "");
    if (!ticketId || seen.has(ticketId)) continue;

    const href = viewNode.href || "";
    seen.add(ticketId);
    items.push({ id: ticketId, url: href.includes("ticket-detail.html") ? href : ticketUrl(ticketId) });
  }

  // Fallback for a client-rendered layout where rows are not standard table rows.
  if (!items.length) {
    for (const viewNode of document.querySelectorAll("a")) {
      if ((viewNode.textContent || "").trim().toLowerCase() !== "view") continue;
      const match = (viewNode.href || "").match(/[?&]ticket_id=(\d{13,20})/);
      if (!match || seen.has(match[1])) continue;
      seen.add(match[1]);
      items.push({ id: match[1], url: viewNode.href });
    }
  }

  return items;
}

function makeSignature(items) {
  return items.map((item) => item.id).join("|");
}

function setCardStatus(text, kind = "normal") {
  const card = document.getElementById(CARD_ID);
  if (!card) return;
  const status = card.querySelector("[data-status]");
  const dot = card.querySelector("[data-status-dot]");
  if (status) { status.textContent = text; status.dataset.kind = kind; }
  if (dot) dot.dataset.kind = kind;
}

async function releaseReservations(ticketIds) {
  if (!ticketIds.length) return;
  const stored = await chrome.storage.local.get(STATE_KEY);
  const state = stored[STATE_KEY];
  if (!state) return;
  const remove = new Set(ticketIds);
  const reservedIds = (state.reservedIds || []).filter((id) => !remove.has(id));
  const reservedAt = { ...(state.reservedAt || {}) };
  ticketIds.forEach((id) => delete reservedAt[id]);
  await chrome.storage.local.set({ [STATE_KEY]: { ...state, reservedIds, reservedAt } });
}

function clampCardPosition(card, left, top) {
  const rect = card.getBoundingClientRect();
  const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
  const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
  return {
    left: Math.min(Math.max(8, left), maxLeft),
    top: Math.min(Math.max(8, top), maxTop)
  };
}

async function restoreCardPosition(card) {
  const stored = await chrome.storage.local.get(DRAG_STATE_KEY);
  const position = stored[DRAG_STATE_KEY];
  if (!position || !Number.isFinite(position.left) || !Number.isFinite(position.top)) return;
  const safe = clampCardPosition(card, position.left, position.top);
  card.style.left = `${safe.left}px`;
  card.style.top = `${safe.top}px`;
  card.style.right = "auto";
}

function setMinimized(card, minimized) {
  card.classList.toggle("ttbo-minimized", minimized);
  const button = card.querySelector("[data-minimize]");
  if (button) {
    button.textContent = minimized ? "" : "−";
    button.setAttribute("aria-label", minimized ? "Restore automation card" : "Minimize automation card");
    button.title = minimized ? "Restore" : "Minimize";
  }
}

async function restoreCardState(card) {
  await restoreCardPosition(card);
  setMinimized(card, true);
}

function makeCardDraggable(card) {
  const handles = [...card.querySelectorAll("[data-drag-handle], [data-mini-drag-handle]")];
  if (!handles.length) return;

  function onWindowPointerMove(event) {
    if (!card._ttboDragging) return;
    const { offsetX, offsetY, startX, startY } = card._ttboDragging;
    // Use total distance from drag start — reliable even for slow/smooth drags
    const totalDist = Math.abs(event.clientX - startX) + Math.abs(event.clientY - startY);
    if (totalDist > 5) card._ttboDragging.moved = true;
    const safe = clampCardPosition(card, event.clientX - offsetX, event.clientY - offsetY);
    card.style.left = `${safe.left}px`;
    card.style.top = `${safe.top}px`;
  }

  async function onWindowPointerUp(event) {
    if (!card._ttboDragging) return;
    const { handle, moved } = card._ttboDragging;
    card._ttboDragging = null;
    card.classList.remove("ttbo-dragging");
    const rect = card.getBoundingClientRect();
    const safe = clampCardPosition(card, rect.left, rect.top);
    await chrome.storage.local.set({ [DRAG_STATE_KEY]: safe });
    if (moved) {
      // Block the upcoming click event so the card does not open after dragging
      const blockClick = (e) => { e.stopImmediatePropagation(); e.preventDefault(); };
      handle.addEventListener("click", blockClick, { capture: true, once: true });
    } else if (handle.matches("[data-mini-drag-handle]")) {
      // Pure tap (no movement) — open the card
      setMinimized(card, false);
      await chrome.storage.local.set({ [MINIMIZED_STATE_KEY]: false });
    }
  }

  window.addEventListener("pointermove", onWindowPointerMove);
  window.addEventListener("pointerup", onWindowPointerUp);
  window.addEventListener("pointercancel", () => {
    if (!card._ttboDragging) return;
    card._ttboDragging = null;
    card.classList.remove("ttbo-dragging");
  });

  for (const handle of handles) {
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const rect = card.getBoundingClientRect();
      // Pin card position so it doesn't jump during drag
      card.style.left = `${rect.left}px`;
      card.style.top = `${rect.top}px`;
      card.style.right = "auto";
      card.classList.add("ttbo-dragging");
      card._ttboDragging = {
        handle,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        moved: false
      };
      event.preventDefault();
    });
  }
}

function createCard() {
  if (document.getElementById(CARD_ID)) return;

  const card = document.createElement("section");
  card.id = CARD_ID;
  card.innerHTML = `
    <div class="ttbo-full">
      <div class="ttbo-header" data-drag-handle title="Drag to move">
        <div class="ttbo-header-left">
          <div class="ttbo-icon-wrap">
            <img class="ttbo-icon" src="${chrome.runtime.getURL("icons/icon128.png")}" alt="">
            <span class="ttbo-icon-dot"></span>
          </div>
          <div class="ttbo-header-text">
            <div class="ttbo-title">Ticket Automation</div>
            <div class="ttbo-badge">● LIVE</div>
          </div>
        </div>
        <button type="button" class="ttbo-minimize" data-minimize aria-label="Minimize" title="Minimize">
          <svg width="12" height="2" viewBox="0 0 12 2" fill="none"><rect width="12" height="2" rx="1" fill="currentColor"/></svg>
        </button>
      </div>

      <div class="ttbo-info-row">
        <div class="ttbo-chip">📦 10/batch</div>
        <div class="ttbo-chip">🔄 Auto-submit</div>
        <div class="ttbo-chip">✅ Auto-close</div>
      </div>

      <button type="button" class="ttbo-run-btn" data-open>
        <span class="ttbo-btn-icon">▶</span>
        <span>Run Next 10 Tickets</span>
      </button>

      <div class="ttbo-status-wrap">
        <span class="ttbo-status-dot" data-status-dot></span>
        <div class="ttbo-status" data-status>Ready — click to start automation.</div>
      </div>

      <div class="ttbo-footer">
        <span class="ttbo-drag-hint">⠿ Drag to move</span>
        <span class="ttbo-version">v2.3.1</span>
      </div>
    </div>
    <button type="button" class="ttbo-mini" data-mini-drag-handle aria-label="Restore automation card" title="Click to open · Drag to move">
      <img src="${chrome.runtime.getURL("icons/icon128.png")}" alt="">
    </button>
  `;

  const style = document.createElement("style");
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

    @keyframes ttbo-pulse-ring {
      0%   { transform: scale(0.92); opacity: 0.85; }
      50%  { transform: scale(1.10); opacity: 0.3; }
      100% { transform: scale(0.92); opacity: 0.85; }
    }
    @keyframes ttbo-pulse-glow {
      0%   { box-shadow: 0 0 0 0 rgba(255,106,0,0.6), 0 6px 20px rgba(255,106,0,0.4); }
      50%  { box-shadow: 0 0 0 10px rgba(255,106,0,0.0), 0 6px 28px rgba(255,106,0,0.2); }
      100% { box-shadow: 0 0 0 0 rgba(255,106,0,0.6), 0 6px 20px rgba(255,106,0,0.4); }
    }
    @keyframes ttbo-shimmer {
      0%   { background-position: -200% center; }
      100% { background-position: 200% center; }
    }
    @keyframes ttbo-badge-blink {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.4; }
    }
    @keyframes ttbo-dot-pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50%       { transform: scale(1.5); opacity: 0.6; }
    }
    @keyframes ttbo-slide-in {
      from { opacity: 0; transform: translateY(6px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    /* ── Card wrapper ── */
    #${CARD_ID} {
      position: fixed; top: 78px; right: 24px;
      width: 300px; box-sizing: border-box;
      background: #ffffff;
      border: 1px solid rgba(0,0,0,0.08);
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.06);
      z-index: 2147483647;
      font-family: 'Inter', Arial, sans-serif;
      color: #1a1a2e;
      user-select: none;
      overflow: hidden;
      transition: box-shadow 0.2s ease;
      animation: ttbo-slide-in 0.3s ease both;
    }
    #${CARD_ID}.ttbo-dragging {
      box-shadow: 0 16px 48px rgba(0,0,0,0.22), 0 4px 12px rgba(0,0,0,0.1);
      opacity: 0.96;
    }
    #${CARD_ID}.ttbo-minimized {
      width: 52px; height: 52px;
      background: transparent; border: none;
      box-shadow: none; overflow: visible;
      border-radius: 50%;
    }

    /* ── Dark header ── */
    #${CARD_ID} .ttbo-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 13px 14px 12px;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%);
      cursor: grab;
    }
    #${CARD_ID} .ttbo-header:active { cursor: grabbing; }
    #${CARD_ID} .ttbo-header-left { display: flex; align-items: center; gap: 10px; }

    /* Icon with live dot */
    #${CARD_ID} .ttbo-icon-wrap { position: relative; flex: 0 0 auto; }
    #${CARD_ID} .ttbo-icon {
      width: 38px; height: 38px; border-radius: 10px;
      object-fit: cover; display: block;
      border: 2px solid rgba(255,255,255,0.15);
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    #${CARD_ID} .ttbo-icon-dot {
      position: absolute; bottom: -1px; right: -1px;
      width: 10px; height: 10px; border-radius: 50%;
      background: #22c55e;
      border: 2px solid #16213e;
      animation: ttbo-dot-pulse 2s ease-in-out infinite;
    }

    #${CARD_ID} .ttbo-header-text { line-height: 1; }
    #${CARD_ID} .ttbo-title {
      font-size: 14px; font-weight: 700;
      color: #ffffff; letter-spacing: 0.01em;
    }
    #${CARD_ID} .ttbo-badge {
      display: inline-block; margin-top: 4px;
      font-size: 9px; font-weight: 600; letter-spacing: 0.08em;
      color: #22c55e;
      animation: ttbo-badge-blink 1.8s ease-in-out infinite;
    }

    /* Minimize button */
    #${CARD_ID} .ttbo-minimize {
      width: 26px; height: 26px; padding: 0;
      display: flex; align-items: center; justify-content: center;
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 8px;
      background: rgba(255,255,255,0.08);
      color: rgba(255,255,255,0.7);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
      flex: 0 0 auto;
    }
    #${CARD_ID} .ttbo-minimize:hover {
      background: rgba(255,255,255,0.18);
      color: #fff;
    }

    /* ── Body ── */
    #${CARD_ID} .ttbo-info-row {
      display: flex; gap: 6px; flex-wrap: wrap;
      padding: 10px 14px 0;
    }
    #${CARD_ID} .ttbo-chip {
      font-size: 10px; font-weight: 500;
      padding: 3px 8px; border-radius: 20px;
      background: #f1f5f9; color: #475569;
      border: 1px solid #e2e8f0;
      white-space: nowrap;
    }

    /* ── Run button ── */
    #${CARD_ID} .ttbo-run-btn {
      display: flex; align-items: center; justify-content: center; gap: 7px;
      width: calc(100% - 28px); margin: 12px 14px 0;
      border: 0; border-radius: 10px; padding: 11px 14px;
      background: linear-gradient(90deg, #ff6a00, #ff8c38, #ff6a00);
      background-size: 200% auto;
      color: #fff; font-size: 13px; font-weight: 700;
      font-family: inherit;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(255,106,0,0.4);
      transition: box-shadow 0.2s, transform 0.15s;
      animation: ttbo-shimmer 3s linear infinite;
      letter-spacing: 0.01em;
    }
    #${CARD_ID} .ttbo-run-btn:hover {
      box-shadow: 0 6px 20px rgba(255,106,0,0.55);
      transform: translateY(-1px);
    }
    #${CARD_ID} .ttbo-run-btn:active { transform: translateY(0); }
    #${CARD_ID} .ttbo-run-btn:disabled {
      background: #cbd5e1; box-shadow: none;
      animation: none; cursor: wait; transform: none;
    }
    #${CARD_ID} .ttbo-btn-icon { font-size: 11px; }

    /* ── Status ── */
    #${CARD_ID} .ttbo-status-wrap {
      display: flex; align-items: flex-start; gap: 6px;
      padding: 8px 14px 0; min-height: 28px;
    }
    #${CARD_ID} .ttbo-status-dot {
      width: 6px; height: 6px; border-radius: 50%; flex: 0 0 auto;
      margin-top: 3px; background: #94a3b8;
      transition: background 0.3s;
    }
    #${CARD_ID} .ttbo-status-dot[data-kind="ok"]    { background: #22c55e; }
    #${CARD_ID} .ttbo-status-dot[data-kind="error"] { background: #ef4444; }
    #${CARD_ID} .ttbo-status {
      font-size: 11px; line-height: 1.5; color: #64748b;
      transition: color 0.3s;
    }
    #${CARD_ID} .ttbo-status[data-kind="ok"]    { color: #15803d; }
    #${CARD_ID} .ttbo-status[data-kind="error"] { color: #b91c1c; }

    /* ── Footer ── */
    #${CARD_ID} .ttbo-footer {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 14px 12px; margin-top: 4px;
    }
    #${CARD_ID} .ttbo-drag-hint { font-size: 10px; color: #94a3b8; cursor: inherit; }
    #${CARD_ID} .ttbo-version {
      font-size: 10px; color: #cbd5e1; font-weight: 500;
    }

    /* ── Minimized hide/show ── */
    #${CARD_ID}.ttbo-minimized .ttbo-full { display: none; }
    #${CARD_ID}.ttbo-minimized .ttbo-mini { display: block; }

    /* ── Floating ball ── */
    #${CARD_ID} .ttbo-mini {
      display: none; position: relative;
      width: 52px; height: 52px;
      padding: 0; border: none; border-radius: 50%;
      background: radial-gradient(circle at 35% 30%, #ff9a3c, #ff6a00 55%, #c94900 90%);
      cursor: grab; touch-action: none; overflow: visible;
      animation: ttbo-pulse-glow 2.4s ease-in-out infinite;
    }
    #${CARD_ID} .ttbo-mini::before {
      content: '';
      position: absolute; inset: -8px; border-radius: 50%;
      border: 2.5px solid rgba(255,140,0,0.5);
      animation: ttbo-pulse-ring 2.4s ease-in-out infinite;
      pointer-events: none;
    }
    #${CARD_ID} .ttbo-mini::after {
      content: '';
      position: absolute; inset: -17px; border-radius: 50%;
      border: 1.5px solid rgba(255,140,0,0.22);
      animation: ttbo-pulse-ring 2.4s ease-in-out infinite 0.4s;
      pointer-events: none;
    }
    #${CARD_ID} .ttbo-mini:active { cursor: grabbing; animation: none; }
    #${CARD_ID} .ttbo-mini img {
      display: block; width: 100%; height: 100%;
      object-fit: cover; border-radius: 50%;
      pointer-events: none;
      border: 2.5px solid rgba(255,255,255,0.3);
    }
  `;
  document.documentElement.appendChild(style);
  document.body.appendChild(card);
  makeCardDraggable(card);
  restoreCardState(card).catch(() => {});

  card.querySelector("[data-minimize]").addEventListener("click", async (event) => {
    event.stopPropagation();
    setMinimized(card, true);
    await chrome.storage.local.set({ [MINIMIZED_STATE_KEY]: true });
  });

  // Mini button open/restore is handled in onWindowPointerUp (drag-aware).

  card.querySelector("[data-open]").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    setCardStatus("Preparing the next 10 tickets...", "normal");

    try {
      let allItems = getTicketItems();
      for (let attempt = 1; !allItems.length && attempt <= 3; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        allItems = getTicketItems();
      }

      if (!allItems.length) {
        setCardStatus("No tickets detected. Wait for rows to appear, then click again.", "error");
        return;
      }

      const signature = makeSignature(allItems);
      const stored = await chrome.storage.local.get(STATE_KEY);
      const previous = stored[STATE_KEY] || {};
      const sameList = previous.signature === signature;
      const completedIds = new Set(sameList && Array.isArray(previous.completedIds) ? previous.completedIds : []);
      const now = Date.now();
      const oldReservedAt = sameList && previous.reservedAt ? previous.reservedAt : {};
      const reservedIds = new Set(
        sameList && Array.isArray(previous.reservedIds)
          ? previous.reservedIds.filter((id) => now - Number(oldReservedAt[id] || now) < 10 * 60 * 1000)
          : []
      );

      const pendingItems = allItems.filter((item) => !completedIds.has(item.id) && !reservedIds.has(item.id));
      if (!pendingItems.length) {
        if (completedIds.size >= allItems.length) {
          await chrome.storage.local.set({ [STATE_KEY]: { signature, completedIds: [], reservedIds: [], reservedAt: {} } });
          setCardStatus("All tickets in this list are complete. Click again to restart from the first 10.");
        } else {
          setCardStatus("The current batch is still processing. Wait or inspect any open ticket tabs.");
        }
        return;
      }

      const configResult = await chrome.storage.local.get(CONFIG_KEY);
      const savedMessages = configResult[CONFIG_KEY]?.messages;
      const messages = Array.isArray(savedMessages)
        ? DEFAULT_MESSAGES.map((fallback, index) => savedMessages[index] || fallback)
        : DEFAULT_MESSAGES;
      const jobs = pendingItems.slice(0, BATCH_SIZE).map((item) => {
        const originalIndex = allItems.findIndex((candidate) => candidate.id === item.id);
        return {
          id: item.id,
          url: item.url,
          message: messages[originalIndex % messages.length]
        };
      });
      const start = allItems.findIndex((item) => item.id === jobs[0].id) + 1;
      const end = start + jobs.length - 1;
      const nextReservedIds = new Set(reservedIds);
      const nextReservedAt = { ...oldReservedAt };
      jobs.forEach((job) => {
        nextReservedIds.add(job.id);
        nextReservedAt[job.id] = now;
      });
      await chrome.storage.local.set({
        [STATE_KEY]: {
          signature,
          completedIds: [...completedIds],
          reservedIds: [...nextReservedIds],
          reservedAt: nextReservedAt
        }
      });

      chrome.runtime.sendMessage({ type: "OPEN_TICKET_AUTOMATION_TABS", jobs, delayMs: TAB_DELAY_MS }, async (result) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          await releaseReservations(jobs.map((job) => job.id));
          setCardStatus("Extension error. Reload the page and try again.", "error");
          return;
        }
        const openedIds = new Set(result?.openedIds || []);
        const notOpened = jobs.map((job) => job.id).filter((id) => !openedIds.has(id));
        await releaseReservations(notOpened);
        if (result?.opened) {
          setCardStatus(`${result.opened} automation tabs started. Batch ${start}-${end} of ${allItems.length}.`, "ok");
        } else {
          setCardStatus("No automation tab could be opened. Reload and try again.", "error");
        }
      });
    } catch (error) {
      console.error("Temu Ticket Automation error", error);
      setCardStatus("Automation error. Reload the page and try again.", "error");
    } finally {
      setTimeout(() => { button.disabled = false; }, 1500);
    }
  });
}

// Only inject the card; ticket rows are scanned after the user clicks.
createCard();
