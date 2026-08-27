document.getElementById("open-list").addEventListener("click", async () => {
  await chrome.tabs.create({ url: "https://seller.temu.com/ticket-list.html" });
  window.close();
});

document.getElementById("settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
