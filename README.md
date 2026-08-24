# Julia's Training Tracker

Mobile-first strength + pre-hab tracker. Static site (GitHub Pages) backed by Firebase Firestore. Queue-based supersets, double-progression suggestions, daily pre-hab checkboxes, compliance + trend tracking.

## One-time setup

### 1. Firebase project

1. Create a project at https://console.firebase.google.com.
2. **Build → Authentication → Sign-in method**: enable **Google**.
3. **Build → Firestore Database**: create in native mode (any region).
4. **Project settings → General → Your apps**: register a Web app, copy the `firebaseConfig` object.
5. Paste it into `js/app.js`, replacing the `REPLACE_ME` values.
6. **Firestore → Rules** — paste this and publish:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```

7. **Authentication → Settings → Authorized domains**: add your GitHub Pages domain (e.g. `<username>.github.io`).

### 2. GitHub Pages

1. Push this folder to a GitHub repo.
2. **Settings → Pages**: deploy from `main`, root `/`.
3. Visit `https://<username>.github.io/<repo>/` — tap "Sign in with Google".
4. On her phone: open the URL in Safari/Chrome → **Add to Home Screen**.

### 3. Edit the program

`data/program.json` defines phases, supersets, and pre-hab items. Edit + `git push` to deploy a new program.

Pre-hab items can also be edited in the app itself (Edit on a card, `+ Add` at the top, long-press to reorder). Those changes live in Firestore at `users/{uid}/meta/prehabConfig` and are layered on top of `program.json` — so a program push still updates anything the user hasn't overridden. Deletion is soft (`until` date) and additions carry a `since` date, so the streak and compliance history never shift retroactively.

## Local development

```
cd julias-training-tracker
python -m http.server 8080
# open http://localhost:8080 (NOT file://, Firebase auth requires http)
```

To run the overload algorithm tests:

```
node --test js/overload.test.js
```

## How progressive overload works

For each exercise in the next superset, the app reads the last few sessions and suggests reps/load. **Double progression**:

- **No history** → bottom of rep range, starting load (or starting variant).
- **Last session below rep-range floor** → repeat exactly (don't push when failing reps).
- **Hit top of range on every set, two sessions in a row at the same load** → bump load by `loadStep` (default 2.5 lb), or advance to the next harder variant for bodyweight exercises. Reps reset to the bottom of the range.
- **Hit top once** → suggest top reps again at the same load (one more time before bumping; guards against fluke sessions).
- **Otherwise** → +1 rep per set, same load, capped at the top of the range.

Edit `js/overload.js` to change behavior — it's pure functions with tests in `js/overload.test.js`.

## Mobility sub-programs

The Mobility tab hosts three programs, each in its own Firestore collection with its own
session counter in `meta/state`:

| Sub-tab | Source | Rotation |
| --- | --- | --- |
| Pike | `program.json` → `mobility` | 3 phases, 8 sessions each, then cycles back to Phase 1 |
| Shoulder | `program.json` → `shoulder` | none — fixed routine, 1–2×/week |
| Front Split | `program.json` → `frontSplit` | 2 phases, 8 sessions each, then **holds** on the last phase (`holdLastPhase: true`) |

`holdLastPhase` exists because the MFTK Front Split PDF only contains Phases 1 and 2 —
Phase 3 is the "specialist" program that lives in the Toolkit itself. Without it the app
would silently drop back to Phase 1 after 16 sessions. Add a third phase to
`frontSplit.phases` when you have it.

## Metacycling

Phases are defined in `program.json` with a `weeks` count. The app advances automatically based on `programStartISO` (set in Firestore the first time you sign in). When Phase 1's weeks elapse, the Strength tab starts pulling supersets from Phase 2. After the last phase, the program stays on it indefinitely — edit `programStartISO` in Firestore to restart, or push a new program with extra phases.

## Data layout (Firestore)

```
users/{uid}/meta/state                 { queueIndex, programStartISO }
users/{uid}/meta/prehabConfig          { items: { [id]: {name,sets,reps,load,rest,tempo,group,since,until,custom} }, order: [id] }
users/{uid}/sessions/{auto}            { supersetId, dateISO, exercises: [{ id, name, sets: [{reps, load}] }] }
users/{uid}/prehab/{YYYY-MM-DD}        { items: { [exerciseId]: [bool per set] } }
users/{uid}/mobility/{YYYY-MM-DD}      { phaseId, entries: { [exerciseKey]: { sets } } }   // Pike (auto-advancing)
users/{uid}/shoulder/{YYYY-MM-DD}      { entries: { [exerciseKey]: { sets } } }            // Shoulder Flexion (per-session)
users/{uid}/frontsplit/{YYYY-MM-DD}    { phaseId, entries: { [exerciseKey]: { sets } } }   // Front Split (auto-advancing, holds on last phase)
```
