import { loadProgram, locate } from "./program.js";
import { getState, getRecentSessions, getPrehabRange, getMobilityRange } from "./db.js";

export async function renderTracking(root) {
  // Paint section shells immediately so the tab switch feels instant; each
  // section fills in independently once its data lands.
  const [program, state] = await Promise.all([loadProgram(), getState()]);
  const loc = locate(program, state);

  root.innerHTML = "";
  const phaseSec = section("Phase progress", phaseSection(loc, program));
  const weekSec = section("Compliance — supersets/week", placeholder());
  const prehabSec = section("Pre-hab daily compliance (28d)", placeholder());
  const mobSec = section("Mobility sessions/week", placeholder());
  const mobTrendSec = section("Mobility progress (depth / angle)", placeholder());
  const trendSec = section("Strength progress", placeholder());
  const recentSec = section("Recent sessions", placeholder());
  root.append(phaseSec, weekSec, prehabSec, mobSec, mobTrendSec, trendSec, recentSec);

  // Sessions (one query) feeds three sections.
  getRecentSessions(100).then(sessions => {
    replaceBody(weekSec, weeklyBars(sessions));
    replaceBody(trendSec, exerciseTrends(sessions, program));
    replaceBody(recentSec, recentList(sessions));
  });
  // Prehab range (parallel fetch) feeds one.
  getPrehabRange(56).then(range => {
    replaceBody(prehabSec, prehabCompliance(range, program));
  });
  // Mobility range feeds the two mobility sections.
  getMobilityRange(56).then(range => {
    replaceBody(mobSec, mobilityWeeklyBars(range));
    replaceBody(mobTrendSec, mobilityTrends(range, program));
  });
}

function placeholder() {
  const d = document.createElement("div");
  d.className = "kv";
  d.innerHTML = `<span>Loading…</span><span class="v">·</span>`;
  return d;
}
function replaceBody(sectionEl, body) {
  const card = sectionEl.querySelector(".card");
  card.innerHTML = "";
  card.appendChild(body);
}

function section(title, body) {
  const wrap = document.createElement("section");
  wrap.className = "tracking-section";
  const h = document.createElement("h2"); h.textContent = title; wrap.appendChild(h);
  const card = document.createElement("div"); card.className = "card";
  card.appendChild(body);
  wrap.appendChild(card);
  return wrap;
}

function phaseSection(loc, program) {
  const wrap = document.createElement("div");
  const idx = program.phases.indexOf(loc.phase);
  const next = program.phases[idx + 1];
  wrap.innerHTML = `
    <div class="kv"><span>Phase</span><span class="v">${esc(loc.phase.name)}</span></div>
    <div class="kv"><span>Week</span><span class="v">${loc.weekInPhase + 1} of ${loc.phase.weeks}</span></div>
    <div class="kv"><span>Next phase</span><span class="v">${next ? esc(next.name) : "—"}</span></div>
  `;
  return wrap;
}

function weeklyBars(sessions) {
  const weeks = 8;
  const buckets = Array(weeks).fill(0);
  const now = new Date();
  for (const s of sessions) {
    if (!s.dateISO) continue;
    const d = new Date(s.dateISO);
    const w = Math.floor((now - d) / (7 * 86400000));
    if (w >= 0 && w < weeks) buckets[weeks - 1 - w]++;
  }
  const max = Math.max(1, ...buckets);
  const wrap = document.createElement("div");
  wrap.className = "bars";
  buckets.forEach(v => {
    const b = document.createElement("div");
    b.className = "bar";
    b.style.height = `${(v / max) * 100}%`;
    b.title = `${v} supersets`;
    wrap.appendChild(b);
  });
  const lbl = document.createElement("div");
  lbl.className = "kv";
  lbl.innerHTML = `<span>Last 8 weeks · total</span><span class="v">${buckets.reduce((a, b) => a + b, 0)}</span>`;
  const outer = document.createElement("div");
  outer.appendChild(wrap);
  outer.appendChild(lbl);
  return outer;
}

