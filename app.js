// app.js — HisabCloud Pro Engine (Custom Slots, Profile Photo, Gemini Vision & NLP, Smart Split, Charts & PDF)
import { auth, db, getActiveGeminiKey } from "./firebase-config.js";
import {
  GoogleAuthProvider,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ==================== TEMPLATES FOR INSTANT CUSTOMIZATION ====================
const WORKSPACE_TEMPLATES = {
  mess: {
    slots: ["Morning", "Noon", "Afternoon", "Night"],
    presets: [
      { slotIndex: 0, text: "20 (Breakfast)" },
      { slotIndex: 1, text: "60 (Lunch)" },
      { slotIndex: 2, text: "15 (Tea & Snacks)" },
      { slotIndex: 3, text: "45 (Dinner)" }
    ]
  },
  flat: {
    slots: ["Groceries", "Rent & Wi-Fi", "Electricity", "Household"],
    presets: [
      { slotIndex: 0, text: "150 (Vegetables)" },
      { slotIndex: 1, text: "500 (Wi-Fi Bill)" },
      { slotIndex: 2, text: "300 (Electric)" },
      { slotIndex: 3, text: "80 (Gas / Water)" }
    ]
  },
  trip: {
    slots: ["Food & Drinks", "Transport", "Hotel / Stay", "Tickets"],
    presets: [
      { slotIndex: 0, text: "250 (Group Meal)" },
      { slotIndex: 1, text: "120 (Cab / Fuel)" },
      { slotIndex: 2, text: "800 (Room)" },
      { slotIndex: 3, text: "100 (Entry Pass)" }
    ]
  },
  personal: {
    slots: ["Food", "Travel", "Bills", "Shopping"],
    presets: [
      { slotIndex: 0, text: "50 (Meal)" },
      { slotIndex: 1, text: "30 (Commute)" },
      { slotIndex: 2, text: "199 (Recharge)" },
      { slotIndex: 3, text: "200 (Essentials)" }
    ]
  }
};

// ==================== GLOBAL STATE ====================
let currentUser = null;
let userProfile = null;
let workspaces = [];
let activeWorkspaceId = null;
let rawData = [];
let currentActiveRows = [];
let activeEditDocId = null;
let weekOffset = 0;
let lastSyncedDateStr = "";
let unsubWorkspaces = null;
let unsubEntries = null;

let onboardAvatarDataUrl = "";
let profModalAvatarDataUrl = "";
let isEmailSignUp = true;

let catChartInstance = null;
let trendChartInstance = null;
const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ==================== TOAST & IMAGE COMPRESSOR ====================
function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  t.innerText = msg;
  t.style.background = type === "error" ? "#f43f5e" : "#10b981";
  t.style.color = type === "error" ? "#fff" : "#050a0e";
  t.style.display = "block";
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    t.style.display = "none";
  }, 2800);
}
window.showToast = showToast;

function compressImage(file, maxDim = 900, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({ dataUrl, base64: dataUrl.split(",")[1], mime: "image/jpeg" });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ==================== 1. SECRET CALCULATOR & STEALTH BLUR ====================
let calcExpression = "";

function getSecretPin() {
  return userProfile?.calcPin || localStorage.getItem("hisabcloud_pin") || "2007";
}

window.calcAppend = (val) => {
  if (calcExpression === "Error") calcExpression = "";
  calcExpression += val;
  document.getElementById("calcScreen").innerText = calcExpression || "0";
};

window.calcClear = () => {
  calcExpression = "";
  document.getElementById("calcHistory").innerText = "";
  document.getElementById("calcScreen").innerText = "0";
};

window.calcBack = () => {
  if (calcExpression === "Error") calcExpression = "";
  calcExpression = calcExpression.slice(0, -1);
  document.getElementById("calcScreen").innerText = calcExpression || "0";
};

window.calcEquals = () => {
  if (calcExpression === getSecretPin()) {
    window.calcClear();
    document.getElementById("calcLockScreen").classList.add("unlocked");
    showToast("Vault Unlocked");
    return;
  }
  try {
    if (!calcExpression) return;
    document.getElementById("calcHistory").innerText = calcExpression;
    const sanitized = calcExpression.replace(/[^0-9+\-*/.%]/g, "");
    const result = Function('"use strict";return (' + sanitized + ")")();
    calcExpression = String(Number.isFinite(result) ? Number(result.toFixed(6)) : "Error");
    document.getElementById("calcScreen").innerText = calcExpression;
  } catch (e) {
    calcExpression = "Error";
    document.getElementById("calcScreen").innerText = "Error";
  }
};

window.lockVault = () => {
  window.calcClear();
  document.getElementById("calcLockScreen").classList.remove("unlocked");
};

window.toggleStealthBlur = () => {
  const isBlurred = document.body.classList.toggle("stealth-blur");
  const btn = document.getElementById("eyeToggleBtn");
  btn.classList.toggle("active-eye", isBlurred);
  btn.innerText = isBlurred ? "🙈" : "👁️";
};

// ==================== 2. AUTHENTICATION (GOOGLE + EMAIL) ====================
const googleProvider = new GoogleAuthProvider();

document.getElementById("googleSignInBtn").onclick = async () => {
  const errBox = document.getElementById("authErrorBox");
  errBox.classList.add("hidden");
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    errBox.textContent = err.message || "Google Sign-In failed.";
    errBox.classList.remove("hidden");
  }
};

document.getElementById("toggleAuthModeBtn").onclick = () => {
  isEmailSignUp = !isEmailSignUp;
  document.getElementById("emailAuthSubmitBtn").textContent = isEmailSignUp ? "Create Account →" : "Sign In →";
  document.getElementById("toggleAuthModeBtn").textContent = isEmailSignUp
    ? "Already have an account? Sign In"
    : "New user? Create a new account";
};

document.getElementById("emailAuthForm").onsubmit = async (e) => {
  e.preventDefault();
  const email = document.getElementById("authEmail").value.trim();
  const pass = document.getElementById("authPassword").value;
  const errBox = document.getElementById("authErrorBox");
  errBox.classList.add("hidden");

  try {
    if (isEmailSignUp) {
      await createUserWithEmailAndPassword(auth, email, pass);
    } else {
      await signInWithEmailAndPassword(auth, email, pass);
    }
  } catch (err) {
    if (err.code === "auth/email-already-in-use") {
      try {
        await signInWithEmailAndPassword(auth, email, pass);
        return;
      } catch (e2) {
        errBox.textContent = e2.message;
      }
    } else {
      errBox.textContent = err.message;
    }
    errBox.classList.remove("hidden");
  }
};

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (!user) {
    document.getElementById("authScreen").classList.remove("hidden");
    document.getElementById("onboardingScreen").classList.add("hidden");
    document.getElementById("mainAppContainer").classList.add("hidden");
    document.getElementById("bottomNavBar").classList.add("hidden");
    return;
  }

  const profileSnap = await getDoc(doc(db, "users", user.uid));
  if (!profileSnap.exists() || !profileSnap.data().onboardingDone) {
    openOnboarding(user);
  } else {
    userProfile = profileSnap.data();
    launchDashboard();
  }
});

