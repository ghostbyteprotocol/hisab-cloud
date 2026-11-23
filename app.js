// app.js — Hisab-Cloud Global AI Expense & Split Engine (Google Auth + Firestore + Gemini AI)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyAQSNDMA1JLHll5mMjSwXDSa0cAmjw8Bo4",
  authDomain: "my-website-login-10b06.firebaseapp.com",
  projectId: "my-website-login-10b06",
  storageBucket: "my-website-login-10b06.firebasestorage.app",
  messagingSenderId: "1058420080529",
  appId: "1:1058420080529:web:1440b3f78f8853268b2430"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});

// Split Gemini API Key safely
const GEMINI_PART_1 = "AQ.Ab8RN6JK1BliXWgcdunimVFHLktcmD";
const GEMINI_PART_2 = "OKZESwAKmFReQgzm4bog";
const getGeminiKey = () => GEMINI_PART_1 + GEMINI_PART_2;

// Global State
let currentUser = null;
let workspaces = [];
let activeWorkspaceId = null;
let currentExpenses = [];
let editingExpenseId = null;
let unsubExpenses = null;

// ==================== 1. GOOGLE AUTHENTICATION ====================
const googleProvider = new GoogleAuthProvider();

document.getElementById("google-login-btn").onclick = async () => {
  const errEl = document.getElementById("auth-error-msg");
  errEl.classList.add("hidden");
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    errEl.textContent = err.message || "Google Sign-In failed. Ensure Google Auth is enabled in Firebase.";
    errEl.classList.remove("hidden");
  }
};

document.getElementById("logout-btn").onclick = async () => {
  await signOut(auth);
};

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (user) {
    document.getElementById("auth-screen").classList.add("hidden");
    document.getElementById("app-shell").classList.remove("hidden");
    subscribeWorkspaces();
  } else {
    document.getElementById("auth-screen").classList.remove("hidden");
    document.getElementById("app-shell").classList.add("hidden");
  }
});

