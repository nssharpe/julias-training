// Double-progression suggestion algorithm.
// Pure functions — no DOM, no Firestore. Easy to unit-test.

export function suggest(history, def) {
  const setsN = def.sets;
  const [low, high] = def.repRange;

  if (!history || history.length === 0) {
    return defaultSets(setsN, low, def);
  }

  const last = history[history.length - 1];
  const prev = history.length > 1 ? history[history.length - 2] : null;

  const lastLoad = loadOf(last, def);
  const lastTopAll = hitTopAll(last, high);
  const lastBelowAny = belowAny(last, low);
  const prevTopAll = prev && hitTopAll(prev, high) && loadOf(prev, def) === lastLoad;

  if (lastBelowAny) {
    return repeat(last, setsN);
  }

  if (lastTopAll && prevTopAll) {
    return bumpLoad(def, lastLoad, setsN, low);
  }

  if (lastTopAll) {
    return holdAtTop(setsN, high, lastLoad);
  }

  return progressReps(last, setsN, high);
}

function defaultSets(n, low, def) {
  const startLoad = def.progression === "variant"
    ? (def.startVariant || (def.variants && def.variants[0]) || "")
    : (def.startLoad ?? 0);
  return Array.from({ length: n }, () => ({ reps: low, load: startLoad }));
}

function loadOf(session, def) {
  // For load-progression: assume sets at same load; take the mode (first set's load).
  // For variant-progression: load is the variant string used last.
  return session.sets[0]?.load ?? (def.progression === "variant" ? "" : 0);
}

function hitTopAll(session, high) {
  return session.sets.every(s => Number(s.reps) >= high);
}

function belowAny(session, low) {
  return session.sets.some(s => Number(s.reps) < low);
}

function repeat(session, n) {
  const fill = session.sets[session.sets.length - 1];
  return Array.from({ length: n }, (_, i) => {
    const s = session.sets[i] || fill;
    return { reps: Number(s.reps), load: s.load };
  });
}

function holdAtTop(n, high, load) {
  return Array.from({ length: n }, () => ({ reps: high, load }));
}

function progressReps(session, n, high) {
  const fill = session.sets[session.sets.length - 1];
  return Array.from({ length: n }, (_, i) => {
    const s = session.sets[i] || fill;
    return { reps: Math.min(high, Number(s.reps) + 1), load: s.load };
  });
}

function bumpLoad(def, currentLoad, n, low) {
  if (def.progression === "variant") {
    const list = def.variants || [];
    const idx = list.indexOf(String(currentLoad));
    const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : currentLoad;
    return Array.from({ length: n }, () => ({ reps: low, load: next }));
  }
  if (def.progression === "load") {
    const step = def.loadStep ?? 2.5;
    const next = Number(currentLoad) + step;
    return Array.from({ length: n }, () => ({ reps: low, load: next }));
  }
  // "hold" or unknown — no bump
  return Array.from({ length: n }, () => ({ reps: low, load: currentLoad }));
}
