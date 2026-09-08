// 担当選択画面（左サイドのメニュードロワー + 全体一覧）

import { requireAuth, logout } from "./auth.js";
import { STORES, STORE_ID, setStoreId } from "./firebase-config.js";
import { initOverview } from "./overviewView.js";

// ---- 店舗切替プルダウン ----
const storeSelect = document.getElementById("store-select");
STORES.forEach((s) => {
  const o = document.createElement("option");
  o.value = s.id;
  o.textContent = s.name;
  storeSelect.appendChild(o);
});
storeSelect.value = STORE_ID;
storeSelect.addEventListener("change", () => {
  if (setStoreId(storeSelect.value)) location.reload();
});

// ---- メニュードロワー（左サイド） ----
const drawer = document.getElementById("drawer");
const overlay = document.getElementById("drawer-overlay");
function openDrawer() {
  drawer.classList.add("open");
  overlay.classList.add("open");
}
function closeDrawer() {
  drawer.classList.remove("open");
  overlay.classList.remove("open");
}
document.getElementById("menu-btn").addEventListener("click", openDrawer);
document.getElementById("drawer-close").addEventListener("click", closeDrawer);
overlay.addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDrawer();
});

document.getElementById("logout-btn").addEventListener("click", () => logout());

// ---- 全体一覧 ----
requireAuth(() => {
  initOverview({
    table: document.getElementById("ov-table"),
    rangeLabel: document.getElementById("ov-range"),
    prev: document.getElementById("ov-prev"),
    next: document.getElementById("ov-next"),
  });
});
