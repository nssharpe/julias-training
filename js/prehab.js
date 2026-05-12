import { loadProgram, isAlternatingDay } from "./program.js";
import { getState, getPrehabDay, setPrehabDay, getPrehabRange, isoDay } from "./db.js";

export async function renderPrehab(root) {
  const program = await loadProgram();
  const state = await getState();
  const dayKey = isoDay();
  const dayDoc = await getPrehabDay(dayKey);
  const items = dayDoc.items || {};

  const showAlt = isAlternatingDay(state);
  const todays = [
    ...program.prehab.daily.map(x => ({ ...x, group: "daily" })),
    ...(showAlt ? program.prehab.alternating.map(x => ({ ...x, group: "alt" })) : []),
  ];

  const streak = await computeStreak(program);

  root.innerHTML = "";
  const head = document.createElement("div");
  head.className = "streak";
  head.innerHTML = `<strong>${streak}🔥</strong> day streak (daily items)${showAlt ? "" : " · alternating items off today"}`;
  root.appendChild(head);

  for (const it of todays) {
    const saved = items[it.id] || [];
    const checks = Array.from({ length: it.sets }, (_, i) => Boolean(saved[i]));
    const el = document.createElement("article");
    el.className = "prehab-item";
    el.innerHTML = `
      <h3>${escapeHtml(it.name)}</h3>
      <div class="meta">${it.sets} × ${escapeHtml(it.reps)} · ${escapeHtml(it.load)} · rest ${escapeHtml(it.rest)} · tempo ${escapeHtml(it.tempo)}</div>
      <div class="checks">
        ${checks.map((c, i) => `<button class="check ${c ? "on" : ""}" data-set="${i}">${c ? "✓" : i + 1}</button>`).join("")}
      </div>
    `;
    root.appendChild(el);
    el.querySelectorAll(".check").forEach(btn => {
      btn.onclick = async () => {
        const i = Number(btn.dataset.set);
        const cur = items[it.id] || Array(it.sets).fill(false);
        cur[i] = !cur[i];
        items[it.id] = cur;
        await setPrehabDay(dayKey, { items });
        btn.classList.toggle("on", cur[i]);
        btn.textContent = cur[i] ? "✓" : (i + 1);
      };
    });
  }
}

async function computeStreak(program) {
  const dailyIds = program.prehab.daily.map(d => d.id);
  if (dailyIds.length === 0) return 0;
  const range = await getPrehabRange(60);
  // Walk from today backwards; count consecutive days where every daily item is fully checked.
  let streak = 0;
  for (let i = range.length - 1; i >= 0; i--) {
    const items = range[i].data.items || {};
    const allDone = dailyIds.every(id => {
      const sets = items[id];
      const def = program.prehab.daily.find(x => x.id === id);
      return sets && sets.length >= def.sets && sets.slice(0, def.sets).every(Boolean);
    });
    if (allDone) streak++;
    else if (i < range.length - 1) break; // allow today to be in-progress without breaking streak
  }
  return streak;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
