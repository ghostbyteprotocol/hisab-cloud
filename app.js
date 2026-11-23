// app.js — Hisab-Cloud Advanced Engine (Account Onboarding, Profile Photo, Gemini Vision & NLP, Charts, QR & PDF)
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
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ==================== GLOBAL STATE ====================
let currentUser = null;
let userProfile = null;
let workspaces = [];
let activeWorkspaceId = null;
let currentExpenses = [];
let editingExpenseId = null;
let unsubExpenses = null;
let unsubWorkspaces = null;

let onboardingAvatarBase64 = "";
let profileEditAvatarBase64 = "";
let isSignUpMode = true;

let categoryChartInstance = null;
let memberChartInstance = null;

// ==================== TOAST NOTIFICATION ====================
function showToast(msg, type = "info") {
  const container = document.getElementById("toast-container");
  const colors =
    type === "error"
      ? "border-red-500/60 text-red-200"
      : type === "success"
      ? "border-emerald-500/60 text-emerald-200"
      : "border-cyan-500/50 text-white";

  const el = document.createElement("div");
  el.className = `pointer-events-auto px-4 py-2.5 rounded-2xl bg-[#0d1323]/95 border ${colors} shadow-2xl backdrop-blur-xl text-xs font-semibold transition-all duration-300`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ==================== IMAGE COMPRESSOR (FIXES GEMINI VISION & PROFILE PHOTO) ====================
function compressImageFile(file, maxDim = 900, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const ratio = maxDim / Math.max(width, height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({
          dataUrl,
          base64: dataUrl.split(",")[1],
          mime: "image/jpeg"
        });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ==================== 1. AUTHENTICATION (GOOGLE + EMAIL ACCOUNT) ====================
const googleProvider = new GoogleAuthProvider();

document.getElementById("google-login-btn").onclick = async () => {
  const errEl = document.getElementById("auth-error-msg");
  errEl.classList.add("hidden");
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    errEl.textContent = err.message || "Google Sign-In failed.";
    errEl.classList.remove("hidden");
  }
};

document.getElementById("toggle-auth-mode-btn").onclick = () => {
  isSignUpMode = !isSignUpMode;
  document.getElementById("auth-submit-btn").textContent = isSignUpMode ? "Create New Account" : "Sign In to Account";
  document.getElementById("auth-mode-label").textContent = isSignUpMode
    ? "Already have an account? Switch to Sign In"
    : "New here? Create a new account";
};

document.getElementById("email-auth-form").onsubmit = async (e) => {
  e.preventDefault();
  const email = document.getElementById("auth-email").value.trim();
  const pass = document.getElementById("auth-password").value;
  const errEl = document.getElementById("auth-error-msg");
  errEl.classList.add("hidden");

  try {
    if (isSignUpMode) {
      await createUserWithEmailAndPassword(auth, email, pass);
    } else {
      await signInWithEmailAndPassword(auth, email, pass);
    }
  } catch (err) {
    if (err.code === "auth/email-already-in-use") {
      try {
        await signInWithEmailAndPassword(auth, email, pass);
        return;
      } catch (loginErr) {
        errEl.textContent = loginErr.message;
      }
    } else {
      errEl.textContent = err.message;
    }
    errEl.classList.remove("hidden");
  }
};

document.getElementById("logout-btn").onclick = async () => {
  document.getElementById("profile-modal").classList.add("hidden");
  await signOut(auth);
};

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (!user) {
    document.getElementById("auth-screen").classList.remove("hidden");
    document.getElementById("onboarding-screen").classList.add("hidden");
    document.getElementById("app-shell").classList.add("hidden");
    return;
  }

  // Check if user has completed Real Account Setup
  const profileSnap = await getDoc(doc(db, "users", user.uid));
  if (!profileSnap.exists() || !profileSnap.data().onboardingCompleted) {
    openOnboardingScreen(user);
  } else {
    userProfile = profileSnap.data();
    enterMainDashboard();
  }
});

// ==================== 2. REAL ACCOUNT SETUP (ONBOARDING) ====================
function openOnboardingScreen(user) {
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("app-shell").classList.add("hidden");
  document.getElementById("onboarding-screen").classList.remove("hidden");

  const defaultAvatar = user.photoURL || `https://api.dicebear.com/8.x/avataaars/svg?seed=${encodeURIComponent(user.uid.slice(0, 6))}`;
  onboardingAvatarBase64 = defaultAvatar;
  document.getElementById("onboard-avatar-preview").src = defaultAvatar;
  document.getElementById("onboard-name").value = user.displayName || "";
  document.getElementById("onboard-username").value = (user.email || "user").split("@")[0].replace(/[^a-zA-Z0-9_]/g, "");
}

document.getElementById("onboard-avatar-input").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const compressed = await compressImageFile(file, 256, 0.85);
  onboardingAvatarBase64 = compressed.dataUrl;
  document.getElementById("onboard-avatar-preview").src = compressed.dataUrl;
};

