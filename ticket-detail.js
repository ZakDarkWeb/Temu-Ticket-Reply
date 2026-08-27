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

function findVisibleByText(text, selectors = "button, [role='button'], [role='option'], li") {
  const expected = text.trim().toLowerCase();
  return visibleNodes(selectors).find((node) => (node.textContent || "").trim().toLowerCase() === expected) || null;
}

function findVisibleInput(placeholder) {
  return visibleNodes(`input[placeholder="${placeholder}"], textarea[placeholder="${placeholder}"]`)[0] || null;
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
  const remark = findVisibleInput("Please input");
  if (remark) {
    let current = remark.parentElement;
    for (let level = 0; current && level < 10; level += 1, current = current.parentElement) {
      const hasReplyTitle = [...current.querySelectorAll("h1, h2, h3, [role='heading'], div, span")]
        .some((node) => isVisible(node) && (node.textContent || "").trim().toLowerCase() === "reply");
      const confirms = [...current.querySelectorAll("button, [role='button']")]
        .filter((node) => isVisible(node) && !node.disabled && node.getAttribute("aria-disabled") !== "true")
        .filter((node) => (node.textContent || "").trim().toLowerCase() === "confirm");
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
  const cells = visibleNodes("td[role='date-cell']").filter((cell) => {
    const classes = String(cell.className || "").toLowerCase();
    return !cell.getAttribute("aria-disabled") && !classes.includes("disabled") && !classes.includes("outofmonth");
  });
  return cells[cells.length - 1] || null;
}

function findDatePickerConfirm() {
  const picker = visibleNodes("[class*='RPR_outerPickerWrapper']")[0];
  const candidates = picker
    ? [...picker.querySelectorAll("button, [role='button']")]
    : visibleNodes("button, [role='button']");
  return candidates
    .filter(isVisible)
    .find((node) => {
      const text = (node.textContent || "").trim().toLowerCase();
      return text === "confirm" && !node.disabled && node.getAttribute("aria-disabled") !== "true";
    }) || null;
}

async function chooseLatestDate() {
  const dateInput = await waitFor("shipment date field", () => findVisibleInput("Select Date"));
  clickNode(dateInput);
  await waitFor("date picker", () => visibleNodes("td[role='date-cell']").length > 0);
  const latestCell = await waitFor("latest enabled date", getLatestEnabledDateCell);
  // The click handler is attached to Temu's inner date div, not reliably to the td wrapper.
  const dateTarget = latestCell.querySelector("[title], div") || latestCell;
  clickNode(dateTarget);

  // Temu's date picker has a disabled-until-selected Confirm button inside RPR_outerPickerWrapper.
  const pickerConfirm = await waitFor("date picker confirmation", findDatePickerConfirm);
  clickNode(pickerConfirm);
  const selectedDateInput = await waitFor("selected shipment date field", () => findVisibleInput("Select Date"));
  await waitFor("selected shipment date value", () => Boolean(selectedDateInput.value));

}

async function runAutomation(job) {
  const replyButton = await waitFor("Reply button", () => findVisibleByText("Reply", "button, [role='button']"));
  clickNode(replyButton);

  const verificationInput = await waitFor("verification dropdown", () => findVisibleInput("Please select"));
  clickNode(verificationInput);
  const ableToShip = await waitFor("Able to ship option", () => findVisibleByText("Able to ship"));
  clickNode(ableToShip);

  await chooseLatestDate();

  const timeInput = await waitFor("shipment time field", () => findVisibleInput("Select Time"));
  setNativeValue(timeInput, "23:59:59");
  if (timeInput.value !== "23:59:59") {
    timeInput.removeAttribute("readonly");
    setNativeValue(timeInput, "23:59:59");
    timeInput.setAttribute("readonly", "");
  }
  if (timeInput.value !== "23:59:59") throw new Error("Shipment time could not be committed");

  const remark = await waitFor("Remark box", () => findVisibleInput("Please input"));
  setNativeValue(remark, job.message || "");

  // This is Temu's final submit button. It is intentionally automatic per user instruction.
  const modalConfirm = await waitFor("reply submit button", findReplyModalConfirm);
  clickNode(modalConfirm);

  // Allow Temu's submit handler to finish before considering a fallback click.
  await sleep(1200);
  if (findVisibleInput("Please input")) {
    const retryConfirm = findReplyModalConfirm();
    if (retryConfirm) {
      clickNode(retryConfirm);
      await sleep(800);
    }
  }

  // Closing the Reply modal is the success signal. If it stays open, leave the tab open for review.
  await waitFor("reply submission", () => !findVisibleInput("Please input") && !findVisibleInput("Please select"), 20000);
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