// ==================== 3. REAL ACCOUNT PROFILE SETUP (ONBOARDING) ====================
function openOnboarding(user) {
  document.getElementById("authScreen").classList.add("hidden");
  document.getElementById("mainAppContainer").classList.add("hidden");
  document.getElementById("bottomNavBar").classList.add("hidden");
  document.getElementById("onboardingScreen").classList.remove("hidden");

  const defaultPic = user.photoURL || `https://api.dicebear.com/8.x/avataaars/svg?seed=${user.uid.slice(0, 6)}`;
  onboardAvatarDataUrl = defaultPic;
  document.getElementById("onboardAvatarImg").src = defaultPic;
  document.getElementById("onboardFullName").value = user.displayName || "";
}

document.getElementById("onboardAvatarFile").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const compressed = await compressImage(file, 250, 0.85);
  onboardAvatarDataUrl = compressed.dataUrl;
  document.getElementById("onboardAvatarImg").src = compressed.dataUrl;
};

document.getElementById("finishOnboardingBtn").onclick = async () => {
  const fullName = document.getElementById("onboardFullName").value.trim();
  const currency = document.getElementById("onboardCurrency").value;
  const wsName = document.getElementById("onboardWsName").value.trim();
  const templateKey = document.getElementById("onboardTemplate").value;
  const upiId = document.getElementById("onboardUpi").value.trim();
  const budgetLimit = Number(document.getElementById("onboardBudget").value) || 5000;
  const membersRaw = document.getElementById("onboardMembers").value.trim();

  if (!fullName || !wsName) {
    showToast("Enter your Name and Workspace Name", "error");
    return;
  }

  const extraMembers = membersRaw ? membersRaw.split(",").map((m) => m.trim()).filter(Boolean) : [];
  const members = Array.from(new Set([fullName, ...extraMembers]));
  const tpl = WORKSPACE_TEMPLATES[templateKey] || WORKSPACE_TEMPLATES.mess;

  userProfile = {
    uid: currentUser.uid,
    email: currentUser.email,
    fullName,
    currency,
    upiId,
    photoUrl: onboardAvatarDataUrl,
    calcPin: "2007",
    onboardingDone: true,
    createdAt: serverTimestamp()
  };

  await setDoc(doc(db, "users", currentUser.uid), userProfile, { merge: true });

  await addDoc(collection(db, "users", currentUser.uid, "workspaces"), {
    name: wsName,
    slots: tpl.slots,
    presets: tpl.presets,
    members,
    upiId,
    budgetLimit,
    createdAt: serverTimestamp()
  });

  showToast("Account & Workspace Created!");
  launchDashboard();
};

function launchDashboard() {
  document.getElementById("authScreen").classList.add("hidden");
  document.getElementById("onboardingScreen").classList.add("hidden");
  document.getElementById("mainAppContainer").classList.remove("hidden");
  document.getElementById("bottomNavBar").classList.remove("hidden");

  syncDateIfNeeded(true);
  updateProfileUI();
  subscribeWorkspaces();

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      syncDateIfNeeded(false);
      renderTable();
    }
  });
}

function updateProfileUI() {
  if (!userProfile) return;
  document.getElementById("topbarAvatarImg").src =
    userProfile.photoUrl || "https://api.dicebear.com/8.x/avataaars/svg?seed=User";
}

function getCurrency() {
  return userProfile?.currency || "₹";
}

// ==================== 4. PROFILE & ACCOUNT SETTINGS MODAL ====================
window.openProfileSettings = () => {
  if (!userProfile) return;
  profModalAvatarDataUrl = userProfile.photoUrl || "";
  document.getElementById("profModalAvatarImg").src = profModalAvatarDataUrl;
  document.getElementById("profModalEmail").innerText = currentUser.email || "";
  document.getElementById("profModalName").value = userProfile.fullName || "";
  document.getElementById("profModalCurrency").value = userProfile.currency || "₹";
  document.getElementById("profModalUpi").value = userProfile.upiId || "";
  document.getElementById("profModalPin").value = userProfile.calcPin || "";
  document.getElementById("profModalGeminiKey").value = localStorage.getItem("hisabcloud_custom_gemini_key") || "";
  document.getElementById("profileModal").classList.add("show");
};

document.getElementById("openProfileModalBtn").onclick = window.openProfileSettings;

window.closeProfileModal = () => {
  document.getElementById("profileModal").classList.remove("show");
};

document.getElementById("profModalAvatarFile").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const compressed = await compressImage(file, 250, 0.85);
  profModalAvatarDataUrl = compressed.dataUrl;
  document.getElementById("profModalAvatarImg").src = compressed.dataUrl;
};

document.getElementById("saveProfileSettingsBtn").onclick = async () => {
  const fullName = document.getElementById("profModalName").value.trim() || userProfile.fullName;
  const currency = document.getElementById("profModalCurrency").value;
  const upiId = document.getElementById("profModalUpi").value.trim();
  const pinVal = document.getElementById("profModalPin").value.trim();
  const customGemini = document.getElementById("profModalGeminiKey").value.trim();

  if (pinVal && !/^\d{3,8}$/.test(pinVal)) {
    showToast("Calculator PIN must be 3 to 8 digits", "error");
    return;
  }

  if (customGemini) localStorage.setItem("hisabcloud_custom_gemini_key", customGemini);
  else localStorage.removeItem("hisabcloud_custom_gemini_key");

  userProfile = {
    ...userProfile,
    fullName,
    currency,
    upiId,
    photoUrl: profModalAvatarDataUrl,
    calcPin: pinVal || userProfile.calcPin || "2007"
  };

  await setDoc(doc(db, "users", currentUser.uid), userProfile, { merge: true });
  updateProfileUI();
  renderTable();
  window.closeProfileModal();
  showToast("Profile & Settings Saved!");
};

