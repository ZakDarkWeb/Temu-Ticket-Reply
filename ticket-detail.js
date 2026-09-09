const JOB_LOOKUP_RETRIES = 12;
const JOB_LOOKUP_DELAY_MS = 300;
const STEP_TIMEOUT_MS = 15000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isVisible(node) {
  if (!node) return false;
  const style = window.getComputedStyle(node);
  const rect = node.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
}

function visibleNodes(selector) {
  return [...document.querySelectorAll(selector)].filter(isVisible);
}

function findVisibleByText(text, selectors = "button, [role='button'], [role='option'], li, a, div, span") {
  const expected = text.trim().toLowerCase();
  // Try priority interactive elements first (button, role=button, a)
  const priorityNodes = visibleNodes("button, [role='button'], a, [role='option']");
  const priorityMatch = priorityNodes.find((node) => (node.textContent || "").trim().toLowerCase() === expected);
  if (priorityMatch) return priorityMatch;

  return visibleNodes(selectors).find((node) => (node.textContent || "").trim().toLowerCase() === expected) || null;
}

function findVisibleInput(placeholder) {
  return visibleNodes(`input[placeholder="${placeholder}"], textarea[placeholder="${placeholder}"]`)[0] || null;
}

function findVerificationDropdownTrigger() {
  // 1. Exact placeholder "Please select"
  const exact = findVisibleInput("Please select");
  if (exact) return exact;

  // 2. Partial placeholder containing "select"
  const partial = visibleNodes("input, textarea").find((node) => {
    const ph = (node.getAttribute("placeholder") || "").trim().toLowerCase();
    return ph.includes("select");
  });
  if (partial) return partial;

  // 3. Label containing "Verification" / "Verification result"
  const labels = visibleNodes("label, div, span").filter((node) => {
    const text = (node.textContent || "").trim().toLowerCase();
    return text.includes("verification") || text.includes("核实");
  });
  for (const label of labels) {
    const container = label.closest("div, tr, form") || label.parentElement;
    if (container) {
      const target = container.querySelector("input, [role='combobox'], [class*='select']");
      if (target && isVisible(target)) return target;
    }
  }

  // 4. Any combobox or select trigger visible in modal
  return visibleNodes("[role='combobox'], [class*='select-selection']")[0] || null;
}

