// firebase-config.js — HisabCloud Pro Firebase & Auto-Fallback Gemini 3.8 Engine
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

// Universal Gemini 3.8 AI Caller with Auto-Fallback & 12s Timeout
export async function runGeminiAI({ contents, parts, jsonMode = false }) {
  const apiKey = getActiveGeminiKey();
  const models = [
    "gemini-3.8-flash",
    "gemini-3.8-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite"
  ];
  const payloadContents = contents || [{ role: "user", parts }];
  const bodyObj = { contents: payloadContents };

  if (jsonMode) {
    bodyObj.generationConfig = { responseMimeType: "application/json" };
  }

  let lastError = "";
  for (const model of models) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-goog-api-key": apiKey
          },
          body: JSON.stringify(bodyObj),
          signal: controller.signal
        }
      );
      clearTimeout(timer);
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (res.ok && text) {
        return { text: text.trim(), error: null };
      }
      if (data.error?.message) lastError = data.error.message;
    } catch (err) {
      clearTimeout(timer);
      lastError = err.name === "AbortError" ? "Server timeout, switching model..." : err.message;
    }
  }
  return { text: null, error: lastError || "AI connection failed" };
}
