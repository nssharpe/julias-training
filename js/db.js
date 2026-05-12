import {
  getFirestore, doc, getDoc, setDoc, updateDoc, addDoc, collection,
  query, where, orderBy, limit, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

let db, uid;

export function initDb(app, userUid) {
  db = getFirestore(app);
  uid = userUid;
}

const userDoc = (...p) => doc(db, "users", uid, ...p);
const userCol = (...p) => collection(db, "users", uid, ...p);

export async function getState() {
  const snap = await getDoc(userDoc("meta", "state"));
  if (!snap.exists()) {
    const init = {
      queueIndex: 0,
      programStartISO: new Date().toISOString(),
    };
    await setDoc(userDoc("meta", "state"), init);
    return init;
  }
  return snap.data();
}

export async function setState(patch) {
  await setDoc(userDoc("meta", "state"), patch, { merge: true });
}

export async function saveSession(session) {
  return addDoc(userCol("sessions"), { ...session, createdAt: serverTimestamp() });
}

export async function getHistoryForExercise(exerciseId, n = 5) {
  // Pull recent sessions; filter exercises client-side (small data).
  const q = query(userCol("sessions"), orderBy("createdAt", "desc"), limit(50));
  const snap = await getDocs(q);
  const out = [];
  snap.forEach(d => {
    const data = d.data();
    const ex = (data.exercises || []).find(e => e.id === exerciseId);
    if (ex) out.push({ dateISO: data.dateISO, sets: ex.sets });
  });
  return out.slice(0, n).reverse(); // oldest → newest
}

export async function getRecentSessions(n = 50) {
  const q = query(userCol("sessions"), orderBy("createdAt", "desc"), limit(n));
  const snap = await getDocs(q);
  const out = [];
  snap.forEach(d => out.push({ id: d.id, ...d.data() }));
  return out;
}

export async function getPrehabDay(dateKey) {
  const snap = await getDoc(userDoc("prehab", dateKey));
  return snap.exists() ? snap.data() : { items: {} };
}

export async function setPrehabDay(dateKey, data) {
  await setDoc(userDoc("prehab", dateKey), data, { merge: true });
}

export async function getPrehabRange(daysBack = 28) {
  // Read N day-docs by id (no listing). Faster than a query for small N.
  const out = [];
  const today = new Date();
  for (let i = 0; i < daysBack; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = isoDay(d);
    const snap = await getDoc(userDoc("prehab", key));
    out.push({ date: key, data: snap.exists() ? snap.data() : { items: {} } });
  }
  return out.reverse();
}

export function isoDay(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}