function isAbleToShipAlreadySelected(trigger) {
  if (!trigger) return false;
  const value = String(trigger.value || "").trim().toLowerCase();
  if (value.includes("able to ship") || value.includes("可发货")) return true;

  const container = trigger.closest("[class*='select'], [class*='Select'], [role='combobox'], div");
  if (container) {
    const text = (container.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    if ((text.includes("able to ship") || text.includes("可发货")) && !text.includes("please select")) {
      return true;
    }
  }
  return false;
}

function triggerDropdownOpen(trigger) {
  if (!trigger) return;
  clickNode(trigger);

  // Also click parent select container if separate
  const container = trigger.closest("[class*='select'], [class*='Select'], [role='combobox'], div");
  if (container && container !== trigger) {
    const mouseOptions = { bubbles: true, cancelable: true, view: window, detail: 1 };
    try { container.dispatchEvent(new PointerEvent("pointerdown", { ...mouseOptions, pointerId: 1, pointerType: "mouse" })); } catch {}
    container.dispatchEvent(new MouseEvent("mousedown", mouseOptions));
    try { container.dispatchEvent(new PointerEvent("pointerup", { ...mouseOptions, pointerId: 1, pointerType: "mouse" })); } catch {}
    container.dispatchEvent(new MouseEvent("mouseup", mouseOptions));
    container.click?.();
  }

  // Also click arrow/chevron icon if present
  const arrow = (container || trigger.parentElement)?.querySelector("svg, i, [class*='arrow'], [class*='icon'], [class*='chevron']");
  if (arrow && isVisible(arrow)) {
    try { arrow.click(); } catch {}
  }
}

function findAbleToShipOption() {
  const targetPhrases = ["able to ship", "can ship", "able to deliver", "可以发货", "可发货"];
  const selectors = "div, span, li, p, [role='option'], [role='button'], button, [class*='option' i], [class*='item' i], [class*='select-item' i]";
  const nodes = visibleNodes(selectors);

  // Step A: Exact text match (ignoring whitespace and case)
  for (const phrase of targetPhrases) {
    const exactMatches = nodes.filter((node) => {
      const text = (node.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      return text === phrase;
    });

    if (exactMatches.length > 0) {
      const roleOption = exactMatches.find((n) => n.getAttribute("role") === "option" || /option|item/i.test(n.className || ""));
      return roleOption || exactMatches[exactMatches.length - 1];
    }
  }

  // Step B: Short partial match
  for (const phrase of targetPhrases) {
    const candidates = nodes.filter((node) => {
      const text = (node.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      return text.includes(phrase) && text.length <= 60;
    });

    if (candidates.length > 0) {
      candidates.sort((a, b) => (a.textContent || "").trim().length - (b.textContent || "").trim().length);
      return candidates[0];
    }
  }

  return null;
}

async function selectVerificationOption() {
  const trigger = await waitFor("verification dropdown", findVerificationDropdownTrigger);

  if (isAbleToShipAlreadySelected(trigger)) {
    return;
  }

  // Open the dropdown
  triggerDropdownOpen(trigger);

  // Wait for "Able to ship" option to appear with active re-click retry
  const start = Date.now();
  let lastClickTime = Date.now();
  let option = null;

  while (Date.now() - start < STEP_TIMEOUT_MS) {
    option = findAbleToShipOption();
    if (option) break;

    if (isAbleToShipAlreadySelected(trigger)) {
      return;
    }

    // Re-click if dropdown didn't open
    if (Date.now() - lastClickTime > 750) {
      triggerDropdownOpen(trigger);
      lastClickTime = Date.now();
    }

    await sleep(150);
  }

  if (!option) {
    throw new Error("Timed out waiting for Able to ship option");
  }

  clickNode(option);

  // Also click container if it's an option wrapper
  const optionWrapper = option.closest("[role='option'], [class*='option' i], [class*='item' i], li");
  if (optionWrapper && optionWrapper !== option) {
    try { optionWrapper.click(); } catch {}
  }

  await sleep(300);
}

function findRemarkInput() {
  const remark = findVisibleInput("Please input");
  if (remark) return remark;
  const textarea = visibleNodes("textarea")[0];
  if (textarea) return textarea;
  return visibleNodes("input[placeholder*='input' i], input[placeholder*='remark' i]")[0] || null;
}

async function waitFor(label, getter, timeout = STEP_TIMEOUT_MS) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = getter();
    if (value) return value;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function clickNode(node) {
  if (!node) throw new Error("Missing clickable element");
  node.scrollIntoView({ block: "center", inline: "center" });
  node.focus?.({ preventScroll: true });
  const mouseOptions = { bubbles: true, cancelable: true, view: window, detail: 1 };
  try { node.dispatchEvent(new PointerEvent("pointerdown", { ...mouseOptions, pointerId: 1, pointerType: "mouse" })); } catch {}
  node.dispatchEvent(new MouseEvent("mousedown", mouseOptions));
  try { node.dispatchEvent(new PointerEvent("pointerup", { ...mouseOptions, pointerId: 1, pointerType: "mouse" })); } catch {}
  node.dispatchEvent(new MouseEvent("mouseup", mouseOptions));
  node.click();
}

function findReplyModalConfirm() {
  const remark = findRemarkInput();
  if (remark) {
    let current = remark.parentElement;
    for (let level = 0; current && level < 10; level += 1, current = current.parentElement) {
      const hasReplyTitle = [...current.querySelectorAll("h1, h2, h3, [role='heading'], div, span")]
        .some((node) => isVisible(node) && (node.textContent || "").trim().toLowerCase() === "reply");
      const confirms = [...current.querySelectorAll("button, [role='button'], div, span")]
        .filter((node) => isVisible(node) && !node.disabled && node.getAttribute("aria-disabled") !== "true")
        .filter((node) => {
          const text = (node.textContent || "").trim().toLowerCase();
          const isBtn = node.tagName === "BUTTON" || node.getAttribute("role") === "button" || /button|btn/i.test(node.className || "");
          return text === "confirm" && (isBtn || node.tagName === "BUTTON");
        });
      if (hasReplyTitle && confirms.length) return confirms[confirms.length - 1];
    }
  }

  const fallback = visibleNodes("button, [role='button']")
    .filter((node) => !node.disabled && node.getAttribute("aria-disabled") !== "true")
    .filter((node) => (node.textContent || "").trim().toLowerCase() === "confirm");
  return fallback[fallback.length - 1] || null;
}

function setNativeValue(node, value) {
  const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  if (descriptor?.set) descriptor.set.call(node, value);
  else node.value = value;
  node.dispatchEvent(new Event("input", { bubbles: true }));
  node.dispatchEvent(new Event("change", { bubbles: true }));
  node.dispatchEvent(new Event("blur", { bubbles: true }));
}

async function getJob() {
  for (let attempt = 0; attempt < JOB_LOOKUP_RETRIES; attempt += 1) {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_TICKET_JOB" }, (result) => {
        if (chrome.runtime.lastError) resolve({ ok: false });
        else resolve(result || { ok: false });
      });
    });
    if (response?.ok && response.job) return response.job;
    await sleep(JOB_LOOKUP_DELAY_MS);
  }
  return null;
}

