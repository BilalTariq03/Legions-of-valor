import { firebaseConfig } from './config/firebase-config.js';

// Firebase SDK imports from Google's CDN. This keeps the project beginner-friendly:
// no npm, no build tools, no server code.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import { getDatabase, ref, set, get, onValue, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js';

let app = null;
let auth = null;
let db = null;
let uid = null;
let configured = false;

export function isFirebaseConfigured() {
  return !!firebaseConfig?.apiKey && !String(firebaseConfig.apiKey).includes('PASTE_');
}

export async function initFirebase() {
  configured = isFirebaseConfigured();
  if (!configured) {
    // Offline fallback for opening the project before Firebase is configured.
    uid = localStorage.getItem('lovLocalUid') || `local_${crypto.randomUUID()}`;
    localStorage.setItem('lovLocalUid', uid);
    return { configured: false, uid };
  }
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getDatabase(app);
  await signInAnonymously(auth);
  uid = await new Promise(resolve => {
    const unsub = onAuthStateChanged(auth, user => {
      if (user) {
        unsub();
        resolve(user.uid);
      }
    });
  });
  return { configured: true, uid };
}

export function getUid() { return uid; }
export function getDb() { return db; }
export function firebaseReady() { return configured && db; }

export const fb = { ref, set, get, onValue, runTransaction, serverTimestamp };