document.getElementById("complete-onboarding-btn").onclick = async () => {
  const fullName = document.getElementById("onboard-name").value.trim();
  const username = document.getElementById("onboard-username").value.trim() || "user";
  const role = document.getElementById("onboard-role").value;
  const currency = document.getElementById("onboard-currency").value;
  const upiId = document.getElementById("onboard-upi").value.trim();
  const budget = Number(document.getElementById("onboard-budget").value) || 5000;
  const wsName = document.getElementById("onboard-ws-name").value.trim();

  if (!fullName || !wsName) {
    showToast("Please enter your Full Name and Workspace Name.", "error");
    return;
  }

  userProfile = {
    uid: currentUser.uid,
    email: currentUser.email,
    fullName,
    username,
    bio: role,
    currency,
    upiId,
    photoUrl: onboardingAvatarBase64,
    onboardingCompleted: true,
    createdAt: serverTimestamp()
  };

  await setDoc(doc(db, "users", currentUser.uid), userProfile, { merge: true });

  await addDoc(collection(db, "users", currentUser.uid, "workspaces"), {
    name: wsName,
    members: [fullName],
    categories: ["Food & Groceries", "Rent & Bills", "Utilities", "Travel", "Shopping", "Other"],
    upiId,
    budgetLimit: budget,
    createdAt: serverTimestamp()
  });

  showToast("Account created successfully!", "success");
  enterMainDashboard();
};

function enterMainDashboard() {
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("onboarding-screen").classList.add("hidden");
  document.getElementById("app-shell").classList.remove("hidden");

  syncHeaderProfileUI();
  subscribeWorkspaces();
}

function syncHeaderProfileUI() {
  if (!userProfile) return;
  document.getElementById("header-avatar").src =
    userProfile.photoUrl || "https://api.dicebear.com/8.x/avataaars/svg?seed=User";
}

// ==================== 3. USER PROFILE & SETTINGS MODAL ====================
function openProfileSettingsModal() {
  if (!userProfile) return;
  profileEditAvatarBase64 = userProfile.photoUrl || "";
  document.getElementById("prof-avatar-preview").src = profileEditAvatarBase64;
  document.getElementById("prof-email").textContent = currentUser.email || "";
  document.getElementById("prof-name").value = userProfile.fullName || "";
  document.getElementById("prof-username").value = userProfile.username || "";
  document.getElementById("prof-upi").value = userProfile.upiId || "";
  document.getElementById("prof-currency").value = userProfile.currency || "₹";
  document.getElementById("prof-bio").value = userProfile.bio || "";
  document.getElementById("prof-gemini-key").value = localStorage.getItem("hisab_custom_gemini_key") || "";

  document.getElementById("profile-modal").classList.remove("hidden");
}

document.getElementById("open-profile-btn").onclick = openProfileSettingsModal;
document.getElementById("open-settings-icon-btn").onclick = openProfileSettingsModal;
document.getElementById("close-profile-modal").onclick = () => {
  document.getElementById("profile-modal").classList.add("hidden");
};

document.getElementById("prof-avatar-input").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const compressed = await compressImageFile(file, 256, 0.85);
  profileEditAvatarBase64 = compressed.dataUrl;
  document.getElementById("prof-avatar-preview").src = compressed.dataUrl;
};

document.getElementById("save-profile-btn").onclick = async () => {
  const fullName = document.getElementById("prof-name").value.trim() || userProfile.fullName;
  const username = document.getElementById("prof-username").value.trim() || userProfile.username;
  const upiId = document.getElementById("prof-upi").value.trim();
  const currency = document.getElementById("prof-currency").value;
  const bio = document.getElementById("prof-bio").value.trim();
  const customKey = document.getElementById("prof-gemini-key").value.trim();

  if (customKey) localStorage.setItem("hisab_custom_gemini_key", customKey);
  else localStorage.removeItem("hisab_custom_gemini_key");

  userProfile = {
    ...userProfile,
    fullName,
    username,
    upiId,
    currency,
    bio,
    photoUrl: profileEditAvatarBase64
  };

  await setDoc(doc(db, "users", currentUser.uid), userProfile, { merge: true });
  syncHeaderProfileUI();
  recalculateAndRenderAll();
  document.getElementById("profile-modal").classList.add("hidden");
  showToast("Profile & Settings updated!", "success");
};