function getLatestEnabledDateCell() {
  const cells = visibleNodes("td[role='date-cell'], td[class*='date-cell'], td[class*='cell']").filter((cell) => {
    const classes = String(cell.className || "").toLowerCase();
    return !cell.getAttribute("aria-disabled") && !classes.includes("disabled") && !classes.includes("outofmonth");
  });
  return cells[cells.length - 1] || null;
}

function findDatePickerConfirm() {
  const picker = visibleNodes("[class*='outerPickerWrapper' i], [class*='picker' i], [class*='calendar' i]")[0];
  const candidates = picker
    ? [...picker.querySelectorAll("button, [role='button'], div, span")]
    : visibleNodes("button, [role='button'], div, span");
  return candidates
    .filter(isVisible)
    .find((node) => {
      const text = (node.textContent || "").trim().toLowerCase();
      const isBtn = node.tagName === "BUTTON" || node.getAttribute("role") === "button" || /button|btn/i.test(node.className || "");
      return text === "confirm" && isBtn && !node.disabled && node.getAttribute("aria-disabled") !== "true";
    }) || null;
}

async function chooseLatestDate() {
  const dateInput = await waitFor("shipment date field", () => findVisibleInput("Select Date") || visibleNodes("input[placeholder*='date' i]")[0]);
  clickNode(dateInput);

  // Wait for date picker cells with re-click retry
  const start = Date.now();
  let lastClick = Date.now();
  while (Date.now() - start < STEP_TIMEOUT_MS) {
    if (visibleNodes("td[role='date-cell'], [class*='date-cell'], td[class*='cell']").length > 0) break;
    if (Date.now() - lastClick > 800) {
      clickNode(dateInput);
      lastClick = Date.now();
    }
    await sleep(150);
  }

  const latestCell = await waitFor("latest enabled date", getLatestEnabledDateCell);
  const dateTarget = latestCell.querySelector("[title], div") || latestCell;
  clickNode(dateTarget);

  const pickerConfirm = await waitFor("date picker confirmation", findDatePickerConfirm);
  clickNode(pickerConfirm);

  const selectedDateInput = await waitFor("selected shipment date field", () => findVisibleInput("Select Date") || visibleNodes("input[placeholder*='date' i]")[0]);
  await waitFor("selected shipment date value", () => Boolean(selectedDateInput.value));
}

async function runAutomation(job) {
  const replyButton = await waitFor("Reply button", () => findVisibleByText("Reply", "button, [role='button'], a, div, span"));
  clickNode(replyButton);

  // Allow Reply modal to mount and stabilize
  await sleep(400);

  // Select "Able to ship"
  await selectVerificationOption();

  // Pick the latest shipment date
  await chooseLatestDate();

  // Commit 23:59:59 time
  const timeInput = await waitFor("shipment time field", () => findVisibleInput("Select Time") || visibleNodes("input[placeholder*='time' i]")[0]);
  setNativeValue(timeInput, "23:59:59");
  if (timeInput.value !== "23:59:59") {
    timeInput.removeAttribute("readonly");
    setNativeValue(timeInput, "23:59:59");
    timeInput.setAttribute("readonly", "");
  }
  if (timeInput.value !== "23:59:59") throw new Error("Shipment time could not be committed");

  // Remark message
  const remark = await waitFor("Remark box", findRemarkInput);
  setNativeValue(remark, job.message || "");

  const configKey = "temuTicketAutomationConfig";
  const configResult = await chrome.storage.local.get(configKey);
  const autoSubmit = configResult[configKey]?.autoSubmit !== false;

  if (autoSubmit) {
    const modalConfirm = await waitFor("reply submit button", findReplyModalConfirm);
    clickNode(modalConfirm);

    await sleep(1200);
    if (findRemarkInput()) {
      const retryConfirm = findReplyModalConfirm();
      if (retryConfirm) {
        clickNode(retryConfirm);
        await sleep(800);
      }
    }
    await waitFor("reply submission", () => !findRemarkInput() && !findVerificationDropdownTrigger(), 20000);
  } else {
    await waitFor("manual reply submission by user", () => !findRemarkInput() && !findVerificationDropdownTrigger(), 999999);
  }
}

(async () => {
  const job = await getJob();
  if (!job) return; // Do not affect manually opened detail pages.

  try {
    await runAutomation(job);
    chrome.runtime.sendMessage({ type: "TICKET_AUTOMATION_RESULT", success: true, job });
  } catch (error) {
    console.error("Temu ticket automation failed", error);
    chrome.runtime.sendMessage({
      type: "TICKET_AUTOMATION_RESULT",
      success: false,
      job,
      error: error?.message || "Unknown automation error"
    });
  }
})();
