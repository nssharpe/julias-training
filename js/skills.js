import { getSkills, saveSkill, deleteSkill, isoDay } from "./db.js";
import { EVENTS, hitRate, sortSkills, applySave } from "./skills-stats.js";
import { toast } from "./app.js";

// Skills tab: a list of skills/combos, each tagged with one event. Tap +/− to
// count hits and misses, then Save adds them to today's totals (and offers a
// few seconds to undo). Each card shows hit % for the last 7 days, 30 days and
// all time. The event filter is a multi-select remembered on this device.

const FILTER_KEY = "skillsEvents";
let rootEl = null;
let menuOpen = false;

function loadFilter() {
  try {
    const v = JSON.parse(localStorage.getItem(FILTER_KEY));
    if (Array.isArray(v)) return new Set(v.filter(e => EVENTS.includes(e)));
  } catch { /* storage unavailable or bad JSON */ }
  return new Set(EVENTS);
}
function saveFilter(sel) {
  try { localStorage.setItem(FILTER_KEY, JSON.stringify([...sel])); } catch { /* ignore */ }
}

export async function renderSkills(root) {
  rootEl = root;
  const skills = await getSkills();
  const selected = loadFilter();
  const today = isoDay();

  root.innerHTML = "";

  // ── Filter + add ──
  const bar = document.createElement("div");
  bar.className = "skills-bar";
  const label = selected.size === EVENTS.length ? "All events"
    : selected.size === 0 ? "No events"
    : EVENTS.filter(e => selected.has(e)).join(", ");
  bar.innerHTML = `
    <button class="ghost ev-dd" aria-expanded="${menuOpen}"><span>${label}</span><span class="mu">${menuOpen ? "▴" : "▾"}</span></button>
    <button class="ghost" data-act="add">+ Add skill</button>
  `;
  root.appendChild(bar);
  bar.querySelector(".ev-dd").onclick = () => { menuOpen = !menuOpen; renderSkills(root); };
  bar.querySelector('[data-act="add"]').onclick = () =>
    openEditor(null, selected.size === 1 ? [...selected][0] : "");

  if (menuOpen) {
    const menu = document.createElement("div");
    menu.className = "ev-menu";
    menu.innerHTML = `
      <div class="ev-all">
        <button class="ghost" data-act="all">Select all</button>
        <button class="ghost" data-act="none">Select none</button>
      </div>
      ${EVENTS.map(e => `
        <button class="ev-row${selected.has(e) ? " on" : ""}" data-ev="${e}">
          <span class="box">${selected.has(e) ? "✓" : ""}</span>${e}
        </button>`).join("")}
    `;
    root.appendChild(menu);
    const set = sel => { saveFilter(sel); renderSkills(root); };
    menu.querySelector('[data-act="all"]').onclick = () => set(new Set(EVENTS));
    menu.querySelector('[data-act="none"]').onclick = () => set(new Set());
    menu.querySelectorAll("[data-ev]").forEach(btn => {
      btn.onclick = () => {
        const next = new Set(selected);
        next.has(btn.dataset.ev) ? next.delete(btn.dataset.ev) : next.add(btn.dataset.ev);
        set(next);
      };
    });
  }

  // ── List ──
  const shown = sortSkills(skills.filter(s => selected.has(s.event)));
  if (selected.size === 0) {
    root.insertAdjacentHTML("beforeend", `<div class="streak">Pick one or more events above to see their skills.</div>`);
  } else if (shown.length === 0) {
    root.insertAdjacentHTML("beforeend", `<div class="streak">${skills.length ? "No skills for these events yet." : "Add your first skill or combo."}</div>`);
  }
  for (const s of shown) root.appendChild(buildCard(s, today));
}

