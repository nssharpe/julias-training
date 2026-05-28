import {
  initializeFirestore, persistentLocalCache, doc, getDoc, setDoc, updateDoc, addDoc, collection,
  query, where, orderBy, limit, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

let db, uid;

export function initDb(app, userUid) {
  // Persistent IndexedDB cache — subsequent loads serve from local cache instantly,
  // then sync to Firestore in the background. Huge win for repeat tab switches and
  // cold opens on mobile.
  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache() });
  } catch {
    // initializeFirestore can only be called once per app; if a hot-reload re-runs
    // this, fall back to the existing instance via dynamic import.
    db = initializeFirestore(app, {});
  }
  uid = userUid;
}

// ─── In-memory cache (per page session) ─────────────────────────────────────
// Survives tab switches within a single page load. Firestore's persistent cache
// handles cross-load speed; this avoids even re-deserializing on each tab switch.
const memo = { state: null, sessions: null, prehabRange: null, mobilityRange: null };
export function invalidateCache(keys = ["state", "sessions", "prehabRange", "mobilityRange"]) {
  for (const k of keys) memo[k] = null;
}

const userDoc = (...p) => doc(db, "users", uid, ...p);
const userCol = (...p) => collection(db, "users", uid, ...p);

export async function getState() {
  if (memo.state) return memo.state;
  const snap = await getDoc(userDoc("meta", "state"));
  if (!snap.exists()) {
    const init = {
      queueIndex: 0,
      programStartISO: new Date().toISOString(),
    };
    await setDoc(userDoc("meta", "state"), init);
    memo.state = init;
    return init;
  }
  memo.state = snap.data();
  return memo.state;
}

export async function setState(patch) {
  await setDoc(userDoc("meta", "state"), patch, { merge: true });
  memo.state = { ...(memo.state || {}), ...patch };
}

export async function saveSession(session) {
  const ref = await addDoc(userCol("sessions"), { ...session, createdAt: serverTimestamp() });
  // Prepend optimistically so the next read is fresh without a round-trip.
  if (memo.sessions) memo.sessions = [{ id: ref.id, ...session }, ...memo.sessions];
  return ref;
}

async function loadRecentSessions(n = 100) {
  if (memo.sessions && memo.sessions.length >= n) return memo.sessions;
  const q = query(userCol("sessions"), orderBy("createdAt", "desc"), limit(n));
  const snap = await getDocs(q);
  const out = [];
  snap.forEach(d => out.push({ id: d.id, ...d.data() }));
  memo.sessions = out;
  return out;
}

export async function getHistoryForExercise(exerciseId, n = 5) {
  // Reuse the shared sessions cache instead of issuing a separate query per exercise.
  const sessions = await loadRecentSessions(100);
  const out = [];
  for (const data of sessions) {
    const ex = (data.exercises || []).find(e => e.id === exerciseId);
    if (ex) out.push({ dateISO: data.dateISO, sets: ex.sets });
  }
  return out.slice(0, n).reverse(); // oldest → newest
}

export async function getRecentSessions(n = 100) {
  return loadRecentSessions(n);
}

export async function getPrehabDay(dateKey) {
  const snap = await getDoc(userDoc("prehab", dateKey));
  return snap.exists() ? snap.data() : { items: {} };
}

export async function setPrehabDay(dateKey, data) {
  await setDoc(userDoc("prehab", dateKey), data, { merge: true });
  // Update the cached range in place so streak/compliance reflect the toggle
  // without a refetch.
  if (memo.prehabRange) {
    const hit = memo.prehabRange.find(r => r.date === dateKey);
    if (hit) hit.data = { ...hit.data, ...data, items: { ...(hit.data.items || {}), ...(data.items || {}) } };
  }
}

export async function getPrehabRange(daysBack = 60) {
  // Use the cached range if we already fetched at least this many days this session.
  if (memo.prehabRange && memo.prehabRange.length >= daysBack) {
    return memo.prehabRange.slice(-daysBack);
  }
  // Parallel reads. Sequential awaits in a loop made this take ~RTT * N (3–6s on 4G);
  // Promise.all collapses it to a single round-trip's worth of latency.
  const today = new Date();
  const days = Array.from({ length: daysBack }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    return isoDay(d);
  });
  const snaps = await Promise.all(days.map(key => getDoc(userDoc("prehab", key))));
  const out = days.map((key, i) => ({
    date: key,
    data: snaps[i].exists() ? snaps[i].data() : { items: {} },
  })).reverse();
  memo.prehabRange = out;
  return out;
}

// ─── Mobility (MFTK) ────────────────────────────────────────────────────────
// One doc per day: users/{uid}/mobility/{YYYY-MM-DD} = { phaseId, entries }.
// entries: { [exerciseKey]: { sets: [{ checked } | { reps, weight, measurement }] } }
export async function getMobilityDay(dateKey) {
  const snap = await getDoc(userDoc("mobility", dateKey));
  return snap.exists() ? snap.data() : { entries: {} };
}

export async function setMobilityDay(dateKey, data) {
  await setDoc(userDoc("mobility", dateKey), data, { merge: true });
  if (memo.mobilityRange) {
    const hit = memo.mobilityRange.find(r => r.date === dateKey);
    if (hit) hit.data = { ...hit.data, ...data, entries: { ...(hit.data.entries || {}), ...(data.entries || {}) } };
    else memo.mobilityRange.push({ date: dateKey, data });
  }
}

export async function getMobilityRange(daysBack = 120) {
  if (memo.mobilityRange && memo.mobilityRange.length >= daysBack) {
    return memo.mobilityRange.slice(-daysBack);
  }
  const today = new Date();
  const days = Array.from({ length: daysBack }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    return isoDay(d);
  });
  const snaps = await Promise.all(days.map(key => getDoc(userDoc("mobility", key))));
  const out = days.map((key, i) => ({
    date: key,
    data: snaps[i].exists() ? snaps[i].data() : { entries: {} },
  })).reverse();
  memo.mobilityRange = out;
  return out;
}

export function isoDay(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}
