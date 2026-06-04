import { loadProgram, isAlternatingDay } from "./program.js";
import { getState, getPrehabDay, setPrehabDay, getPrehabRange, isoDay } from "./db.js";

export async function renderPrehab(root) {
  // Paint the shell + checkboxes as soon as we have today's doc + program. The
  // streak (which needs ~60 docs) is computed async and patched in once ready.
  const [program, state, dayDoc] = await Promise.all([
    loadProgram(),
    getState(),
    getPrehabDay(isoDay()),
  ]);
  const dayKey = isoDay();
  const items = dayDoc.items || {};

  const showAlt = isAlternatingDay(state);
  const todays = [
    ...program.prehab.daily.map(x => ({ ...x, group: "daily" })),
    ...(showAlt ? program.prehab.alternating.map(x => ({ ...x, group: "alt" })) : []),
  ];
  // Group by body region (shoulders first, then ankles); stable sort preserves
  // original order within each region. Untagged items fall in between.
  const regionRank = { shoulder: 0, ankle: 2 };
  todays.sort((a, b) => (regionRank[a.region] ?? 1) - (regionRank[b.region] ?? 1));

  root.innerHTML = "";
  const head = document.createElement("div");
  head.className = "streak";
  head.innerHTML = `<strong>…🔥</strong> day streak (daily items)${showAlt ? "" : " · alternating items off today"}`;
  root.appendChild(head);
  // Compute the streak in the background so checkboxes are interactive immediately.
  computeStreak(program).then(streak => {
    head.innerHTML = `<strong>${streak}🔥</strong> day streak (daily items)${showAlt ? "" : " · alternating items off today"}`;
  });

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
  const daily = program.prehab.daily;
  if (daily.length === 0) return 0;
  const range = await getPrehabRange(60);
  // Walk from today backwards; count consecutive days where every daily item that
  // was *active on that date* is fully checked. An item's `since` date (if present)
  // means it isn't required before then — so adding new daily exercises never
  // breaks the historical streak.
  let streak = 0;
  for (let i = range.length - 1; i >= 0; i--) {
    const dayDate = range[i].date; // "YYYY-MM-DD"
    const items = range[i].data.items || {};
    const required = daily.filter(def => !def.since || def.since <= dayDate);
    const allDone = required.every(def => {
      const sets = items[def.id];
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