document.getElementById("exportBackupJsonBtn").onclick = () => {
  const backup = {
    exportedAt: new Date().toISOString(),
    profile: userProfile,
    workspace: getActiveWorkspace(),
    records: rawData
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `HisabCloud_Backup_${getLocalTodayISO()}.json`;
  a.click();
};

document.getElementById("signOutAccountBtn").onclick = async () => {
  window.closeProfileModal();
  await signOut(auth);
};

// ==================== 5. WORKSPACES & FULL CUSTOMIZATION ====================
function subscribeWorkspaces() {
  if (unsubWorkspaces) unsubWorkspaces();
  const q = query(collection(db, "users", currentUser.uid, "workspaces"), orderBy("createdAt", "asc"));
  unsubWorkspaces = onSnapshot(q, async (snap) => {
    workspaces = [];
    snap.forEach((d) => workspaces.push({ id: d.id, ...d.data() }));

    if (workspaces.length === 0) {
      const tpl = WORKSPACE_TEMPLATES.mess;
      await addDoc(collection(db, "users", currentUser.uid, "workspaces"), {
        name: "My Ledger",
        slots: tpl.slots,
        presets: tpl.presets,
        members: [userProfile.fullName || "Me"],
        upiId: userProfile.upiId || "",
        budgetLimit: 5000,
        createdAt: serverTimestamp()
      });
      return;
    }

    if (!activeWorkspaceId || !workspaces.some((w) => w.id === activeWorkspaceId)) {
      activeWorkspaceId = workspaces[0].id;
    }

    renderWorkspaceDropdown();
    loadActiveWorkspace();
  });
}

function getActiveWorkspace() {
  return workspaces.find((w) => w.id === activeWorkspaceId) || workspaces[0];
}

function renderWorkspaceDropdown() {
  const sel = document.getElementById("workspaceSelect");
  sel.innerHTML = workspaces
    .map((ws) => `<option value="${ws.id}">${escapeHtml(ws.name)}</option>`)
    .join("");
  sel.value = activeWorkspaceId;
}

document.getElementById("workspaceSelect").onchange = (e) => {
  activeWorkspaceId = e.target.value;
  loadActiveWorkspace();
};

function loadActiveWorkspace() {
  const ws = getActiveWorkspace();
  if (!ws) return;

  document.getElementById("topbarSubtitle").innerText = `${userProfile.fullName} • ${ws.members.length} Member(s)`;
  document.getElementById("editWsNameInput").value = ws.name || "";
  document.getElementById("editWsUpiInput").value = ws.upiId || "";

  renderDynamicEntryForm(ws);
  renderCustomizationTab(ws);

  if (unsubEntries) unsubEntries();
  const q = query(
    collection(db, "users", currentUser.uid, "workspaces", ws.id, "entries"),
    orderBy("createdAt", "desc")
  );
  unsubEntries = onSnapshot(q, (snap) => {
    rawData = [];
    snap.forEach((d) => rawData.push({ docId: d.id, ...d.data() }));
    loadEntryForSelectedDate();
    renderTable();
  });
}

// Create New Workspace Modal
document.getElementById("openNewWsModalBtn").onclick = () => {
  document.getElementById("newWsModal").classList.add("show");
};
window.closeNewWsModal = () => {
  document.getElementById("newWsModal").classList.remove("show");
};
document.getElementById("createNewWsSubmitBtn").onclick = async () => {
  const name = document.getElementById("newWsNameInput").value.trim();
  const tplKey = document.getElementById("newWsTemplateSelect").value;
  const membersRaw = document.getElementById("newWsMembersInput").value.trim();
  if (!name) return showToast("Enter a workspace name", "error");

  const extra = membersRaw ? membersRaw.split(",").map((m) => m.trim()).filter(Boolean) : [];
  const members = Array.from(new Set([userProfile.fullName, ...extra]));
  const tpl = WORKSPACE_TEMPLATES[tplKey] || WORKSPACE_TEMPLATES.mess;

  const ref = await addDoc(collection(db, "users", currentUser.uid, "workspaces"), {
    name,
    slots: tpl.slots,
    presets: tpl.presets,
    members,
    upiId: userProfile.upiId || "",
    budgetLimit: 5000,
    createdAt: serverTimestamp()
  });

  activeWorkspaceId = ref.id;
  document.getElementById("newWsNameInput").value = "";
  document.getElementById("newWsMembersInput").value = "";
  window.closeNewWsModal();
  showToast(`Created "${name}"`);
};

// Render Customizable Entry Form Slots & Presets
function renderDynamicEntryForm(ws) {
  const slots = ws.slots || ["Morning", "Noon", "Afternoon", "Night"];
  const presets = ws.presets || [];
  const members = ws.members || [userProfile.fullName];

  // Paid By dropdown
  const paidSel = document.getElementById("entryPaidBy");
  paidSel.innerHTML = members.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");

  // Quick Presets Chips
  const presetsBar = document.getElementById("quickPresetsBar");
  presetsBar.innerHTML = "";
  presets.forEach((p) => {
    const slotName = slots[p.slotIndex] || slots[0];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preset-chip";
    btn.innerText = `+ ${getCurrency()}${p.text}`;
    btn.onclick = () => {
      const targetInput = document.getElementById(`slot_input_${p.slotIndex}`);
      if (targetInput) {
        targetInput.value = p.text;
        calcPreview();
        showToast(`Added ${p.text} to ${slotName}`);
      }
    };
    presetsBar.appendChild(btn);
  });

  // Dynamic Slots Inputs
  const grid = document.getElementById("dynamicSlotsGrid");
  grid.innerHTML = "";
  slots.forEach((slotLabel, idx) => {
    const field = document.createElement("div");
    field.className = "field";
    field.innerHTML = `
      <label>${escapeHtml(slotLabel)}</label>
      <input type="text" class="smart-input slot-val-input blur-sensitive" id="slot_input_${idx}" data-slot="${escapeHtml(slotLabel)}" placeholder="e.g. 50 (${escapeHtml(slotLabel)})" />
    `;
    grid.appendChild(field);
    attachSmartListener(field.querySelector("input"));
  });

  resetOthersContainer("othersContainer", []);
}

// Render Customization Tab Controls
function renderCustomizationTab(ws) {
  const slots = ws.slots || [];
  const presets = ws.presets || [];
  const members = ws.members || [];

  // Custom Slots Chips
  const slotsWrap = document.getElementById("customSlotsChips");
  slotsWrap.innerHTML = "";
  slots.forEach((s, idx) => {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.innerHTML = `${escapeHtml(s)} <button type="button" title="Remove">✕</button>`;
    chip.querySelector("button").onclick = async () => {
      if (slots.length <= 1) return showToast("Keep at least 1 slot", "error");
      const updated = slots.filter((_, i) => i !== idx);
      await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id), { slots: updated });
    };
    slotsWrap.appendChild(chip);
  });

  // Preset Target Slot Selector & Chips
  const targetSlotSel = document.getElementById("presetTargetSlot");
  targetSlotSel.innerHTML = slots.map((s, idx) => `<option value="${idx}">${escapeHtml(s)}</option>`).join("");

  const presetsWrap = document.getElementById("customPresetsChips");
  presetsWrap.innerHTML = "";
  presets.forEach((p, idx) => {
    const sName = slots[p.slotIndex] || slots[0];
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.innerHTML = `<span style="color:var(--cyan);">${escapeHtml(sName)}:</span> ${escapeHtml(p.text)} <button type="button">✕</button>`;
    chip.querySelector("button").onclick = async () => {
      const updated = presets.filter((_, i) => i !== idx);
      await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id), { presets: updated });
    };
    presetsWrap.appendChild(chip);
  });

  // Members Chips
  const memWrap = document.getElementById("customMembersChips");
  memWrap.innerHTML = "";
  members.forEach((m) => {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.innerHTML = `${escapeHtml(m)} <button type="button">✕</button>`;
    chip.querySelector("button").onclick = async () => {
      if (members.length <= 1) return showToast("Keep at least 1 member", "error");
      const updated = members.filter((item) => item !== m);
      await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id), { members: updated });
    };
    memWrap.appendChild(chip);
  });
}