document.getElementById("export-json-btn").onclick = () => {
  const backup = {
    exportedAt: new Date().toISOString(),
    profile: userProfile,
    activeWorkspace: getActiveWorkspace(),
    expenses: currentExpenses
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `HisabCloud_Backup_${Date.now()}.json`;
  a.click();
};

// ==================== 4. WORKSPACES & CUSTOMIZATION ====================
function subscribeWorkspaces() {
  if (unsubWorkspaces) unsubWorkspaces();
  const q = query(collection(db, "users", currentUser.uid, "workspaces"), orderBy("createdAt", "asc"));
  unsubWorkspaces = onSnapshot(q, async (snap) => {
    workspaces = [];
    snap.forEach((d) => workspaces.push({ id: d.id, ...d.data() }));

    if (workspaces.length === 0) {
      await addDoc(collection(db, "users", currentUser.uid, "workspaces"), {
        name: "My Shared Space",
        members: [userProfile.fullName || "Me"],
        categories: ["Food & Groceries", "Rent & Bills", "Utilities", "Travel", "Other"],
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

function getCurrency() {
  return userProfile?.currency || "₹";
}

function renderWorkspaceDropdown() {
  const sel = document.getElementById("workspace-select");
  sel.innerHTML = "";
  workspaces.forEach((ws) => {
    const opt = document.createElement("option");
    opt.value = ws.id;
    opt.textContent = ws.name;
    opt.className = "bg-[#0d1220] text-white";
    sel.appendChild(opt);
  });
  sel.value = activeWorkspaceId;
}

document.getElementById("workspace-select").onchange = (e) => {
  activeWorkspaceId = e.target.value;
  loadActiveWorkspace();
};

function loadActiveWorkspace() {
  const ws = getActiveWorkspace();
  if (!ws) return;

  document.getElementById("workspace-subtitle").textContent = `@${userProfile.username} • ${ws.members.length} Members`;
  document.getElementById("custom-ws-name").value = ws.name || "";
  document.getElementById("custom-ws-upi").value = ws.upiId || "";
  document.getElementById("custom-ws-budget").value = ws.budgetLimit || 5000;

  // Populate Filter Dropdown
  const filterSel = document.getElementById("filter-category-select");
  const prevFilter = filterSel.value;
  filterSel.innerHTML = `<option value="ALL">All Categories</option>` +
    (ws.categories || []).map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  if ([...filterSel.options].some((o) => o.value === prevFilter)) filterSel.value = prevFilter;

  renderCustomizeLists(ws);

  if (unsubExpenses) unsubExpenses();
  const q = query(
    collection(db, "users", currentUser.uid, "workspaces", ws.id, "expenses"),
    orderBy("createdAt", "desc")
  );
  unsubExpenses = onSnapshot(q, (snap) => {
    currentExpenses = [];
    snap.forEach((d) => currentExpenses.push({ id: d.id, ...d.data() }));
    recalculateAndRenderAll();
  });
}

// New Workspace Modal
document.getElementById("new-workspace-btn").onclick = () => {
  document.getElementById("workspace-modal").classList.remove("hidden");
};
document.getElementById("close-ws-modal").onclick = () => {
  document.getElementById("workspace-modal").classList.add("hidden");
};
document.getElementById("create-ws-submit-btn").onclick = async () => {
  const name = document.getElementById("ws-create-name").value.trim();
  const membersRaw = document.getElementById("ws-create-members").value.trim();
  const budgetLimit = Number(document.getElementById("ws-create-budget").value) || 5000;
  if (!name) return;

  const extraMembers = membersRaw ? membersRaw.split(",").map((m) => m.trim()).filter(Boolean) : [];
  const members = Array.from(new Set([userProfile.fullName, ...extraMembers]));

  const ref = await addDoc(collection(db, "users", currentUser.uid, "workspaces"), {
    name,
    members,
    categories: ["Food & Groceries", "Rent & Bills", "Utilities", "Travel", "Shopping", "Other"],
    upiId: userProfile.upiId || "",
    budgetLimit,
    createdAt: serverTimestamp()
  });

  activeWorkspaceId = ref.id;
  document.getElementById("ws-create-name").value = "";
  document.getElementById("ws-create-members").value = "";
  document.getElementById("workspace-modal").classList.add("hidden");
  showToast(`Workspace "${name}" created!`, "success");
};

function renderCustomizeLists(ws) {
  const membersEl = document.getElementById("custom-members-list");
  membersEl.innerHTML = "";
  (ws.members || []).forEach((m) => {
    const chip = document.createElement("span");
    chip.className = "inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-xs text-emerald-200 font-semibold";
    chip.innerHTML = `${escapeHtml(m)} <button type="button" class="text-emerald-400 hover:text-red-400"><i class="fa-solid fa-xmark"></i></button>`;
    chip.querySelector("button").onclick = async () => {
      if (ws.members.length <= 1) return showToast("At least 1 member is required.", "error");
      const updated = ws.members.filter((item) => item !== m);
      await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id), { members: updated });
    };
    membersEl.appendChild(chip);
  });

  const catsEl = document.getElementById("custom-categories-list");
  catsEl.innerHTML = "";
  (ws.categories || []).forEach((c) => {
    const chip = document.createElement("span");
    chip.className = "inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-xs text-amber-200 font-semibold";
    chip.innerHTML = `${escapeHtml(c)} <button type="button" class="text-amber-400 hover:text-red-400"><i class="fa-solid fa-xmark"></i></button>`;
    chip.querySelector("button").onclick = async () => {
      if (ws.categories.length <= 1) return;
      const updated = ws.categories.filter((item) => item !== c);
      await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id), { categories: updated });
    };
    catsEl.appendChild(chip);
  });
}

document.getElementById("save-ws-settings-btn").onclick = async () => {
  const ws = getActiveWorkspace();
  if (!ws) return;
  const name = document.getElementById("custom-ws-name").value.trim() || ws.name;
  const upiId = document.getElementById("custom-ws-upi").value.trim();
  const budgetLimit = Number(document.getElementById("custom-ws-budget").value) || 5000;
  await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id), { name, upiId, budgetLimit });
  showToast("Workspace settings saved!", "success");
};

document.getElementById("add-member-btn").onclick = async () => {
  const ws = getActiveWorkspace();
  const input = document.getElementById("new-member-input");
  const val = input.value.trim();
  if (!ws || !val || ws.members.includes(val)) return;
  input.value = "";
  await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id), {
    members: [...ws.members, val]
  });
  showToast(`Added ${val}`, "success");
};

