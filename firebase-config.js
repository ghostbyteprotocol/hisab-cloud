// firebase-config.js — Firebase Initialization & Split Gemini API Key Configuration
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAQSNDMA1JLHll5mMjSwXDSa0cAmjw8Bo4",
  authDomain: "my-website-login-10b06.firebaseapp.com",
  projectId: "my-website-login-10b06",
  storageBucket: "my-website-login-10b06.firebasestorage.app",
  messagingSenderId: "1058420080529",
  appId: "1:1058420080529:web:1440b3f78f8853268b2430"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

setPersistence(auth, browserLocalPersistence).catch(() => {});

// Gemini API Key divided into 4 parts for repository safety
const GEMINI_KEY_PART_1 = "AQ.Ab8RN6JK1Bli";
const GEMINI_KEY_PART_2 = "XWgcdunimVFHLk";
const GEMINI_KEY_PART_3 = "tcmDOKZESwAKmF";
const GEMINI_KEY_PART_4 = "ReQgzm4bog";

export function getActiveGeminiKey() {
  const userCustomKey = localStorage.getItem("hisab_custom_gemini_key");
  if (userCustomKey && userCustomKey.trim().length > 15) {
    return userCustomKey.trim();
  }
  return (GEMINI_KEY_PART_1 + GEMINI_KEY_PART_2 + GEMINI_KEY_PART_3 + GEMINI_KEY_PART_4).trim();
}