document.getElementById("addSlotBtn").onclick = async () => {
  const ws = getActiveWorkspace();
  const inp = document.getElementById("newSlotInput");
  const val = inp.value.trim();
  if (!ws || !val) return;
  if ((ws.slots || []).length >= 6) return showToast("Maximum 6 slots allowed", "error");
  if ((ws.slots || []).includes(val)) return showToast("Slot already exists", "error");
  inp.value = "";
  await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id), {
    slots: [...(ws.slots || []), val]
  });
  showToast(`Added "${val}" slot`);
};

document.getElementById("addPresetBtn").onclick = async () => {
  const ws = getActiveWorkspace();
  const slotIndex = Number(document.getElementById("presetTargetSlot").value) || 0;
  const val = document.getElementById("newPresetValue").value.trim();
  if (!ws || !val) return;
  document.getElementById("newPresetValue").value = "";
  await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id), {
    presets: [...(ws.presets || []), { slotIndex, text: val }]
  });
  showToast("Quick preset added");
};

document.getElementById("addMemberBtn").onclick = async () => {
  const ws = getActiveWorkspace();
  const inp = document.getElementById("newMemberInput");
  const val = inp.value.trim();
  if (!ws || !val || (ws.members || []).includes(val)) return;
  inp.value = "";
  await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id), {
    members: [...(ws.members || []), val]
  });
  showToast(`Added member ${val}`);
};

document.getElementById("saveWsInfoBtn").onclick = async () => {
  const ws = getActiveWorkspace();
  if (!ws) return;
  const name = document.getElementById("editWsNameInput").value.trim() || ws.name;
  const upiId = document.getElementById("editWsUpiInput").value.trim();
  await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id), { name, upiId });
  showToast("Workspace updated!");
};

document.getElementById("deleteWsBtn").onclick = async () => {
  const ws = getActiveWorkspace();
  if (!ws || workspaces.length <= 1) return showToast("Cannot delete your only workspace", "error");
  if (!confirm(`Delete "${ws.name}" permanently?`)) return;
  await deleteDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id));
  activeWorkspaceId = null;
  showToast("Workspace deleted");
};

// ==================== 6. SMART INPUT & ENTRY LOGIC (FROM POCKETLEDGER PRO) ====================
window.switchTab = (tabName, el) => {
  document.querySelectorAll(".tab-view").forEach((v) => v.classList.remove("active"));
  document.querySelectorAll(".nav-tab").forEach((t) => t.classList.remove("active"));
  document.getElementById(`tab-${tabName}`).classList.add("active");
  el.classList.add("active");
  if (tabName === "analytics") renderCharts();
};

function getLocalTodayISO() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function syncDateIfNeeded(force = false) {
  const currentLocalDate = getLocalTodayISO();
  const dateInput = document.getElementById("entryDate");
  const changed = force || !dateInput.value || dateInput.value === lastSyncedDateStr;
  if (changed && dateInput.value !== currentLocalDate) {
    dateInput.value = currentLocalDate;
    loadEntryForSelectedDate();
  } else if (!dateInput.value) {
    dateInput.value = currentLocalDate;
  }
  lastSyncedDateStr = currentLocalDate;
}

function cleanItemText(str) {
  return String(str || "").replace(/\s*\(\s*\)/g, "").trim();
}

function extractAmount(str) {
  if (!str || str === "-") return 0;
  const matches = String(str).match(/\d+(\.\d+)?/g);
  if (!matches) return 0;
  return matches.reduce((sum, num) => sum + parseFloat(num), 0);
}

function attachSmartListener(input) {
  input.addEventListener("input", function (e) {
    const val = this.value;
    const pos = this.selectionStart;
    if (e.inputType === "insertText" && e.data === " ") {
      const beforeCursor = val.slice(0, pos);
      if (/^\s*\d+(\.\d+)?\s$/.test(beforeCursor) && !val.includes("(")) {
        const numPart = beforeCursor.trim();
        const afterCursor = val.slice(pos);
        this.value = numPart + " ()" + afterCursor;
        const newPos = numPart.length + 2;
        this.setSelectionRange(newPos, newPos);
      }
    }
    calcPreview();
  });
}

function calcPreview() {
  let total = 0;
  document.querySelectorAll(".slot-val-input").forEach((inp) => {
    total += extractAmount(inp.value);
  });
  const otherData = getDynamicOthers("othersContainer");
  total += otherData.total;
  document.getElementById("liveTotal").innerText = `${getCurrency()}${total}`;
}
window.calcPreview = calcPreview;

window.addOtherInput = (containerId, val = "") => {
  const container = document.getElementById(containerId);
  const div = document.createElement("div");
  div.className = "other-row";
  div.innerHTML = `
    <input type="text" class="other-item smart-input blur-sensitive" value="${escapeHtml(val)}" placeholder="e.g. 50 (Extra)">
    <button type="button" class="btn-del-item" onclick="this.parentElement.remove(); calcPreview();">✕</button>
  `;
  container.appendChild(div);
  attachSmartListener(div.querySelector("input"));
};

function resetOthersContainer(containerId, items = []) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  if (items.length === 0) {
    const div = document.createElement("div");
    div.className = "other-row";
    div.innerHTML = `<input type="text" class="other-item smart-input blur-sensitive" placeholder="e.g. 20 (Extra Item)">`;
    container.appendChild(div);
    attachSmartListener(div.querySelector("input"));
  } else {
    items.forEach((val, idx) => {
      if (idx === 0) {
        const div = document.createElement("div");
        div.className = "other-row";
        div.innerHTML = `<input type="text" class="other-item smart-input blur-sensitive" value="${escapeHtml(val)}">`;
        container.appendChild(div);
        attachSmartListener(div.querySelector("input"));
      } else {
        window.addOtherInput(containerId, val);
      }
    });
  }
}

function getDynamicOthers(containerId) {
  const inputs = document.querySelectorAll(`#${containerId} .other-item`);
  const items = [];
  let total = 0;
  inputs.forEach((inp) => {
    const val = cleanItemText(inp.value);
    if (val) {
      items.push(val);
      total += extractAmount(val);
    }
  });
  return { text: items.join(", "), total };
}

function formatDateWithDay(isoDate) {
  if (!isoDate) return "";
  const parts = isoDate.split("-");
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return `${parts[2]}/${parts[1]}/${parts[0]} (${daysOfWeek[d.getDay()]})`;
}

function parseEntryDate(dateStr) {
  const datePart = String(dateStr || "").split(" ")[0];
  const parts = datePart.split("/");
  if (parts.length !== 3) return new Date(0);
  return new Date(parts[2], parts[1] - 1, parts[0]);
}

