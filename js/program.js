let programCache = null;

export async function loadProgram() {
  if (programCache) return programCache;
  const res = await fetch("data/program.json", { cache: "no-cache" });
  programCache = await res.json();
  return programCache;
}

// Given the program and state, compute the active phase, week-of-phase, and
// the current/prev/next supersets.
export function locate(program, state) {
  const start = new Date(state.programStartISO);
  const now = new Date();
  const daysElapsed = Math.floor((now - start) / 86400000);
  let weekCursor = 0;
  let phase = program.phases[0];
  let weekInPhase = 0;

  for (const p of program.phases) {
    const phaseDays = p.weeks * 7;
    if (daysElapsed < (weekCursor * 7) + phaseDays) {
      phase = p;
      weekInPhase = Math.floor(daysElapsed / 7) - weekCursor;
      break;
    }
    weekCursor += p.weeks;
    phase = p; // fall-through: stay on last phase if program is over
    weekInPhase = p.weeks - 1;
  }

  const supersets = phase.supersets;
  const idx = ((state.queueIndex % supersets.length) + supersets.length) % supersets.length;
  const prevIdx = (idx - 1 + supersets.length) % supersets.length;
  const nextIdx = (idx + 1) % supersets.length;

  return {
    phase,
    weekInPhase: Math.max(0, Math.min(phase.weeks - 1, weekInPhase)),
    current: supersets[idx],
    prev: supersets[prevIdx],
    next: supersets[nextIdx],
    queueIndex: idx,
  };
}

// Is today an "alternating" pre-hab day? Use ISO day-of-year parity, anchored
// to the program start so it's stable.
export function isAlternatingDay(state) {
  const start = new Date(state.programStartISO);
  const now = new Date();
  const days = Math.floor((now - start) / 86400000);
  return days % 2 === 0;
}
