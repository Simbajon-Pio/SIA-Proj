// Import Firebase SDK (use CDN)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// Your Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBWuxlwx-00k2fw41Mw8WIKaYT60G1BOHY",
  authDomain: "chaos-control-fa3dc.firebaseapp.com",
  projectId: "chaos-control-fa3dc",
  storageBucket: "chaos-control-fa3dc.firebasestorage.app",
  messagingSenderId: "366263163903",
  appId: "1:366263163903:web:cca6d240cc8de7256865ca",
  measurementId: "G-BSKK8FN56N"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);