window.loadEntryForSelectedDate = () => {
  const ws = getActiveWorkspace();
  const isoDate = document.getElementById("entryDate").value;
  const banner = document.getElementById("existingSyncBanner");
  const saveBtn = document.getElementById("saveBtn");

  if (!ws || !isoDate) return;
  const dateFormatted = formatDateWithDay(isoDate);
  const existing = rawData.find((r) => r.date === dateFormatted);

  const slots = ws.slots || [];
  if (existing) {
    activeEditDocId = existing.docId;
    if (existing.paidBy) document.getElementById("entryPaidBy").value = existing.paidBy;

    slots.forEach((slotName, idx) => {
      const inp = document.getElementById(`slot_input_${idx}`);
      if (inp) {
        const val = existing.slotValues?.[slotName] || "";
        inp.value = val === "-" ? "" : val;
      }
    });

    if (existing.other && existing.other !== "-") {
      const parts = existing.other.split(",").map((p) => p.trim()).filter(Boolean);
      resetOthersContainer("othersContainer", parts);
    } else {
      resetOthersContainer("othersContainer", []);
    }

    document.getElementById("syncBannerText").innerText = `✏️ Loaded ${dateFormatted.split(" ")[0]} — add/edit & update`;
    banner.classList.add("show");
    saveBtn.innerText = "Update Entry →";
    saveBtn.classList.add("update-mode");
  } else {
    activeEditDocId = null;
    slots.forEach((_, idx) => {
      const inp = document.getElementById(`slot_input_${idx}`);
      if (inp) inp.value = "";
    });
    resetOthersContainer("othersContainer", []);

    banner.classList.remove("show");
    saveBtn.innerText = "Save Entry →";
    saveBtn.classList.remove("update-mode");
  }
  calcPreview();
};

window.submitExpense = async () => {
  const ws = getActiveWorkspace();
  const btn = document.getElementById("saveBtn");
  const isoDate = document.getElementById("entryDate").value;
  if (!ws || !isoDate) return showToast("Select a valid date", "error");

  const dateFormatted = formatDateWithDay(isoDate);
  const paidBy = document.getElementById("entryPaidBy").value || ws.members[0];
  const slotValues = {};
  let slotSum = 0;

  (ws.slots || []).forEach((slotName, idx) => {
    const inp = document.getElementById(`slot_input_${idx}`);
    const cleaned = cleanItemText(inp ? inp.value : "");
    slotValues[slotName] = cleaned;
    slotSum += extractAmount(cleaned);
  });

  const otherData = getDynamicOthers("othersContainer");
  const total = slotSum + otherData.total;

  if (total === 0 && Object.values(slotValues).every((v) => !v) && !otherData.text) {
    return showToast("Enter at least one expense item", "error");
  }

  const existingRecord = rawData.find((r) => r.date === dateFormatted);
  const targetDocId = activeEditDocId || (existingRecord ? existingRecord.docId : null);

  btn.innerText = targetDocId ? "Updating..." : "Saving...";
  btn.disabled = true;

  const entryPayload = {
    date: dateFormatted,
    paidBy,
    slotValues,
    other: otherData.text,
    total,
    updatedAt: serverTimestamp()
  };

  try {
    if (targetDocId) {
      await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id, "entries", targetDocId), entryPayload);
      showToast("Day entry updated!");
    } else {
      entryPayload.createdAt = serverTimestamp();
      await addDoc(collection(db, "users", currentUser.uid, "workspaces", ws.id, "entries"), entryPayload);
      showToast("Entry saved to cloud!");
    }
  } catch (err) {
    showToast("Save failed: " + err.message, "error");
  } finally {
    btn.disabled = false;
  }
};

// ==================== 7. GEMINI AI SMART ENTRY, RECEIPT VISION & AUDIT ====================
async function callGeminiAI(parts) {
  const apiKey = getActiveGeminiKey();
  const models = ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.5-flash"];
  let lastError = "";

  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-goog-api-key": apiKey
          },
          body: JSON.stringify({ contents: [{ parts }] })
        }
      );
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (res.ok && text) return { text, error: null };
      if (data.error?.message) lastError = data.error.message;
    } catch (e) {
      lastError = e.message;
    }
  }
  return { text: null, error: lastError || "AI connection failed" };
}

function extractJsonObject(rawText) {
  if (!rawText) return null;
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (e) {
    return null;
  }
}

async function applyParsedAiExpense(parsed) {
  const ws = getActiveWorkspace();
  if (!ws || !parsed || !(Number(parsed.amount) > 0)) return false;

  const isoDate = document.getElementById("entryDate").value || getLocalTodayISO();
  const dateFormatted = formatDateWithDay(isoDate);
  const existing = rawData.find((r) => r.date === dateFormatted);

  const slots = ws.slots || [];
  const matchedSlot = slots.find((s) => s.toLowerCase() === String(parsed.slot || "").toLowerCase()) || slots[0];
  const itemString = `${Number(parsed.amount)} (${parsed.item || "AI Entry"})`;
  const paidBy = (ws.members || []).find((m) => m.toLowerCase() === String(parsed.paidBy || "").toLowerCase()) || ws.members[0];

  const slotValues = existing ? { ...(existing.slotValues || {}) } : {};
  const prevVal = slotValues[matchedSlot] || "";
  slotValues[matchedSlot] = prevVal ? `${prevVal}, ${itemString}` : itemString;

  let slotSum = 0;
  slots.forEach((s) => (slotSum += extractAmount(slotValues[s])));
  const otherText = existing?.other || "";
  const total = slotSum + extractAmount(otherText);

  const payload = {
    date: dateFormatted,
    paidBy,
    slotValues,
    other: otherText,
    total,
    updatedAt: serverTimestamp()
  };

  if (existing) {
    await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id, "entries", existing.docId), payload);
  } else {
    payload.createdAt = serverTimestamp();
    await addDoc(collection(db, "users", currentUser.uid, "workspaces", ws.id, "entries"), payload);
  }
  return true;
}

document.getElementById("aiSmartAddBtn").onclick = async () => {
  const ws = getActiveWorkspace();
  const input = document.getElementById("aiSmartText");
  const banner = document.getElementById("aiStatusBanner");
  const text = input.value.trim();
  if (!ws || !text) return;

  banner.innerText = "✨ Gemini AI is understanding your entry...";
  banner.classList.remove("hidden");

  const prompt = `Extract expense from: "${text}".
Available slots: ${JSON.stringify(ws.slots)}.
Available members: ${JSON.stringify(ws.members)}.
Return ONLY a valid JSON object: {"item": string, "amount": number, "slot": string, "paidBy": string}.`;

  const { text: aiReply, error } = await callGeminiAI([{ text: prompt }]);
  const parsed = extractJsonObject(aiReply);

  if (parsed && (await applyParsedAiExpense(parsed))) {
    input.value = "";
    banner.innerText = `✅ Added ${getCurrency()}${parsed.amount} (${parsed.item}) under ${parsed.slot}`;
    setTimeout(() => banner.classList.add("hidden"), 3500);
  } else {
    banner.innerText = error ? `⚠️ ${error}` : 'Try format: "Paid 120 for lunch"';
  }
};