function buildCard(skill, today) {
  const card = document.createElement("article");
  card.className = "card skill";
  const stat = (r, label) => `
    <div><b>${r.pct == null ? "—" : r.pct + "%"}</b><span>${label}${r.total ? ` · ${r.hits}/${r.total}` : ""}</span></div>`;
  card.innerHTML = `
    <div class="skill-head">
      <h2>${escapeHtml(skill.name)}</h2>
      <span class="ev-tag">${escapeHtml(skill.event)}</span>
      <button class="edit-btn ghost">Edit</button>
    </div>
    <div class="skill-stats">
      ${stat(hitRate(skill, today, 7), "Week")}
      ${stat(hitRate(skill, today, 30), "Month")}
      ${stat(hitRate(skill, today), "All")}
    </div>
    <div class="skill-log">
      ${counter("hits", "Hits")}
      ${counter("misses", "Misses")}
      <button class="primary save">Save</button>
    </div>
  `;
  const counts = { hits: 0, misses: 0 };
  card.querySelectorAll("[data-d]").forEach(btn => {
    btn.onclick = () => {
      const k = btn.dataset.k;
      counts[k] = Math.max(0, counts[k] + Number(btn.dataset.d));
      card.querySelector(`[data-v="${k}"]`).textContent = counts[k];
    };
  });
  card.querySelector(".edit-btn").onclick = () => openEditor(skill);
  card.querySelector(".save").onclick = async () => {
    const { hits, misses } = counts;
    if (hits + misses === 0) { toast("Tap + to count hits or misses first."); return; }
    await saveSkill(applySave(skill, today, hits, misses));
    showUndo(`Saved ${hits}/${hits + misses}`, async () => {
      // Re-read so an undo after other saves only removes this one.
      const cur = (await getSkills()).find(s => s.id === skill.id);
      if (cur) await saveSkill(applySave(cur, today, hits, misses, -1));
      renderSkills(rootEl);
    });
    renderSkills(rootEl);
  };
  return card;
}

function counter(key, label) {
  return `
    <div class="skill-ctr">
      <span class="mu">${label}</span>
      <div>
        <button data-k="${key}" data-d="-1" aria-label="${label} minus one">−</button>
        <span class="n" data-v="${key}">0</span>
        <button data-k="${key}" data-d="1" aria-label="${label} plus one">+</button>
      </div>
    </div>`;
}

// A toast with an Undo button that stays for a few seconds.
function showUndo(msg, onUndo) {
  document.querySelector(".undo-bar")?.remove();
  const el = document.createElement("div");
  el.className = "undo-bar";
  el.innerHTML = `<span>${escapeHtml(msg)}</span><button class="ghost">Undo</button>`;
  document.body.appendChild(el);
  const t = setTimeout(() => el.remove(), 5000);
  el.querySelector("button").onclick = async () => {
    clearTimeout(t);
    el.remove();
    await onUndo();
    toast("Undone.");
  };
}

// ─── Add / edit sheet ───────────────────────────────────────────────────────

function openEditor(skill, defaultEvent = "") {
  const isNew = !skill;
  const overlay = document.createElement("div");
  overlay.className = "sheet-overlay";
  overlay.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true">
      <h2>${isNew ? "New skill" : "Edit skill"}</h2>
      <label class="field">
        <span>Skill or combo</span>
        <input type="text" data-key="name" placeholder="Round-off back handspring layout" value="${escapeHtml(skill?.name ?? "")}">
      </label>
      <label class="field">
        <span>Event</span>
        <select data-key="event">
          <option value="">Choose event</option>
          ${EVENTS.map(e => `<option value="${e}">${e}</option>`).join("")}
        </select>
      </label>
      <div class="sheet-actions">
        ${isNew ? "" : `<button class="danger" data-act="delete">Delete</button>`}
        <button class="ghost" data-act="cancel">Cancel</button>
        <button class="primary" data-act="save">${isNew ? "Add" : "Save"}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-key="event"]').value = skill?.event || defaultEvent;
  overlay.querySelector('[data-key="name"]').focus();

  const close = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) close(); };
  overlay.querySelector('[data-act="cancel"]').onclick = close;

  overlay.querySelector('[data-act="save"]').onclick = async () => {
    const name = overlay.querySelector('[data-key="name"]').value.trim();
    const event = overlay.querySelector('[data-key="event"]').value;
    if (!name) { toast("Give it a name first."); return; }
    if (!event) { toast("Pick an event."); return; }
    const next = isNew
      ? { id: newSkillId(), name, event, createdAt: isoDay(), days: {} }
      : { ...skill, name, event };
    await saveSkill(next);
    // Make sure a new skill isn't hidden by the current filter.
    const sel = loadFilter();
    if (!sel.has(event)) { sel.add(event); saveFilter(sel); }
    close();
    toast(isNew ? "Skill added." : "Saved.");
    renderSkills(rootEl);
  };

  const delBtn = overlay.querySelector('[data-act="delete"]');
  if (delBtn) delBtn.onclick = async () => {
    if (!confirm(`Delete "${skill.name}" and all its history?`)) return;
    await deleteSkill(skill.id);
    close();
    toast("Deleted.");
    renderSkills(rootEl);
  };
}

function newSkillId() {
  return `skill-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
