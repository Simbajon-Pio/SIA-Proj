// Import Firebase SDK (use CDN)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// Your Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyDzwr1lnX0rVn8jPLpyDlHzkHVq8YCFiUI",
  authDomain: "controlingchaos.firebaseapp.com",
  projectId: "controlingchaos",
  storageBucket: "controlingchaos.firebasestorage.app",
  messagingSenderId: "293401764231",
  appId: "1:293401764231:web:142321f5858f20f0707322"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);