document.getElementById("aiReceiptFile").onchange = async (e) => {
  const file = e.target.files[0];
  const ws = getActiveWorkspace();
  if (!file || !ws) return;

  const banner = document.getElementById("aiStatusBanner");
  banner.innerText = "📷 Compressing & scanning receipt with Gemini Vision...";
  banner.classList.remove("hidden");

  try {
    const compressed = await compressImage(file, 960, 0.82);
    const prompt = `Read this receipt/bill image. Extract the main shop/item name as "item", the final total amount as a pure number "amount", and pick the closest slot from ${JSON.stringify(ws.slots)} as "slot".
Return ONLY a valid JSON object: {"item": string, "amount": number, "slot": string}.`;

    const { text: aiReply, error } = await callGeminiAI([
      { text: prompt },
      { inline_data: { mime_type: compressed.mime, data: compressed.base64 } }
    ]);

    const parsed = extractJsonObject(aiReply);
    if (parsed && (await applyParsedAiExpense(parsed))) {
      banner.innerText = `✅ Receipt Scanned: ${getCurrency()}${parsed.amount} (${parsed.item})`;
      setTimeout(() => banner.classList.add("hidden"), 4000);
    } else {
      banner.innerText = error ? `⚠️ ${error}` : "Could not read bill total. Try a clearer photo.";
    }
  } catch (err) {
    banner.innerText = "⚠️ Image processing failed.";
  }
  e.target.value = "";
};

document.getElementById("aiAuditTriggerBtn").onclick = async () => {
  const ws = getActiveWorkspace();
  const banner = document.getElementById("aiStatusBanner");
  if (!ws || currentActiveRows.length === 0) {
    banner.innerText = "Add some entries in the active week first to run AI Audit.";
    banner.classList.remove("hidden");
    return;
  }

  banner.innerText = "🧠 Gemini AI is auditing your spending pattern...";
  banner.classList.remove("hidden");

  const summary = currentActiveRows
    .map((r) => `${r.date}: Total ${getCurrency()}${r.total} (Paid by ${r.paidBy})`)
    .join("; ");

  const { text: advice, error } = await callGeminiAI([
    {
      text: `Analyze these expenses for "${ws.name}": ${summary}. Give 2 short, practical money-saving insights in simple English (max 45 words).`
    }
  ]);

  banner.innerText = advice ? `💡 ${advice}` : `⚠️ ${error}`;
};

// ==================== 8. LEDGER TABLE, EDIT MODAL, SMART SPLIT & CHARTS ====================
window.openEdit = (docId) => {
  const ws = getActiveWorkspace();
  const item = rawData.find((r) => r.docId === docId);
  if (!ws || !item) return;

  document.getElementById("editDocId").value = item.docId;
  document.getElementById("editDate").value = item.date;

  const paidSel = document.getElementById("editPaidBy");
  paidSel.innerHTML = (ws.members || []).map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");
  if (item.paidBy) paidSel.value = item.paidBy;

  const grid = document.getElementById("editDynamicSlotsGrid");
  grid.innerHTML = "";
  (ws.slots || []).forEach((slotName, idx) => {
    const val = item.slotValues?.[slotName] || "";
    const field = document.createElement("div");
    field.className = "field";
    field.innerHTML = `
      <label>${escapeHtml(slotName)}</label>
      <input type="text" class="smart-input edit-slot-inp" data-slot="${escapeHtml(slotName)}" value="${escapeHtml(val === "-" ? "" : val)}" />
    `;
    grid.appendChild(field);
    attachSmartListener(field.querySelector("input"));
  });

  const editCont = document.getElementById("editOthersContainer");
  editCont.innerHTML = "";
  if (item.other && item.other !== "-") {
    item.other.split(",").forEach((p) => window.addOtherInput("editOthersContainer", p.trim()));
  } else {
    window.addOtherInput("editOthersContainer");
  }

  document.getElementById("editModal").classList.add("show");
};

window.closeModal = () => {
  document.getElementById("editModal").classList.remove("show");
};

window.saveEdit = async () => {
  const ws = getActiveWorkspace();
  const btn = document.getElementById("updateModalBtn");
  const docId = document.getElementById("editDocId").value;
  if (!ws || !docId) return;

  btn.innerText = "Updating...";
  btn.disabled = true;

  const paidBy = document.getElementById("editPaidBy").value;
  const slotValues = {};
  let slotSum = 0;

  document.querySelectorAll(".edit-slot-inp").forEach((inp) => {
    const sName = inp.dataset.slot;
    const cleaned = cleanItemText(inp.value);
    slotValues[sName] = cleaned;
    slotSum += extractAmount(cleaned);
  });

  const otherData = getDynamicOthers("editOthersContainer");
  const total = slotSum + otherData.total;

  try {
    await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id, "entries", docId), {
      paidBy,
      slotValues,
      other: otherData.text,
      total,
      updatedAt: serverTimestamp()
    });
    window.closeModal();
    showToast("Record updated!");
  } catch (err) {
    showToast("Update failed: " + err.message, "error");
  } finally {
    btn.innerText = "Update";
    btn.disabled = false;
  }
};

window.deleteSingleRow = async (docId) => {
  const ws = getActiveWorkspace();
  if (!ws || !confirm("Delete this expense record permanently?")) return;
  await deleteDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id, "entries", docId));
  showToast("Record deleted");
};

window.deleteCurrentWeek = async (docIds) => {
  const ws = getActiveWorkspace();
  if (!ws || !confirm("Delete all records for this active week?")) return;
  const batch = writeBatch(db);
  docIds.forEach((id) => batch.delete(doc(db, "users", currentUser.uid, "workspaces", ws.id, "entries", id)));
  await batch.commit();
  showToast("Week records deleted");
};

window.clearFilters = () => {
  document.getElementById("searchDate").value = "";
  document.getElementById("searchText").value = "";
  renderTable();
};