function mobilityDayHasData(data) {
  const entries = data?.entries || {};
  for (const k of Object.keys(entries)) {
    for (const s of (entries[k].sets || [])) {
      if (s?.checked) return true;
      if (s?.reps != null && s.reps !== "") return true;
      if (s?.weight != null && s.weight !== "") return true;
      if (s?.measurement != null && s.measurement !== "") return true;
    }
  }
  return false;
}

function mobilityWeeklyBars(range) {
  const weeks = 8;
  const buckets = Array(weeks).fill(0);
  const now = new Date();
  for (const day of range) {
    if (!mobilityDayHasData(day.data)) continue;
    const d = new Date(day.date);
    const w = Math.floor((now - d) / (7 * 86400000));
    if (w >= 0 && w < weeks) buckets[weeks - 1 - w]++;
  }
  const max = Math.max(1, ...buckets);
  const wrap = document.createElement("div");
  wrap.className = "bars";
  buckets.forEach(v => {
    const b = document.createElement("div");
    b.className = "bar";
    b.style.height = `${(v / max) * 100}%`;
    b.title = `${v} sessions`;
    wrap.appendChild(b);
  });
  const lbl = document.createElement("div");
  lbl.className = "kv";
  lbl.innerHTML = `<span>Last 8 weeks · total</span><span class="v">${buckets.reduce((a, b) => a + b, 0)}</span>`;
  const outer = document.createElement("div");
  outer.appendChild(wrap);
  outer.appendChild(lbl);
  return outer;
}

function mobilityTrends(range, program) {
  // Map exercise key -> def (with measurement) across all mobility phases.
  const exDefs = new Map();
  for (const phase of (program.mobility?.phases || [])) {
    for (const ex of phase.exercises) {
      if (ex.measurement) exDefs.set(ex.key, ex);
    }
  }
  // Gather, per exercise, the best value per session day.
  const series = new Map();   // numeric measurements -> [values]
  const latestText = new Map(); // text measurements -> latest string
  for (const day of range) {
    const entries = day.data?.entries || {};
    for (const [key, entry] of Object.entries(entries)) {
      const def = exDefs.get(key);
      if (!def) continue;
      const vals = (entry.sets || []).map(s => s.measurement).filter(v => v != null && v !== "");
      if (!vals.length) continue;
      if (def.measurement.type === "number") {
        const best = Math.max(...vals.map(Number).filter(n => !Number.isNaN(n)));
        if (!Number.isNaN(best)) {
          if (!series.has(key)) series.set(key, []);
          series.get(key).push(best);
        }
      } else {
        latestText.set(key, String(vals[vals.length - 1]));
      }
    }
  }
  const wrap = document.createElement("div");
  if (series.size === 0 && latestText.size === 0) {
    wrap.innerHTML = `<div class="kv"><span>—</span><span class="v">No mobility data yet</span></div>`;
    return wrap;
  }
  for (const [key, values] of series) {
    const def = exDefs.get(key);
    const row = document.createElement("div");
    row.style.margin = "8px 0";
    const last = values[values.length - 1], first = values[0];
    const delta = last - first;
    row.innerHTML = `<div class="kv"><span>${esc(def.name)}</span>
      <span class="v">${last}${esc(def.measurement.label.includes("°") ? "°" : "")} (${delta >= 0 ? "+" : ""}${delta})</span></div>`;
    row.appendChild(sparkline(values));
    wrap.appendChild(row);
  }
  for (const [key, text] of latestText) {
    const def = exDefs.get(key);
    const row = document.createElement("div");
    row.className = "kv";
    row.innerHTML = `<span>${esc(def.name)} · latest ${esc(def.measurement.label.toLowerCase())}</span><span class="v">${esc(text)}</span>`;
    wrap.appendChild(row);
  }
  return wrap;
}