document.getElementById("add-category-btn").onclick = async () => {
  const ws = getActiveWorkspace();
  const input = document.getElementById("new-category-input");
  const val = input.value.trim();
  if (!ws || !val || ws.categories.includes(val)) return;
  input.value = "";
  await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id), {
    categories: [...ws.categories, val]
  });
  showToast(`Category "${val}" added`, "success");
};

document.getElementById("delete-workspace-btn").onclick = async () => {
  const ws = getActiveWorkspace();
  if (!ws || workspaces.length <= 1) {
    showToast("You must keep at least one workspace.", "error");
    return;
  }
  await deleteDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id));
  activeWorkspaceId = null;
  showToast("Workspace deleted", "info");
};

// ==================== 5. EXPENSE CRUD & SEARCH/FILTER ====================
document.getElementById("search-expense-input").oninput = () => recalculateAndRenderAll();
document.getElementById("filter-category-select").onchange = () => recalculateAndRenderAll();

function openExpenseModal(expense = null) {
  const ws = getActiveWorkspace();
  if (!ws) return;

  editingExpenseId = expense ? expense.id : null;
  document.getElementById("expense-modal-title").textContent = expense ? "Edit Expense" : "Add Expense";
  document.getElementById("exp-title-input").value = expense ? expense.title : "";
  document.getElementById("exp-amount-input").value = expense ? expense.amount : "";
  document.getElementById("exp-date-input").value = expense?.date || new Date().toISOString().split("T")[0];
  document.getElementById("exp-notes-input").value = expense?.notes || "";

  const catSel = document.getElementById("exp-category-select");
  catSel.innerHTML = ws.categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  if (expense?.category) catSel.value = expense.category;

  const paidSel = document.getElementById("exp-paidby-select");
  paidSel.innerHTML = ws.members.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");
  if (expense?.paidBy) paidSel.value = expense.paidBy;

  const splitWrap = document.getElementById("exp-split-checkboxes");
  const activeSplits = expense?.splitBetween || ws.members;
  splitWrap.innerHTML = ws.members
    .map(
      (m) => `
      <label class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl glass-input text-xs text-slate-200 cursor-pointer">
        <input type="checkbox" value="${escapeHtml(m)}" class="split-member-cb accent-cyan-400" ${activeSplits.includes(m) ? "checked" : ""} />
        <span>${escapeHtml(m)}</span>
      </label>`
    )
    .join("");

  document.getElementById("expense-modal").classList.remove("hidden");
}

document.getElementById("open-manual-expense-btn").onclick = () => openExpenseModal(null);
document.getElementById("close-expense-modal").onclick = () => {
  document.getElementById("expense-modal").classList.add("hidden");
};

document.getElementById("save-expense-btn").onclick = async () => {
  const ws = getActiveWorkspace();
  if (!ws) return;

  const title = document.getElementById("exp-title-input").value.trim() || "Shared Expense";
  const amount = parseFloat(document.getElementById("exp-amount-input").value);
  const category = document.getElementById("exp-category-select").value;
  const paidBy = document.getElementById("exp-paidby-select").value;
  const date = document.getElementById("exp-date-input").value || new Date().toISOString().split("T")[0];
  const notes = document.getElementById("exp-notes-input").value.trim();
  const splitBetween = Array.from(document.querySelectorAll(".split-member-cb:checked")).map((cb) => cb.value);

  if (!amount || amount <= 0 || splitBetween.length === 0) {
    showToast("Enter a valid amount and select at least 1 member.", "error");
    return;
  }

  const payload = {
    title,
    amount,
    category,
    paidBy,
    date,
    notes,
    splitBetween,
    updatedAt: serverTimestamp()
  };

  if (editingExpenseId) {
    await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id, "expenses", editingExpenseId), payload);
    showToast("Expense updated", "success");
  } else {
    payload.createdAt = serverTimestamp();
    await addDoc(collection(db, "users", currentUser.uid, "workspaces", ws.id, "expenses"), payload);
    showToast("Expense added!", "success");
  }

  document.getElementById("expense-modal").classList.add("hidden");
};