function getCalendarWeekRange(offset) {
  const now = new Date();
  const day = now.getDay();
  const diffToMon = now.getDate() - day + (day === 0 ? -6 : 1) + offset * 7;
  const start = new Date(now.getFullYear(), now.getMonth(), diffToMon);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function formatDateShort(d) {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

window.prevWeek = () => { weekOffset--; renderTable(); };
window.nextWeek = () => { weekOffset++; renderTable(); };
window.resetToCurrentWeek = () => { weekOffset = 0; window.clearFilters(); };

function renderTable() {
  const ws = getActiveWorkspace();
  if (!ws) return;
  const cur = getCurrency();
  const slots = ws.slots || [];

  const thead = document.getElementById("ledgerTableHead");
  thead.innerHTML = `<tr>
    <th>Date & Day</th>
    <th>Paid By</th>
    ${slots.map((s) => `<th>${escapeHtml(s)}</th>`).join("")}
    <th>Other</th>
    <th>Total</th>
    <th>Actions</th>
  </tr>`;

  const tbody = document.getElementById("tableBody");
  const centerBtn = document.getElementById("centerWeekBtn");
  const weekDelCont = document.getElementById("weekDeleteContainer");
  const sDate = document.getElementById("searchDate").value;
  const sText = document.getElementById("searchText").value.toLowerCase().trim();

  tbody.innerHTML = "";
  const isSearchActive = sDate || sText;
  let displayRows = [];

  if (isSearchActive) {
    let filtered = [...rawData];
    if (sDate) {
      const parts = sDate.split("-");
      const targetDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
      filtered = filtered.filter((r) => r.date.startsWith(targetDate));
    }
    if (sText) {
      filtered = filtered.filter((r) => {
        const slotBlob = Object.values(r.slotValues || {}).join(" ").toLowerCase();
        return (
          r.date.toLowerCase().includes(sText) ||
          (r.paidBy || "").toLowerCase().includes(sText) ||
          slotBlob.includes(sText) ||
          (r.other || "").toLowerCase().includes(sText)
        );
      });
    }
    centerBtn.innerHTML = `<span style="font-size:12px; color:var(--primary); font-weight:700;">Results (${filtered.length})</span>`;
    displayRows = filtered;
  } else {
    const range = getCalendarWeekRange(weekOffset);
    const rangeText = `${formatDateShort(range.start)} - ${formatDateShort(range.end)}`;
    if (weekOffset === 0) {
      centerBtn.innerHTML = `<strong style="font-size:12px; color:var(--primary);">Current Week</strong><br><small style="color:var(--muted); font-size:10px;">${rangeText}</small>`;
    } else {
      centerBtn.innerHTML = `<button class="back-pill" onclick="resetToCurrentWeek()">Current Week (${rangeText})</button>`;
    }

    displayRows = rawData.filter((r) => {
      const d = parseEntryDate(r.date);
      return d >= range.start && d <= range.end;
    });
  }

  displayRows.sort((a, b) => parseEntryDate(a.date) - parseEntryDate(b.date));
  currentActiveRows = displayRows;

  // Month Total & Budget Bar
  const now = new Date();
  const monthTotal = rawData.reduce((acc, r) => {
    const d = parseEntryDate(r.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() ? acc + (Number(r.total) || 0) : acc;
  }, 0);
  document.getElementById("statMonth").innerText = `${cur}${monthTotal}`;
  updateBudgetUI(monthTotal, ws);

  const colSpan = slots.length + 5;
  if (displayRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align:center; padding:18px; color:var(--muted);">No expense records found for this period.</td></tr>`;
    updateStats(0, 0, ws);
    renderSmartSplit(ws, []);
    weekDelCont.innerHTML = "";
    return;
  }

  let viewTotal = 0;
  const currentDocIds = [];

  displayRows.forEach((r) => {
    currentDocIds.push(r.docId);
    viewTotal += Number(r.total) || 0;

    const slotCells = slots
      .map((s) => `<td>${escapeHtml(r.slotValues?.[s] || "-")}</td>`)
      .join("");

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="date-tag">${escapeHtml(r.date)}</span></td>
      <td style="color:var(--cyan); font-weight:600;">${escapeHtml(r.paidBy || ws.members[0])}</td>
      ${slotCells}
      <td>${escapeHtml(r.other || "-")}</td>
      <td><span class="amt-tag">${cur}${r.total}</span></td>
      <td>
        <button class="act-btn" style="background:rgba(6,182,212,0.18); color:#67e8f9;" onclick="openEdit('${r.docId}')">✏️</button>
        <button class="act-btn" style="background:rgba(244,63,94,0.16); color:var(--rose);" onclick="deleteSingleRow('${r.docId}')">🗑️</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  if (displayRows.length > 0 && !isSearchActive) {
    weekDelCont.innerHTML = `<button class="btn-del-wk" onclick='deleteCurrentWeek(${JSON.stringify(currentDocIds)})'>🗑️ Delete Week</button>`;
  } else {
    weekDelCont.innerHTML = "";
  }

  updateStats(viewTotal, displayRows.length, ws);
  renderSmartSplit(ws, displayRows);
  if (document.getElementById("tab-analytics").classList.contains("active")) renderCharts();
}
window.renderTable = renderTable;

function updateStats(total, count, ws) {
  const cur = getCurrency();
  const memCount = (ws.members || []).length || 1;
  document.getElementById("statTotal").innerText = `${cur}${total}`;
  document.getElementById("statAvg").innerText = count > 0 ? `${cur}${Math.round(total / count)}` : `${cur}0`;
  document.getElementById("statEntries").innerText = `${count} Days`;
  document.getElementById("statPerMember").innerText = `${cur}${Math.round(total / memCount)}`;
}

// Smart Split & UPI QR Engine
function renderSmartSplit(ws, rows) {
  const cur = getCurrency();
  const members = ws.members || [];
  const balWrap = document.getElementById("memberBalancesWrap");
  const transWrap = document.getElementById("settlementTransfersWrap");

  const paidByMember = {};
  members.forEach((m) => (paidByMember[m] = 0));

  let totalWeek = 0;
  rows.forEach((r) => {
    const amt = Number(r.total) || 0;
    totalWeek += amt;
    const payer = r.paidBy && Object.prototype.hasOwnProperty.call(paidByMember, r.paidBy) ? r.paidBy : members[0];
    if (payer) paidByMember[payer] += amt;
  });

  const fairShare = members.length > 0 ? totalWeek / members.length : 0;
  const netBalances = {};

  balWrap.innerHTML = "";
  members.forEach((m) => {
    const net = paidByMember[m] - fairShare;
    netBalances[m] = net;
    const row = document.createElement("div");
    row.className = "split-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(m)}</strong>
        <span style="display:block; font-size:10px; color:var(--muted);">Paid ${cur}${paidByMember[m].toFixed(0)}</span>
      </div>
      <span style="font-weight:800; color:${net >= -0.5 ? "var(--primary)" : "var(--rose)"};">
        ${net >= -0.5 ? `Gets ${cur}${Math.abs(net).toFixed(0)}` : `Owes ${cur}${Math.abs(net).toFixed(0)}`}
      </span>
    `;
    balWrap.appendChild(row);
  });

  // Minimum Transfers
  const debtors = [];
  const creditors = [];
  Object.entries(netBalances).forEach(([person, amt]) => {
    if (amt < -0.5) debtors.push({ person, amt: Math.abs(amt) });
    else if (amt > 0.5) creditors.push({ person, amt });
  });

  const transfers = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const payAmt = Math.min(debtors[i].amt, creditors[j].amt);
    transfers.push({ from: debtors[i].person, to: creditors[j].person, amount: payAmt });
    debtors[i].amt -= payAmt;
    creditors[j].amt -= payAmt;
    if (debtors[i].amt < 0.5) i++;
    if (creditors[j].amt < 0.5) j++;
  }

  transWrap.innerHTML = "";
  if (transfers.length === 0) {
    transWrap.innerHTML = `<p style="font-size:12px; color:var(--muted);">All settled up! No pending transfers.</p>`;
  } else {
    const upiId = ws.upiId || userProfile.upiId || "";
    transfers.forEach((tr) => {
      const upiUrl = upiId
        ? `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(tr.to)}&am=${tr.amount.toFixed(0)}&cu=INR`
        : "";

      const row = document.createElement("div");
      row.className = "split-row";
      row.innerHTML = `
        <div>
          <strong style="color:var(--rose);">${escapeHtml(tr.from)}</strong> →
          <strong style="color:var(--primary);">${escapeHtml(tr.to)}</strong>
          <span style="margin-left:6px; font-weight:800;">${cur}${tr.amount.toFixed(0)}</span>
        </div>
        ${
          upiUrl
            ? `<div style="display:flex; gap:6px;">
                 <a href="${upiUrl}" class="btn-primary" style="padding:6px 10px; font-size:11px; text-decoration:none;">Pay UPI</a>
                 <button type="button" class="btn-ghost qr-open-btn" style="padding:6px 9px; font-size:11px;">QR</button>
               </div>`
            : `<span style="font-size:10px; color:var(--muted);">Add UPI ID below</span>`
        }
      `;
      const qrBtn = row.querySelector(".qr-open-btn");
      if (qrBtn) {
        qrBtn.onclick = () => {
          document.getElementById("qrModalTitle").innerText = `${tr.from} → ${tr.to} (${cur}${tr.amount.toFixed(0)})`;
          document.getElementById("qrModalUpiLabel").innerText = `UPI: ${upiId}`;
          document.getElementById("qrModalImg").src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiUrl)}`;
          document.getElementById("qrModal").classList.add("show");
        };
      }
      transWrap.appendChild(row);
    });
  }
}

window.setMonthlyBudget = async () => {
  const ws = getActiveWorkspace();
  if (!ws) return;
  const val = prompt(`Enter Monthly Budget Limit (${getCurrency()}):`, ws.budgetLimit || 5000);
  if (val && !isNaN(val) && Number(val) > 0) {
    await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id), { budgetLimit: Number(val) });
    showToast(`Monthly budget set to ${getCurrency()}${val}`);
  }
};

