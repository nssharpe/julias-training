import { loadProgram } from "./program.js";
import {
  getPrehabDay, setPrehabDay, getPrehabRange, isoDay,
  getPrehabConfig, savePrehabConfig,
} from "./db.js";
import {
  buildPrehabItems, isActiveOn, isDueOn, dueDateOn, doneDatesById, everyOf,
  weekCompletion, daysBetween, newPrehabId,
} from "./prehab-config.js";
import { toast } from "./app.js";

// Whether to also show items that aren't due today, so they can be edited,
// reordered or done early. Resets on reload.
let showAllOverride = false;
let rootEl = null;

export async function renderPrehab(root) {
  rootEl = root;
  const dayKey = isoDay();
  // Due-ness depends on when each item was last done, so the history range is
  // needed before the list can be drawn (Firestore's local cache keeps it quick).
  const [program, dayDoc, config, range] = await Promise.all([
    loadProgram(),
    getPrehabDay(dayKey),
    getPrehabConfig(),
    getPrehabRange(60),
  ]);
  const items = dayDoc.items || {};

  const all = buildPrehabItems(program, config);
  const done = doneDatesById(range.filter(r => r.date !== dayKey));
  const active = all.filter(it => isActiveOn(it, dayKey));
  const due = active.filter(it => isDueOn(it, dayKey, done[it.id]));
  const dueIds = new Set(due.map(it => it.id));
  const notDue = active.length - due.length;
  const shown = showAllOverride ? active : due;

  root.innerHTML = "";
  const head = document.createElement("div");
  head.className = "streak";
  root.appendChild(head);
  // Today's doc is authoritative for today; the range copy may be stale.
  const paintHead = () => {
    const withToday = [...range.filter(r => r.date !== dayKey), { date: dayKey, data: { items } }];
    const pct = weekCompletion(all, withToday, dayKey);
    head.innerHTML = pct === null
      ? "Nothing assigned in the last 7 days"
      : `<strong>${pct}%</strong> of assigned sets done · last 7 days`;
  };
  paintHead();

  const bar = document.createElement("div");
  bar.className = "prehab-bar";
  bar.innerHTML = `
    <button class="ghost" data-act="add">+ Add</button>
    ${notDue ? `<button class="ghost${showAllOverride ? " on" : ""}" data-act="all">${showAllOverride ? "Hide" : "Show"} not due (${notDue})</button>` : ""}
  `;
  root.appendChild(bar);
  bar.querySelector('[data-act="add"]').onclick = () => openEditor(null, program, config);
  const allBtn = bar.querySelector('[data-act="all"]');
  if (allBtn) allBtn.onclick = () => { showAllOverride = !showAllOverride; renderPrehab(root); };

  const list = document.createElement("div");
  list.className = "prehab-list";
  root.appendChild(list);

  if (shown.length === 0) {
    list.innerHTML = `<div class="streak">Nothing due today 🎉</div>`;
  }

  for (const it of shown) {
    const saved = items[it.id] || [];
    const checks = Array.from({ length: it.sets }, (_, i) => Boolean(saved[i]));
    const isDue = dueIds.has(it.id);
    const dueDate = dueDateOn(it, dayKey, done[it.id]);
    let status = "";
    if (!isDue) status = ` · next due ${fmtDay(dueDate)}`;
    else if (done[it.id] && dueDate < dayKey) status = ` · carried over from ${fmtDay(dueDate)}`;
    const el = document.createElement("article");
    el.className = "prehab-item" + (isDue ? "" : " not-due");
    el.dataset.id = it.id;
    el.innerHTML = `
      <div class="prehab-head">
        <h3>${escapeHtml(it.name)}</h3>
        <button class="edit-btn ghost">Edit</button>
      </div>
      <div class="meta">${it.sets} × ${escapeHtml(it.reps)} · ${escapeHtml(it.load)} · rest ${escapeHtml(it.rest)} · tempo ${escapeHtml(it.tempo)} · ${freqLabel(everyOf(it))}${status}</div>
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
        paintHead();
      };
    });
  }

  enableDragReorder(list, program, config, all);
}

function freqLabel(n) {
  return n === 1 ? "daily" : n === 2 ? "every other day" : n === 7 ? "weekly" : `every ${n} days`;
}

function fmtDay(dateKey) {
  const diff = daysBetween(isoDay(), dateKey);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  const d = new Date(`${dateKey}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "short", ...(Math.abs(diff) > 6 ? { month: "short", day: "numeric" } : {}) });
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
        <span>Repeat every … days (1 = daily, 2 = every other day, 7 = weekly)</span>
        <input type="number" data-key="every" min="1" max="60" inputmode="numeric" value="${everyOf(cur)}">
      </label>
      <div class="sheet-actions">
        ${isNew ? "" : `<button class="danger" data-act="delete">Delete</button>`}
        <button class="ghost" data-act="cancel">Cancel</button>
        <button class="primary" data-act="save">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
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
    patch.every = Math.max(1, Math.min(60, Math.round(Number(overlay.querySelector('[data-key="every"]').value)) || 1));
    if (!patch.name) { toast("Give it a title first."); return; }

    const next = cloneConfig(config);
    if (isNew) {
      const id = newPrehabId();
      // New items only count from today forward, so the completion history
      // isn't retroactively penalised.
      next.items[id] = { ...patch, custom: true, since: isoDay() };
      next.order = orderedIds(next, program);
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
    if (!confirm(`Delete "${item.name}"? Your past history for it is kept.`)) return;
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

    // Persist: visible ids in their new order, with hidden items (not due
    // today, deleted ones) kept in their existing relative positions.
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
