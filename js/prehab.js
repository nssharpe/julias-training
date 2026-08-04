import { loadProgram, isAlternatingDay } from "./program.js";
import {
  getState, getPrehabDay, setPrehabDay, getPrehabRange, isoDay,
  getPrehabConfig, savePrehabConfig,
} from "./db.js";
import {
  buildPrehabItems, visiblePrehabItems, dailyItemsOn, newPrehabId,
} from "./prehab-config.js";
import { toast } from "./app.js";

// Whether to show the every-other-day items on a day they're not scheduled, so
// they can be edited/reordered on any day. Resets on reload.
let showAltOverride = false;
let rootEl = null;

export async function renderPrehab(root) {
  rootEl = root;
  // Paint the shell + checkboxes as soon as we have today's doc + program. The
  // streak (which needs ~60 docs) is computed async and patched in once ready.
  const [program, state, dayDoc, config] = await Promise.all([
    loadProgram(),
    getState(),
    getPrehabDay(isoDay()),
    getPrehabConfig(),
  ]);
  const dayKey = isoDay();
  const items = dayDoc.items || {};

  const isAltDay = isAlternatingDay(state);
  const showAlt = isAltDay || showAltOverride;
  const all = buildPrehabItems(program, config);
  const todays = visiblePrehabItems(all, dayKey, showAlt);

  root.innerHTML = "";
  const head = document.createElement("div");
  head.className = "streak";
  const altNote = isAltDay ? ""
    : showAltOverride ? " · showing alternating items (not scheduled today)"
    : " · alternating items off today";
  head.innerHTML = `<strong>…🔥</strong> day streak (daily items)${altNote}`;
  root.appendChild(head);
  // Compute the streak in the background so checkboxes are interactive immediately.
  computeStreak(all).then(streak => {
    head.innerHTML = `<strong>${streak}🔥</strong> day streak (daily items)${altNote}`;
  });

  const bar = document.createElement("div");
  bar.className = "prehab-bar";
  bar.innerHTML = `
    <button class="ghost" data-act="add">+ Add</button>
    ${isAltDay ? "" : `<button class="ghost${showAltOverride ? " on" : ""}" data-act="alt">${showAltOverride ? "Hide" : "Show"} alternating day</button>`}
  `;
  root.appendChild(bar);
  bar.querySelector('[data-act="add"]').onclick = () => openEditor(null, program, config);
  const altBtn = bar.querySelector('[data-act="alt"]');
  if (altBtn) altBtn.onclick = () => { showAltOverride = !showAltOverride; renderPrehab(root); };

  const list = document.createElement("div");
  list.className = "prehab-list";
  root.appendChild(list);

  for (const it of todays) {
    const saved = items[it.id] || [];
    const checks = Array.from({ length: it.sets }, (_, i) => Boolean(saved[i]));
    const el = document.createElement("article");
    el.className = "prehab-item";
    el.dataset.id = it.id;
    el.innerHTML = `
      <div class="prehab-head">
        <h3>${escapeHtml(it.name)}</h3>
        <button class="edit-btn ghost">Edit</button>
      </div>
      <div class="meta">${it.sets} × ${escapeHtml(it.reps)} · ${escapeHtml(it.load)} · rest ${escapeHtml(it.rest)} · tempo ${escapeHtml(it.tempo)}${it.group === "alt" ? " · alternating" : ""}</div>
      <div class="checks">
        ${checks.map((c, i) => `<button class="check ${c ? "on" : ""}" data-set="${i}">${c ? "✓" : i + 1}</button>`).join("")}
      </div>
    `;
    list.appendChild(el);
    el.querySelector(".edit-btn").onclick = () => openEditor(it, program, config);
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

  enableDragReorder(list, program, config, all);
}

async function computeStreak(all) {
  const range = await getPrehabRange(60);
  // Walk from today backwards; count consecutive days where every daily item that
  // was *active on that date* is fully checked. `since` / `until` mean adding or
  // deleting an exercise never rewrites the historical streak. A saved set array
  // has the length that was required on the day it was created, so checking that
  // it's all-true keeps history correct even after the set count is edited.
  let streak = 0;
  for (let i = range.length - 1; i >= 0; i--) {
    const dayDate = range[i].date; // "YYYY-MM-DD"
    const items = range[i].data.items || {};
    const required = dailyItemsOn(all, dayDate);
    if (required.length === 0) break;
    const allDone = required.every(def => {
      const sets = items[def.id];
      return Boolean(sets) && sets.length > 0 && sets.every(Boolean);
    });
    if (allDone) streak++;
    else if (i < range.length - 1) break; // allow today to be in-progress without breaking streak
  }
  return streak;
}

// ─── Add / edit sheet ───────────────────────────────────────────────────────

const FIELDS = [
  { key: "name", label: "Exercise title", type: "text", placeholder: "e.g. Side-lying shoulder ER" },
  { key: "sets", label: "Sets", type: "number", placeholder: "3" },
  { key: "reps", label: "Reps", type: "text", placeholder: "e.g. 10/side" },
  { key: "load", label: "Notes (ie weight)", type: "text", placeholder: "e.g. 5 lb" },
  { key: "rest", label: "Rest", type: "text", placeholder: "e.g. 45s" },
  { key: "tempo", label: "Tempo", type: "text", placeholder: "e.g. 2-1-2" },
];

function openEditor(item, program, config) {
  const isNew = !item;
  const cur = item || { sets: 3, reps: "", load: "bw", rest: "—", tempo: "—", group: "daily" };

  const overlay = document.createElement("div");
  overlay.className = "sheet-overlay";
  overlay.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true">
      <h2>${isNew ? "New exercise" : "Edit exercise"}</h2>
      ${FIELDS.map(f => `
        <label class="field">
          <span>${f.label}</span>
          <input type="${f.type}" data-key="${f.key}" placeholder="${f.placeholder}"
                 ${f.type === "number" ? 'min="1" max="12" inputmode="numeric"' : ""}
                 value="${escapeHtml(cur[f.key] ?? "")}">
        </label>
      `).join("")}
      <label class="field">
        <span>Frequency</span>
        <select data-key="group">
          <option value="daily">Daily</option>
          <option value="alt">Every other day (alternating)</option>
        </select>
      </label>
      <div class="sheet-actions">
        ${isNew ? "" : `<button class="danger" data-act="delete">Delete</button>`}
        <button class="ghost" data-act="cancel">Cancel</button>
        <button class="primary" data-act="save">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-key="group"]').value = cur.group === "alt" ? "alt" : "daily";
  overlay.querySelector('[data-key="name"]').focus();

  const close = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) close(); };
  overlay.querySelector('[data-act="cancel"]').onclick = close;

  overlay.querySelector('[data-act="save"]').onclick = async () => {
    const patch = {};
    for (const f of FIELDS) {
      const v = overlay.querySelector(`[data-key="${f.key}"]`).value.trim();
      patch[f.key] = f.type === "number" ? Math.max(1, Math.min(12, Number(v) || 1)) : v;
    }
    patch.group = overlay.querySelector('[data-key="group"]').value;
    if (!patch.name) { toast("Give it a title first."); return; }

    const next = cloneConfig(config);
    if (isNew) {
      const id = newPrehabId();
      // New items only count from today forward, so the streak/compliance history
      // isn't retroactively penalised.
      next.items[id] = { ...patch, custom: true, since: isoDay() };
      next.order = orderedIds(next, program);
    } else if (patch.group !== (item.group || "daily")) {
      // Changing daily ↔ alternating would rewrite what was *required* on every
      // past day, so it's a soft delete + recreate instead: the history stays
      // attached to the old id, and the new one only counts from today.
      const today = isoDay();
      next.items[item.id] = { ...(next.items[item.id] || {}), until: today };
      const id = newPrehabId();
      next.items[id] = { ...patch, custom: true, since: today };
      const ids = orderedIds(next, program).filter(x => x !== id);
      ids.splice(ids.indexOf(item.id) + 1, 0, id); // keep it where the old one sat
      next.order = ids;
    } else {
      next.items[item.id] = { ...(next.items[item.id] || {}), ...patch };
    }
    await savePrehabConfig(next);
    close();
    toast(isNew ? "Exercise added." : "Saved.");
    renderPrehab(rootEl);
  };

  const delBtn = overlay.querySelector('[data-act="delete"]');
  if (delBtn) delBtn.onclick = async () => {
    if (!confirm(`Delete "${item.name}"? It keeps counting towards your streak up to today.`)) return;
    const next = cloneConfig(config);
    // Soft delete: `until` is exclusive, so from today on it's neither shown nor
    // required, but every past day still counts it.
    next.items[item.id] = { ...(next.items[item.id] || {}), until: isoDay() };
    await savePrehabConfig(next);
    close();
    toast("Deleted.");
    renderPrehab(rootEl);
  };
}