function updateBudgetUI(monthSpent, ws) {
  const cur = getCurrency();
  const limit = Number(ws.budgetLimit) || 5000;
  const pct = Math.min((monthSpent / limit) * 100, 100);
  const rem = Math.max(limit - monthSpent, 0);

  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(daysInMonth - now.getDate() + 1, 1);
  const safeDaily = Math.round(rem / daysLeft);

  const bar = document.getElementById("budgetBarFill");
  bar.style.width = `${pct}%`;
  bar.style.background = pct > 90 ? "var(--rose)" : "linear-gradient(90deg, #06b6d4, #10b981)";

  document.getElementById("budgetSpentLbl").innerText = `Spent: ${cur}${monthSpent}`;
  document.getElementById("budgetLimitLbl").innerText = `Limit: ${cur}${limit}`;
  document.getElementById("budgetRemLbl").innerText = `Remaining: ${cur}${rem}`;
  document.getElementById("safeDailyLbl").innerText = `Safe Daily: ${cur}${safeDaily}/day`;
}

function renderCharts() {
  const ws = getActiveWorkspace();
  if (!ws) return;
  const slots = ws.slots || [];
  const slotTotals = slots.map(() => 0);
  let otherSum = 0;

  const labels = [];
  const totals = [];

  currentActiveRows.forEach((r) => {
    slots.forEach((s, idx) => {
      slotTotals[idx] += extractAmount(r.slotValues?.[s]);
    });
    otherSum += extractAmount(r.other);
    labels.push(r.date.split(" ")[0].slice(0, 5));
    totals.push(Number(r.total) || 0);
  });

  if (catChartInstance) catChartInstance.destroy();
  catChartInstance = new Chart(document.getElementById("catChart"), {
    type: "doughnut",
    data: {
      labels: [...slots, "Other"],
      datasets: [
        {
          data: [...slotTotals, otherSum],
          backgroundColor: ["#06b6d4", "#10b981", "#f59e0b", "#818cf8", "#a855f7", "#ec4899", "#f43f5e"],
          borderWidth: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "right", labels: { color: "#f1f5f9", font: { size: 11 } } } }
    }
  });

  if (trendChartInstance) trendChartInstance.destroy();
  trendChartInstance = new Chart(document.getElementById("trendChart"), {
    type: "bar",
    data: {
      labels: labels.length ? labels : ["No Data"],
      datasets: [
        {
          label: `Daily Spend (${getCurrency()})`,
          data: totals.length ? totals : [0],
          backgroundColor: "#10b981",
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: "#8ca0b3", font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: "#8ca0b3", font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.05)" } }
      },
      plugins: { legend: { display: false } }
    }
  });
}

// ==================== 9. WHATSAPP SHARE & PDF REPORT ====================
window.shareWeeklyReport = () => {
  const ws = getActiveWorkspace();
  if (!ws || currentActiveRows.length === 0) return showToast("No records in active week to share", "error");
  const cur = getCurrency();
  let total = 0;
  const lines = [`*💼 HisabCloud Pro — ${ws.name}*`, ""];
  currentActiveRows.forEach((r) => {
    total += Number(r.total) || 0;
    lines.push(`• ${r.date} (${r.paidBy || ws.members[0]}): *${cur}${r.total}*`);
  });
  lines.push("", `*Total Spend: ${cur}${total}*`);
  const text = lines.join("\n");

  if (navigator.clipboard) navigator.clipboard.writeText(text);
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  showToast("Summary copied & opening WhatsApp...");
};

window.exportPDF = async () => {
  const ws = getActiveWorkspace();
  if (!ws || currentActiveRows.length === 0) return showToast("No records available to export", "error");

  showToast("Generating PDF report...");
  const { jsPDF } = window.jspdf;
  const docPdf = new jsPDF();
  const slots = ws.slots || [];

  docPdf.setFontSize(16);
  docPdf.setTextColor(16, 185, 129);
  docPdf.text(`HISABCLOUD PRO — ${ws.name.toUpperCase()}`, 14, 18);

  docPdf.setFontSize(10);
  docPdf.setTextColor(100);
  docPdf.text(`Account: ${userProfile.fullName} | Generated: ${new Date().toLocaleDateString("en-IN")}`, 14, 25);

  let grandTotal = 0;
  const tableRows = currentActiveRows.map((r) => {
    grandTotal += Number(r.total) || 0;
    return [
      r.date,
      r.paidBy || ws.members[0],
      ...slots.map((s) => r.slotValues?.[s] || "-"),
      r.other || "-",
      `${r.total}`
    ];
  });

  const footerRow = new Array(slots.length + 2).fill("");
  footerRow.push("TOTAL SPEND", `${grandTotal}`);
  tableRows.push(footerRow);

  docPdf.autoTable({
    startY: 32,
    head: [["Date & Day", "Paid By", ...slots, "Other", "Total"]],
    body: tableRows,
    theme: "grid",
    headStyles: { fillColor: [16, 185, 129], textColor: [5, 10, 14], fontStyle: "bold" },
    styles: { fontSize: 8, cellPadding: 3 }
  });

  docPdf.save(`${ws.name.replace(/\s+/g, "_")}_${getLocalTodayISO()}.pdf`);
};

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}