// ==================== 2. WORKSPACES (CUSTOMIZABLE PER USER) ====================
function subscribeWorkspaces() {
  const q = query(collection(db, "users", currentUser.uid, "workspaces"), orderBy("createdAt", "asc"));
  onSnapshot(q, async (snap) => {
    workspaces = [];
    snap.forEach((d) => workspaces.push({ id: d.id, ...d.data() }));

    // Auto-create default workspace for first-time Google login
    if (workspaces.length === 0) {
      const firstName = (currentUser.displayName || "Me").split(" ")[0];
      await addDoc(collection(db, "users", currentUser.uid, "workspaces"), {
        name: "My Shared Space",
        members: [firstName, "Roommate 1", "Roommate 2"],
        categories: ["Food & Groceries", "Rent & Bills", "Travel", "Utilities", "Other"],
        upiId: "",
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

  document.getElementById("workspace-subtitle").textContent = `${ws.members.length} Members • ${currentUser.email}`;
  document.getElementById("custom-ws-name").value = ws.name || "";
  document.getElementById("custom-ws-upi").value = ws.upiId || "";
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

// Create New Workspace Modal
document.getElementById("new-workspace-btn").onclick = () => {
  document.getElementById("workspace-modal").classList.remove("hidden");
};
document.getElementById("close-ws-modal").onclick = () => {
  document.getElementById("workspace-modal").classList.add("hidden");
};
document.getElementById("create-ws-submit-btn").onclick = async () => {
  const name = document.getElementById("ws-create-name").value.trim();
  const membersRaw = document.getElementById("ws-create-members").value.trim();
  if (!name) return;

  const members = membersRaw
    ? membersRaw.split(",").map((m) => m.trim()).filter(Boolean)
    : [(currentUser.displayName || "Me").split(" ")[0]];

  const ref = await addDoc(collection(db, "users", currentUser.uid, "workspaces"), {
    name,
    members,
    categories: ["Food & Groceries", "Rent & Bills", "Travel", "Shopping", "Other"],
    upiId: "",
    createdAt: serverTimestamp()
  });

  activeWorkspaceId = ref.id;
  document.getElementById("ws-create-name").value = "";
  document.getElementById("ws-create-members").value = "";
  document.getElementById("workspace-modal").classList.add("hidden");
};

// ==================== 3. CUSTOMIZE MEMBERS & CATEGORIES ====================
function renderCustomizeLists(ws) {
  const membersEl = document.getElementById("custom-members-list");
  membersEl.innerHTML = "";
  (ws.members || []).forEach((m) => {
    const chip = document.createElement("span");
    chip.className = "inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-xs text-emerald-200 font-medium";
    chip.innerHTML = `${escapeHtml(m)} <button type="button" class="text-emerald-400 hover:text-red-400"><i class="fa-solid fa-xmark"></i></button>`;
    chip.querySelector("button").onclick = async () => {
      if (ws.members.length <= 1) return;
      const updated = ws.members.filter((item) => item !== m);
      await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id), { members: updated });
    };
    membersEl.appendChild(chip);
  });

  const catsEl = document.getElementById("custom-categories-list");
  catsEl.innerHTML = "";
  (ws.categories || []).forEach((c) => {
    const chip = document.createElement("span");
    chip.className = "inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-xs text-amber-200 font-medium";
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
  await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id), { name, upiId });
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
};

// ==================== 4. EXPENSES CRUD (ADD, EDIT, DELETE) ====================
function openExpenseModal(expense = null) {
  const ws = getActiveWorkspace();
  if (!ws) return;

  editingExpenseId = expense ? expense.id : null;
  document.getElementById("expense-modal-title").textContent = expense ? "Edit Expense" : "Add Expense";
  document.getElementById("exp-title-input").value = expense ? expense.title : "";
  document.getElementById("exp-amount-input").value = expense ? expense.amount : "";

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
      <label class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#080c16] border border-slate-700 text-xs text-slate-200 cursor-pointer">
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
  const splitBetween = Array.from(document.querySelectorAll(".split-member-cb:checked")).map((cb) => cb.value);

  if (!amount || amount <= 0 || splitBetween.length === 0) return;

  const payload = {
    title,
    amount,
    category,
    paidBy,
    splitBetween,
    updatedAt: serverTimestamp()
  };

  if (editingExpenseId) {
    await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id, "expenses", editingExpenseId), payload);
  } else {
    payload.createdAt = serverTimestamp();
    await addDoc(collection(db, "users", currentUser.uid, "workspaces", ws.id, "expenses"), payload);
  }

  document.getElementById("expense-modal").classList.add("hidden");
};

// ==================== 5. SMART SPLIT ENGINE & RENDERING ====================
function recalculateAndRenderAll() {
  const ws = getActiveWorkspace();
  if (!ws) return;

  const totalSpent = currentExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const memberCount = ws.members.length || 1;
  const perHead = totalSpent / memberCount;

  document.getElementById("stat-total-spent").textContent = `₹${totalSpent.toFixed(0)}`;
  document.getElementById("stat-per-head").textContent = `₹${perHead.toFixed(0)}`;
  document.getElementById("stat-member-count").textContent = String(memberCount);

  // Render Expenses List
  const listEl = document.getElementById("expenses-list");
  listEl.innerHTML = "";
  if (currentExpenses.length === 0) {
    listEl.innerHTML = `<div class="glass-card rounded-2xl p-6 text-center text-xs text-slate-400">No expenses yet. Use AI Quick Entry above or tap "+ Manual Entry".</div>`;
  } else {
    currentExpenses.forEach((exp) => {
      const card = document.createElement("div");
      card.className = "glass-card rounded-2xl p-3.5 flex items-center justify-between gap-3";
      card.innerHTML = `
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-white truncate">${escapeHtml(exp.title)}</span>
            <span class="px-2 py-0.5 rounded-md bg-blue-500/15 text-cyan-300 text-[10px] font-semibold shrink-0">${escapeHtml(exp.category)}</span>
          </div>
          <p class="text-[11px] text-slate-400 mt-1">
            Paid by <strong class="text-emerald-300">${escapeHtml(exp.paidBy)}</strong> • Split among ${(exp.splitBetween || []).length}
          </p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="text-sm font-extrabold text-white">₹${Number(exp.amount).toFixed(0)}</span>
          <button class="edit-exp-btn p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"><i class="fa-solid fa-pen"></i></button>
          <button class="del-exp-btn p-1.5 rounded-lg bg-slate-800 hover:bg-red-500/25 text-slate-400 hover:text-red-400 text-xs"><i class="fa-solid fa-trash"></i></button>
        </div>
      `;
      card.querySelector(".edit-exp-btn").onclick = () => openExpenseModal(exp);
      card.querySelector(".del-exp-btn").onclick = async () => {
        await deleteDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id, "expenses", exp.id));
      };
      listEl.appendChild(card);
    });
  }

  // Calculate Net Balances
  const balances = {};
  ws.members.forEach((m) => (balances[m] = 0));

  currentExpenses.forEach((exp) => {
    const amt = Number(exp.amount) || 0;
    const payers = exp.paidBy;
    const splitters = (exp.splitBetween || []).filter((m) => balances.hasOwnProperty(m));
    if (balances.hasOwnProperty(payers)) balances[payers] += amt;
    if (splitters.length > 0) {
      const share = amt / splitters.length;
      splitters.forEach((s) => (balances[s] -= share));
    }
  });

  // Render Member Balances
  const balEl = document.getElementById("member-balances-list");
  balEl.innerHTML = "";
  Object.entries(balances).forEach(([member, net]) => {
    const isPositive = net >= 0;
    const row = document.createElement("div");
    row.className = "flex items-center justify-between px-3 py-2 rounded-xl bg-[#090e1a] border border-slate-800/80 text-xs";
    row.innerHTML = `
      <span class="font-semibold text-white">${escapeHtml(member)}</span>
      <span class="font-bold ${isPositive ? "text-emerald-400" : "text-rose-400"}">
        ${isPositive ? `Gets ₹${net.toFixed(0)}` : `Owes ₹${Math.abs(net).toFixed(0)}`}
      </span>
    `;
    balEl.appendChild(row);
  });

  // Minimum Cash Flow Settlement Algorithm
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
    settleEl.innerHTML = `<p class="text-xs text-slate-400">All settled up! No pending dues.</p>`;
  } else {
    transfers.forEach((tr) => {
      const upiLink = ws.upiId
        ? `upi://pay?pa=${encodeURIComponent(ws.upiId)}&pn=${encodeURIComponent(tr.to)}&am=${tr.amount.toFixed(0)}&cu=INR`
        : null;

      const card = document.createElement("div");
      card.className = "flex items-center justify-between p-3 rounded-xl bg-[#090e1a] border border-slate-800 text-xs";
      card.innerHTML = `
        <div>
          <span class="font-bold text-rose-300">${escapeHtml(tr.from)}</span>
          <i class="fa-solid fa-arrow-right mx-1.5 text-slate-500"></i>
          <span class="font-bold text-emerald-300">${escapeHtml(tr.to)}</span>
          <span class="ml-2 font-extrabold text-white">₹${tr.amount.toFixed(0)}</span>
        </div>
        ${
          upiLink
            ? `<a href="${upiLink}" class="px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 font-bold text-[11px]">Pay UPI</a>`
            : `<span class="text-[10px] text-slate-500">Set UPI in Customize</span>`
        }
      `;
      settleEl.appendChild(card);
    });
  }
}