// ==================== 6. SMART SPLIT, CHARTS & RENDERING ====================
function recalculateAndRenderAll() {
  const ws = getActiveWorkspace();
  if (!ws) return;
  const cur = getCurrency();

  const totalSpent = currentExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const memberCount = ws.members.length || 1;
  const perHead = totalSpent / memberCount;

  document.getElementById("stat-total-spent").textContent = `${cur}${totalSpent.toFixed(0)}`;
  document.getElementById("stat-per-head").textContent = `${cur}${perHead.toFixed(0)}`;
  document.getElementById("stat-member-count").textContent = String(memberCount);

  // Update Monthly Budget Progress Bar
  const budgetLimit = Number(ws.budgetLimit) || 5000;
  const pct = Math.min(100, Math.round((totalSpent / budgetLimit) * 100));
  document.getElementById("budget-text").textContent = `${cur}${totalSpent.toFixed(0)} / ${cur}${budgetLimit}`;
  const barFill = document.getElementById("budget-bar-fill");
  barFill.style.width = `${pct}%`;
  barFill.className =
    pct >= 90
      ? "h-full rounded-full bg-gradient-to-r from-rose-500 to-red-500 transition-all duration-500"
      : pct >= 70
      ? "h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-500"
      : "h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-all duration-500";

  // Filter Expenses for List
  const searchTerm = (document.getElementById("search-expense-input").value || "").trim().toLowerCase();
  const filterCat = document.getElementById("filter-category-select").value;
  const filteredExpenses = currentExpenses.filter((exp) => {
    const matchesCat = filterCat === "ALL" || exp.category === filterCat;
    const matchesText =
      !searchTerm ||
      (exp.title || "").toLowerCase().includes(searchTerm) ||
      (exp.paidBy || "").toLowerCase().includes(searchTerm) ||
      (exp.notes || "").toLowerCase().includes(searchTerm);
    return matchesCat && matchesText;
  });

  const listEl = document.getElementById("expenses-list");
  listEl.innerHTML = "";
  if (filteredExpenses.length === 0) {
    listEl.innerHTML = `<div class="glass-card rounded-2xl p-6 text-center text-xs text-slate-400">No matching expenses found.</div>`;
  } else {
    filteredExpenses.forEach((exp) => {
      const card = document.createElement("div");
      card.className = "glass-card rounded-2xl p-3.5 flex items-center justify-between gap-3";
      card.innerHTML = `
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-white truncate">${escapeHtml(exp.title)}</span>
            <span class="px-2 py-0.5 rounded-md bg-blue-500/15 text-cyan-300 text-[10px] font-bold shrink-0">${escapeHtml(exp.category)}</span>
          </div>
          <p class="text-[11px] text-slate-400 mt-1">
            Paid by <strong class="text-emerald-300">${escapeHtml(exp.paidBy)}</strong> • Split ${(exp.splitBetween || []).length} ways ${exp.date ? `• ${escapeHtml(exp.date)}` : ""}
          </p>
          ${exp.notes ? `<p class="text-[10px] text-slate-500 mt-0.5 truncate">${escapeHtml(exp.notes)}</p>` : ""}
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="text-sm font-extrabold text-white">${cur}${Number(exp.amount).toFixed(0)}</span>
          <button class="edit-exp-btn p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"><i class="fa-solid fa-pen"></i></button>
          <button class="del-exp-btn p-1.5 rounded-lg bg-slate-800 hover:bg-red-500/25 text-slate-400 hover:text-red-400 text-xs"><i class="fa-solid fa-trash"></i></button>
        </div>
      `;
      card.querySelector(".edit-exp-btn").onclick = () => openExpenseModal(exp);
      card.querySelector(".del-exp-btn").onclick = async () => {
        await deleteDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id, "expenses", exp.id));
        showToast("Expense deleted", "info");
      };
      listEl.appendChild(card);
    });
  }

  // Calculate Net Balances & Paid Totals
  const balances = {};
  const paidTotals = {};
  ws.members.forEach((m) => {
    balances[m] = 0;
    paidTotals[m] = 0;
  });

  currentExpenses.forEach((exp) => {
    const amt = Number(exp.amount) || 0;
    const payer = exp.paidBy;
    const splitters = (exp.splitBetween || []).filter((m) => Object.prototype.hasOwnProperty.call(balances, m));
    if (Object.prototype.hasOwnProperty.call(balances, payer)) {
      balances[payer] += amt;
      paidTotals[payer] += amt;
    }
    if (splitters.length > 0) {
      const share = amt / splitters.length;
      splitters.forEach((s) => (balances[s] -= share));
    }
  });

  // Render Member Balances
  const balEl = document.getElementById("member-balances-list");
  balEl.innerHTML = "";
  Object.entries(balances).forEach(([member, net]) => {
    const isPositive = net >= -0.01;
    const row = document.createElement("div");
    row.className = "flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-[#080c17] border border-slate-800 text-xs";
    row.innerHTML = `
      <div>
        <span class="font-bold text-white">${escapeHtml(member)}</span>
        <span class="text-[10px] text-slate-500 ml-2">Paid ${cur}${(paidTotals[member] || 0).toFixed(0)}</span>
      </div>
      <span class="font-extrabold ${isPositive ? "text-emerald-400" : "text-rose-400"}">
        ${isPositive ? `Gets back ${cur}${Math.abs(net).toFixed(0)}` : `Owes ${cur}${Math.abs(net).toFixed(0)}`}
      </span>
    `;
    balEl.appendChild(row);
  });

  // Minimum Transfers Settlement Algorithm
  const debtors = [];
  const creditors = [];
  Object.entries(balances).forEach(([person, amt]) => {
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

  const settleEl = document.getElementById("settlements-list");
  settleEl.innerHTML = "";
  if (transfers.length === 0) {
    settleEl.innerHTML = `<p class="text-xs text-slate-400">Everyone is settled up! Zero pending dues.</p>`;
  } else {
    transfers.forEach((tr) => {
      const upiId = ws.upiId || userProfile.upiId || "";
      const upiLink = upiId
        ? `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(tr.to)}&am=${tr.amount.toFixed(0)}&cu=INR`
        : null;

      const card = document.createElement("div");
      card.className = "flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-[#080c17] border border-slate-800 text-xs";
      card.innerHTML = `
        <div>
          <span class="font-bold text-rose-300">${escapeHtml(tr.from)}</span>
          <i class="fa-solid fa-arrow-right mx-1.5 text-slate-500"></i>
          <span class="font-bold text-emerald-300">${escapeHtml(tr.to)}</span>
          <span class="ml-2 font-extrabold text-white">${cur}${tr.amount.toFixed(0)}</span>
        </div>
        <div class="flex items-center gap-1.5">
          ${
            upiLink
              ? `<a href="${upiLink}" class="px-2.5 py-1.5 rounded-lg bg-emerald-500 text-slate-950 font-bold text-[11px]">Pay UPI</a>
                 <button type="button" class="qr-btn px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 font-bold text-[11px]"><i class="fa-solid fa-qrcode"></i></button>`
              : ""
          }
          <button type="button" class="settle-btn px-2.5 py-1.5 rounded-lg bg-blue-600/25 hover:bg-blue-600/40 text-cyan-200 border border-blue-500/30 font-bold text-[11px]">Settle</button>
        </div>
      `;

      const qrBtn = card.querySelector(".qr-btn");
      if (qrBtn && upiLink) {
        qrBtn.onclick = () => {
          document.getElementById("qr-title").textContent = `${tr.from} → ${tr.to} (${cur}${tr.amount.toFixed(0)})`;
          document.getElementById("qr-upi-text").textContent = `UPI ID: ${upiId}`;
          document.getElementById("qr-image").src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(upiLink)}`;
          document.getElementById("qr-modal").classList.remove("hidden");
        };
      }

      card.querySelector(".settle-btn").onclick = async () => {
        await addDoc(collection(db, "users", currentUser.uid, "workspaces", ws.id, "expenses"), {
          title: `Settlement: ${tr.from} → ${tr.to}`,
          amount: Number(tr.amount.toFixed(2)),
          category: "Settlement",
          paidBy: tr.from,
          splitBetween: [tr.to],
          date: new Date().toISOString().split("T")[0],
          notes: "Marked as settled",
          createdAt: serverTimestamp()
        });
        showToast("Settlement recorded!", "success");
      };

      settleEl.appendChild(card);
    });
  }

  renderAnalyticsCharts(ws, paidTotals, totalSpent, cur);
}

document.getElementById("close-qr-modal").onclick = () => {
  document.getElementById("qr-modal").classList.add("hidden");
};

// ==================== 7. ANALYTICS CHARTS (CHART.JS) ====================
function renderAnalyticsCharts(ws, paidTotals, totalSpent, cur) {
  const catTotals = {};
  currentExpenses.forEach((e) => {
    if (e.category === "Settlement") return;
    catTotals[e.category] = (catTotals[e.category] || 0) + (Number(e.amount) || 0);
  });

  const catLabels = Object.keys(catTotals);
  const catValues = Object.values(catTotals);
  const palette = ["#22d3ee", "#3b82f6", "#10b981", "#f59e0b", "#a855f7", "#f43f5e"];

  const catCanvas = document.getElementById("category-chart");
  if (catCanvas && typeof Chart !== "undefined") {
    if (categoryChartInstance) categoryChartInstance.destroy();
    categoryChartInstance = new Chart(catCanvas, {
      type: "doughnut",
      data: {
        labels: catLabels.length ? catLabels : ["No Data"],
        datasets: [
          {
            data: catValues.length ? catValues : [1],
            backgroundColor: catValues.length ? palette : ["#1e293b"],
            borderWidth: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { color: "#cbd5e1", font: { size: 10 } } } }
      }
    });
  }

  const memCanvas = document.getElementById("member-chart");
  if (memCanvas && typeof Chart !== "undefined") {
    if (memberChartInstance) memberChartInstance.destroy();
    memberChartInstance = new Chart(memCanvas, {
      type: "bar",
      data: {
        labels: ws.members,
        datasets: [
          {
            label: `Paid (${cur})`,
            data: ws.members.map((m) => paidTotals[m] || 0),
            backgroundColor: "#22d3ee",
            borderRadius: 8
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#94a3b8", font: { size: 10 } }, grid: { display: false } },
          y: { ticks: { color: "#94a3b8", font: { size: 10 } }, grid: { color: "#1e293b" } }
        }
      }
    });
  }

  // Category Breakdown List
  const bdList = document.getElementById("category-breakdown-list");
  bdList.innerHTML = "";
  if (catLabels.length === 0) {
    bdList.innerHTML = `<p class="text-xs text-slate-400">Add expenses to view category breakdown.</p>`;
  } else {
    catLabels.forEach((cat, idx) => {
      const val = catTotals[cat];
      const share = totalSpent > 0 ? Math.round((val / totalSpent) * 100) : 0;
      const row = document.createElement("div");
      row.className = "flex items-center justify-between text-xs px-3 py-2 rounded-xl bg-[#080c17] border border-slate-800";
      row.innerHTML = `
        <span class="font-semibold text-white flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full" style="background:${palette[idx % palette.length]}"></span>
          ${escapeHtml(cat)}
        </span>
        <span class="font-bold text-slate-300">${cur}${val.toFixed(0)} <span class="text-slate-500">(${share}%)</span></span>
      `;
      bdList.appendChild(row);
    });
  }
}

// ==================== 8. GEMINI AI ENGINE (VISION RECEIPT + NLP + AUDIT) ====================
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
  return { text: null, error: lastError || "AI service unavailable" };
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

// 1. Natural Language Smart Entry
document.getElementById("ai-parse-btn").onclick = async () => {
  const ws = getActiveWorkspace();
  const input = document.getElementById("ai-smart-input");
  const statusEl = document.getElementById("ai-status-line");
  const rawText = input.value.trim();
  if (!ws || !rawText) return;

  statusEl.textContent = "Gemini AI is parsing your expense...";
  statusEl.classList.remove("hidden");

  const prompt = `Extract expense details from this text: "${rawText}".
Members list: ${JSON.stringify(ws.members)}.
Categories list: ${JSON.stringify(ws.categories)}.
Return ONLY a JSON object with keys: "title" (string), "amount" (number), "paidBy" (string matching members list or "${ws.members[0]}"), "category" (string matching categories list).`;

  const { text, error } = await callGeminiAI([{ text: prompt }]);
  const parsed = extractJsonObject(text);

  if (parsed && Number(parsed.amount) > 0) {
    await addDoc(collection(db, "users", currentUser.uid, "workspaces", ws.id, "expenses"), {
      title: parsed.title || rawText,
      amount: Number(parsed.amount),
      paidBy: ws.members.includes(parsed.paidBy) ? parsed.paidBy : ws.members[0],
      category: ws.categories.includes(parsed.category) ? parsed.category : ws.categories[0],
      splitBetween: ws.members,
      date: new Date().toISOString().split("T")[0],
      notes: "Added via Gemini AI",
      createdAt: serverTimestamp()
    });
    input.value = "";
    statusEl.textContent = `Added: ${parsed.title} (${getCurrency()}${parsed.amount}) paid by ${parsed.paidBy}`;
    setTimeout(() => statusEl.classList.add("hidden"), 3500);
  } else {
    statusEl.textContent = error ? `AI Error: ${error}` : 'Try format: "Sam paid 350 for lunch"';
  }
};

// 2. Gemini Vision Receipt Scanner (with auto image compression)
document.getElementById("ai-receipt-input").onchange = async (e) => {
  const file = e.target.files[0];
  const ws = getActiveWorkspace();
  if (!file || !ws) return;

  const statusEl = document.getElementById("ai-status-line");
  statusEl.textContent = "Compressing & scanning receipt with Gemini Vision...";
  statusEl.classList.remove("hidden");

  try {
    const compressed = await compressImageFile(file, 960, 0.82);
    const prompt = `Analyze this receipt or bill image. Find the shop/merchant name or main item as "title", the final grand total amount as a pure number "amount", and pick the best category from ${JSON.stringify(ws.categories)} as "category".
Return ONLY a JSON object like {"title": "Supermarket Bill", "amount": 450, "category": "Food & Groceries"}.`;

    const { text, error } = await callGeminiAI([
      { text: prompt },
      { inline_data: { mime_type: compressed.mime, data: compressed.base64 } }
    ]);

    const parsed = extractJsonObject(text);
    if (parsed && Number(parsed.amount) > 0) {
      await addDoc(collection(db, "users", currentUser.uid, "workspaces", ws.id, "expenses"), {
        title: parsed.title || "Scanned Receipt",
        amount: Number(parsed.amount),
        paidBy: ws.members[0],
        category: ws.categories.includes(parsed.category) ? parsed.category : ws.categories[0],
        splitBetween: ws.members,
        date: new Date().toISOString().split("T")[0],
        notes: "Scanned with Gemini Vision",
        createdAt: serverTimestamp()
      });
      statusEl.textContent = `Receipt Scanned: ${parsed.title} — ${getCurrency()}${parsed.amount}`;
      setTimeout(() => statusEl.classList.add("hidden"), 4000);
    } else {
      statusEl.textContent = error ? `AI Vision Error: ${error}` : "Could not detect total on receipt. Try a clearer photo.";
    }
  } catch (err) {
    statusEl.textContent = "Failed to process image.";
  }
  e.target.value = "";
};

// 3. AI Spending Audit
document.getElementById("ai-audit-btn").onclick = async () => {
  const ws = getActiveWorkspace();
  const statusEl = document.getElementById("ai-status-line");
  if (!ws || currentExpenses.length === 0) {
    statusEl.textContent = "Add a few expenses first to run an AI Audit.";
    statusEl.classList.remove("hidden");
    return;
  }

  statusEl.textContent = "Gemini AI is auditing your group expenses...";
  statusEl.classList.remove("hidden");

  const summary = currentExpenses
    .slice(0, 25)
    .map((e) => `${e.title}: ${getCurrency()}${e.amount} (${e.category}, paid by ${e.paidBy})`)
    .join("; ");

  const { text, error } = await callGeminiAI([
    {
      text: `Audit these shared expenses for "${ws.name}": ${summary}. Give 2 short, smart financial insights and saving tips in simple English (max 45 words).`
    }
  ]);

  statusEl.textContent = text || `AI Audit unavailable: ${error}`;
};

// ==================== 9. PDF REPORT, WHATSAPP SHARE & TABS ====================
document.getElementById("export-pdf-btn").onclick = () => {
  const ws = getActiveWorkspace();
  if (!ws) return;
  const { jsPDF } = window.jspdf;
  const docPdf = new jsPDF();

  docPdf.setFontSize(16);
  docPdf.text(`Hisab-Cloud Report: ${ws.name}`, 14, 18);
  docPdf.setFontSize(10);
  docPdf.text(`Account: ${userProfile.fullName} (@${userProfile.username}) • Date: ${new Date().toLocaleDateString()}`, 14, 25);

  const rows = currentExpenses.map((e) => [
    e.date || "-",
    e.title,
    e.category,
    e.paidBy,
    `${e.amount}`
  ]);

  docPdf.autoTable({
    startY: 32,
    head: [["Date", "Description", "Category", "Paid By", "Amount"]],
    body: rows
  });

  docPdf.save(`${ws.name.replace(/\s+/g, "_")}_HisabCloud_Report.pdf`);
  showToast("PDF Report downloaded!", "success");
};

document.getElementById("share-whatsapp-btn").onclick = () => {
  const ws = getActiveWorkspace();
  if (!ws) return;
  const cur = getCurrency();
  const total = currentExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const text = `*Hisab-Cloud — ${ws.name}*\nTotal Spent: ${cur}${total.toFixed(0)}\nMembers: ${ws.members.join(", ")}\nManage live: ${window.location.href}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
};

document.querySelectorAll(".nav-tab").forEach((tab) => {
  tab.onclick = () => {
    const target = tab.dataset.tab;
    document.querySelectorAll(".nav-tab").forEach((t) => {
      t.className = "nav-tab py-2 rounded-xl text-slate-400 hover:text-white transition";
    });
    tab.className = "nav-tab py-2 rounded-xl bg-blue-600 text-white transition";

    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("hidden", panel.id !== `tab-${target}`);
    });
  };
});

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}
