import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { initDb } from "./db.js";
import { renderStrength } from "./strength.js";
import { renderPrehab } from "./prehab.js";
import { renderMobility } from "./mobility.js";
import { renderTracking } from "./tracking.js";

// ─── Firebase config ────────────────────────────────────────────────────────
// Paste your project's config below. The web API key is safe to commit; access
// is controlled by Firestore security rules (see README.md).
const firebaseConfig = {
  apiKey: "AIzaSyB_RCQJ8ne2zovph48cbKPXPyMqtYrUz9M",
  authDomain: "julias-training.firebaseapp.com",
  projectId: "julias-training",
  storageBucket: "julias-training.firebasestorage.app",
  messagingSenderId: "239298926809",
  appId: "1:239298926809:web:c438e01b18b145a1ecc6c8"
};
// ────────────────────────────────────────────────────────────────────────────

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const signinEl = document.getElementById("signin");
const appEl = document.getElementById("app");
const phaseStrip = document.getElementById("phase-strip");
const tabStrength = document.getElementById("tab-strength");
const tabPrehab = document.getElementById("tab-prehab");
const tabMobility = document.getElementById("tab-mobility");
const tabTracking = document.getElementById("tab-tracking");

document.getElementById("signin-btn").onclick = async () => {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    console.error(e);
    toast("Sign-in failed.");
  }
};

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    signinEl.classList.remove("hidden");
    appEl.classList.add("hidden");
    return;
  }
  signinEl.classList.add("hidden");
  appEl.classList.remove("hidden");
  initDb(app, user.uid);
  setupTabs();
  await activateTab("strength");
});

function setupTabs() {
  document.querySelectorAll(".tabbtn").forEach(btn => {
    btn.onclick = () => activateTab(btn.dataset.tab);
  });
}

async function activateTab(name) {
  document.querySelectorAll(".tabbtn").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  tabStrength.classList.toggle("hidden", name !== "strength");
  tabPrehab.classList.toggle("hidden", name !== "prehab");
  tabMobility.classList.toggle("hidden", name !== "mobility");
  tabTracking.classList.toggle("hidden", name !== "tracking");
  // The strength phase strip is only relevant on the Strength tab; Pre-hab and
  // Mobility render their own headers (Mobility shows its own phase/session strip).
  phaseStrip.classList.toggle("hidden", name !== "strength");
  try {
    if (name === "strength") await renderStrength(tabStrength, phaseStrip);
    else if (name === "prehab") await renderPrehab(tabPrehab);
    else if (name === "mobility") await renderMobility(tabMobility);
    else if (name === "tracking") await renderTracking(tabTracking);
  } catch (e) {
    console.error(e);
    toast("Error loading tab — check console.");
  }
}

// Toast helper exported for other modules
export function toast(msg) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 1800);
}

// Register service worker for "Add to Home Screen" support.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => { /* ignore on file:// */ });
  });
}