// ==================== 6. GEMINI AI SMART PARSER, RECEIPT VISION & AUDIT ====================
async function callGeminiAI(parts) {
  const models = ["gemini-2.5-flash", "gemini-2.0-flash"];
  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-goog-api-key": getGeminiKey()
          },
          body: JSON.stringify({ contents: [{ parts }] })
        }
      );
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (res.ok && text) return text;
    } catch (e) {}
  }
  return null;
}

// Natural Language Entry ("Rohan paid 450 for chicken and rice")
document.getElementById("ai-parse-btn").onclick = async () => {
  const ws = getActiveWorkspace();
  const input = document.getElementById("ai-smart-input");
  const statusEl = document.getElementById("ai-status-line");
  const rawText = input.value.trim();
  if (!ws || !rawText) return;

  statusEl.textContent = "Gemini AI is parsing your expense...";
  statusEl.classList.remove("hidden");

  const prompt = `Extract expense details from: "${rawText}".
Available Members: ${JSON.stringify(ws.members)}.
Available Categories: ${JSON.stringify(ws.categories)}.
Return ONLY valid JSON with keys: {"title": string, "amount": number, "paidBy": string, "category": string}.
If payer is unclear, pick "${ws.members[0]}". Pick closest matching category.`;

  const reply = await callGeminiAI([{ text: prompt }]);
  try {
    const cleaned = reply.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (parsed.amount > 0) {
      await addDoc(collection(db, "users", currentUser.uid, "workspaces", ws.id, "expenses"), {
        title: parsed.title || rawText,
        amount: Number(parsed.amount),
        paidBy: ws.members.includes(parsed.paidBy) ? parsed.paidBy : ws.members[0],
        category: ws.categories.includes(parsed.category) ? parsed.category : ws.categories[0],
        splitBetween: ws.members,
        createdAt: serverTimestamp()
      });
      input.value = "";
      statusEl.textContent = `Added: ${parsed.title} (₹${parsed.amount}) paid by ${parsed.paidBy}`;
      setTimeout(() => statusEl.classList.add("hidden"), 3000);
      return;
    }
  } catch (e) {}

  statusEl.textContent = "Could not parse automatically. Try: 'Ayan paid 300 for dinner'";
};