function prehabCompliance(range, program) {
  const last28 = range.slice(-28);
  let scheduledSets = 0, doneSets = 0;
  for (const day of last28) {
    for (const def of program.prehab.daily) {
      // Only count an item as "scheduled" on days on/after it was added, so newly
      // added exercises don't retroactively lower historical compliance.
      if (def.since && def.since > day.date) continue;
      scheduledSets += def.sets;
      const sets = day.data.items?.[def.id] || [];
      doneSets += sets.slice(0, def.sets).filter(Boolean).length;
    }
  }
  const pct = scheduledSets ? Math.round((doneSets / scheduledSets) * 100) : 0;
  const wrap = document.createElement("div");
  wrap.innerHTML = `<div class="kv"><span>Daily-item completion</span><span class="v">${pct}% (${doneSets}/${scheduledSets} sets)</span></div>`;
  return wrap;
}

function exerciseTrends(sessions, program) {
  // Aggregate per exercise: e1RM for "reps" + load, total hold time for "sec".
  const exDefs = new Map();
  for (const phase of program.phases) {
    for (const ss of phase.supersets) {
      for (const ex of ss.exercises) {
        if (!exDefs.has(ex.id)) exDefs.set(ex.id, ex);
      }
    }
  }
  const series = new Map(); // id -> [{date, value, label}]
  const ordered = [...sessions].reverse(); // old → new
  for (const s of ordered) {
    for (const ex of (s.exercises || [])) {
      const def = exDefs.get(ex.id);
      if (!def) continue;
      let value;
      if (def.unit === "sec") {
        value = ex.sets.reduce((a, b) => a + (Number(b.reps) || 0), 0);
      } else {
        // best e1RM across sets
        value = Math.max(...ex.sets.map(set => {
          const reps = Number(set.reps) || 0;
          const load = Number(set.load) || 0;
          return load * (1 + reps / 30);
        }));
      }
      if (!series.has(ex.id)) series.set(ex.id, []);
      series.get(ex.id).push({ date: s.dateISO, value, name: ex.name });
    }
  }
  const wrap = document.createElement("div");
  if (series.size === 0) {
    wrap.innerHTML = `<div class="kv"><span>—</span><span class="v">No sessions yet</span></div>`;
    return wrap;
  }
  for (const [id, points] of series) {
    const def = exDefs.get(id);
    const row = document.createElement("div");
    row.style.margin = "8px 0";
    const last = points[points.length - 1].value;
    const first = points[0].value;
    const delta = last - first;
    const sign = delta >= 0 ? "+" : "";
    row.innerHTML = `
      <div class="kv"><span>${esc(def?.name || id)}</span>
        <span class="v">${def?.unit === "sec" ? `${Math.round(last)}s total` : `e1RM ${last.toFixed(1)}`} (${sign}${delta.toFixed(1)})</span></div>
    `;
    row.appendChild(sparkline(points.map(p => p.value)));
    wrap.appendChild(row);
  }
  return wrap;
}

function sparkline(values) {
  const w = 300, h = 40, pad = 2;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = (max - min) || 1;
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  const points = values.map((v, i) => {
    const x = pad + i * step;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "spark");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.innerHTML = `<polyline fill="none" stroke="#7cc4ff" stroke-width="2" points="${points}" />`;
  return svg;
}

function recentList(sessions) {
  const wrap = document.createElement("div");
  if (!sessions.length) {
    wrap.innerHTML = `<div class="kv"><span>—</span><span class="v">No sessions yet</span></div>`;
    return wrap;
  }
  for (const s of sessions.slice(0, 10)) {
    const names = (s.exercises || []).map(e => e.name).join(" + ");
    const row = document.createElement("div");
    row.className = "kv";
    row.innerHTML = `<span>${esc(s.dateISO || "—")}</span><span class="v">${esc(names)}</span>`;
    wrap.appendChild(row);
  }
  return wrap;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