function cloneConfig(config) {
  return { items: JSON.parse(JSON.stringify(config.items || {})), order: [...(config.order || [])] };
}

function orderedIds(config, program) {
  return buildPrehabItems(program, config).map(it => it.id);
}

// ─── Long-press drag to reorder ─────────────────────────────────────────────

function enableDragReorder(list, program, config, all) {
  let timer = null, dragEl = null, grabOffset = 0, startY = 0;

  const blockScroll = e => e.preventDefault();

  function begin(el, y) {
    dragEl = el;
    grabOffset = y - el.getBoundingClientRect().top;
    el.classList.add("dragging");
    document.body.classList.add("dragging-active");
    document.addEventListener("touchmove", blockScroll, { passive: false });
    navigator.vibrate?.(20);
    move(y);
  }

  function move(y) {
    // Re-measure with the transform cleared each frame so the card stays under
    // the finger even right after a DOM reorder.
    dragEl.style.transform = "none";
    const natural = dragEl.getBoundingClientRect().top;
    dragEl.style.transform = `translateY(${y - natural - grabOffset}px)`;

    const others = [...list.children].filter(c => c !== dragEl);
    const after = others.find(c => {
      const r = c.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    if (after) {
      if (after !== dragEl.nextElementSibling) list.insertBefore(dragEl, after);
    } else if (dragEl !== list.lastElementChild) {
      list.appendChild(dragEl);
    }
  }

  async function end() {
    const el = dragEl;
    dragEl = null;
    document.removeEventListener("touchmove", blockScroll);
    document.body.classList.remove("dragging-active");
    el.classList.remove("dragging");
    el.style.transform = "";

    // Persist: visible ids in their new order, with hidden items (alternating on
    // an off day, deleted ones) kept in their existing relative positions.
    const visible = [...list.children].map(c => c.dataset.id);
    const visibleSet = new Set(visible);
    let vi = 0;
    const next = cloneConfig(config);
    next.order = all.map(it => (visibleSet.has(it.id) ? visible[vi++] : it.id));
    await savePrehabConfig(next);
    renderPrehab(rootEl);
  }

  list.addEventListener("pointerdown", e => {
    if (e.target.closest(".check, .edit-btn")) return;
    const el = e.target.closest(".prehab-item");
    if (!el || dragEl) return;
    startY = e.clientY;
    try { list.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    timer = setTimeout(() => { timer = null; begin(el, startY); }, 400);
  });

  list.addEventListener("pointermove", e => {
    if (timer && Math.abs(e.clientY - startY) > 8) { clearTimeout(timer); timer = null; } // that's a scroll
    if (dragEl) { e.preventDefault(); move(e.clientY); }
  });

  const stop = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (dragEl) end();
  };
  list.addEventListener("pointerup", stop);
  list.addEventListener("pointercancel", stop);
  list.addEventListener("contextmenu", e => { if (dragEl) e.preventDefault(); });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