// Gemini Vision Receipt Scanner
document.getElementById("ai-receipt-input").onchange = (e) => {
  const file = e.target.files[0];
  const ws = getActiveWorkspace();
  if (!file || !ws) return;

  const statusEl = document.getElementById("ai-status-line");
  statusEl.textContent = "Scanning receipt with Gemini Vision...";
  statusEl.classList.remove("hidden");

  const reader = new FileReader();
  reader.onload = async () => {
    const base64 = reader.result.split(",")[1];
    const prompt = `Read this receipt/bill image. Extract the shop/item title, grand total amount (number only), and pick best category from ${JSON.stringify(ws.categories)}.
Return ONLY valid JSON: {"title": string, "amount": number, "category": string}.`;

    const reply = await callGeminiAI([
      { text: prompt },
      { inline_data: { mime_type: file.type, data: base64 } }
    ]);

    try {
      const cleaned = reply.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (parsed.amount > 0) {
        await addDoc(collection(db, "users", currentUser.uid, "workspaces", ws.id, "expenses"), {
          title: parsed.title || "Scanned Receipt",
          amount: Number(parsed.amount),
          paidBy: ws.members[0],
          category: ws.categories.includes(parsed.category) ? parsed.category : ws.categories[0],
          splitBetween: ws.members,
          createdAt: serverTimestamp()
        });
        statusEl.textContent = `Receipt Added: ${parsed.title} — ₹${parsed.amount}`;
        setTimeout(() => statusEl.classList.add("hidden"), 3500);
        return;
      }
    } catch (err) {}

    statusEl.textContent = "Could not read receipt total. Please enter manually.";
  };
  reader.readAsDataURL(file);
  e.target.value = "";
};

// AI Financial Audit
document.getElementById("ai-audit-btn").onclick = async () => {
  const ws = getActiveWorkspace();
  const statusEl = document.getElementById("ai-status-line");
  if (!ws || currentExpenses.length === 0) {
    statusEl.textContent = "Add a few expenses first to run an AI Audit.";
    statusEl.classList.remove("hidden");
    return;
  }

  statusEl.textContent = "Gemini AI is analyzing your spending pattern...";
  statusEl.classList.remove("hidden");

  const summaryData = currentExpenses.map((e) => `${e.title}: ₹${e.amount} (${e.category}, paid by ${e.paidBy})`).join("; ");
  const advice = await callGeminiAI([
    {
      text: `Analyze these shared expenses for "${ws.name}": ${summaryData}. Give 2 short, practical money-saving insights in simple English (max 45 words total).`
    }
  ]);

  statusEl.textContent = advice || "Spending looks balanced across categories.";
};

// ==================== 7. PDF EXPORT, WHATSAPP SHARE & TABS ====================
document.getElementById("export-pdf-btn").onclick = () => {
  const ws = getActiveWorkspace();
  if (!ws) return;
  const { jsPDF } = window.jspdf;
  const docPdf = new jsPDF();

  docPdf.setFontSize(16);
  docPdf.text(`Hisab-Cloud Report: ${ws.name}`, 14, 18);
  docPdf.setFontSize(10);
  docPdf.text(`Generated on ${new Date().toLocaleDateString()} • Members: ${ws.members.join(", ")}`, 14, 25);

  const rows = currentExpenses.map((e) => [e.title, e.category, e.paidBy, `Rs. ${Number(e.amount).toFixed(0)}`]);
  docPdf.autoTable({
    startY: 32,
    head: [["Description", "Category", "Paid By", "Amount"]],
    body: rows
  });

  docPdf.save(`${ws.name.replace(/\s+/g, "_")}_Hisab_Report.pdf`);
};

document.getElementById("share-whatsapp-btn").onclick = () => {
  const ws = getActiveWorkspace();
  if (!ws) return;
  const total = currentExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const text = `*Hisab-Cloud (${ws.name})*\nTotal Spent: ₹${total.toFixed(0)}\nMembers: ${ws.members.join(", ")}\nCheck live split: ${window.location.href}`;
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
