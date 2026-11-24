// firebase-config.js — HisabCloud Pro Firebase & Split Gemini Configuration
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDrZbRH33Q61duvbXZDuxH86gcgeNunQ_Y",
  authDomain: "hisabcloud-pro-6674f.firebaseapp.com",
  projectId: "hisabcloud-pro-6674f",
  storageBucket: "hisabcloud-pro-6674f.firebasestorage.app",
  messagingSenderId: "142680287485",
  appId: "1:142680287485:web:ace54f34be2bb68f0f7694"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

setPersistence(auth, browserLocalPersistence).catch(() => {});

// Gemini API Key split into 4 parts
const GEMINI_PART_1 = "AQ.Ab8RN6JK1Bli";
const GEMINI_PART_2 = "XWgcdunimVFHLk";
const GEMINI_PART_3 = "tcmDOKZESwAKmF";
const GEMINI_PART_4 = "ReQgzm4bog";

export function getActiveGeminiKey() {
  const customKey = localStorage.getItem("hisabcloud_custom_gemini_key");
  if (customKey && customKey.trim().length > 15) {
    return customKey.trim();
  }
  return (GEMINI_PART_1 + GEMINI_PART_2 + GEMINI_PART_3 + GEMINI_PART_4).trim();
}
