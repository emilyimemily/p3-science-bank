/* ===== P3 Science Question Bank · quiz logic ===== */
(function () {
  "use strict";

  const QB = window.QUESTIONS || [];
  const META = window.QB_META || {};
  const BY_ID = new Map(QB.map(q => [q.id, q]));
  const LS_WRONG = "p3qb_wrong_v1";
  const LS_STATS = "p3qb_stats_v1";

  const MAJORS = [
    ["Diversity", ["Living & Non-living", "Animals", "Plants", "Fungi & Bacteria", "Materials"]],
    ["Life Cycles", ["Animal Life Cycles", "Plant Life Cycles"]],
    ["Systems", ["Digestive System", "Human Body Systems"]],
    ["Interactions", ["Magnets"]],
    ["Energy", ["Light & Shadows", "Heat"]],
    ["Scientific Inquiry", ["Experiments & Variables"]]
  ];

  /* ---------------- storage ---------------- */
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  let WB = load(LS_WRONG, { items: {} });
  if (!WB.items) WB.items = {};
  let STATS = load(LS_STATS, { done: 0, score: 0, marks: 0 });

  const wbCount = () => Object.keys(WB.items).length;

  /* ---------------- helpers ---------------- */
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function show(view) {
    $$(".view").forEach(v => v.classList.add("hidden"));
    const el = $("#view-" + view);
    if (el) el.classList.remove("hidden");
    $$(".navbtn").forEach(b => b.classList.toggle("active", b.dataset.go === view));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* Wrap the target figure's image in a positioned container and drop an
     <input> over every empty answer box defined in q.slots. Coordinates are
     percentages of the image's own bounding box. */
  function injectDiagramSlots(html, q) {
    const slots = q.slots || [];
    if (!slots.length) return html;
    const figs = [];
    const re = /<figure>([\s\S]*?)<\/figure>/g;
    let m;
    while ((m = re.exec(html))) figs.push(m[0]);
    if (!figs.length) return html;
    const idx = (typeof q.slotFig === "number") ? q.slotFig : figs.length - 1;
    const fig = figs[idx] || figs[figs.length - 1];
    const imgM = fig.match(/<img\s[^>]*>/);
    if (!imgM) return html;
    const isDrag = !!(q.dragPool && q.dragPool.length);
    const inputs = slots.map((s, i) => {
      const st = `left:${s.x}%;top:${s.y}%;width:${s.w}%;height:${s.h}%`;
      if (isDrag) {
        const multi = s.dropMultiple ? " multi" : "";
        return `<div class="dropzone${multi}" data-slot="${i}" style="${st}" aria-label="${esc(s.label || ("box " + (i + 1)))}"></div>`;
      }
      const ph = esc(s.label || "");
      return `<input class="slotbox" data-slot="${i}" data-mode="${esc(s.mode || "text")}" style="${st}" placeholder="${ph}" aria-label="${ph || ("box " + (i + 1))}">`;
    }).join("");
    const wrapped = `<span class="diagwrap${isDrag ? " dragmode" : ""}">${imgM[0]}${inputs}</span>`;
    const newFig = fig.replace(imgM[0], wrapped);
    return html.replace(fig, newFig);
  }

  /* Wrap the target figure's image in a positioned container and overlay an
     SVG line layer + clickable anchor buttons for "draw lines to match".
     Anchor coordinates are percentages of the image's own bounding box. */
  function injectDiagramLines(html, q) {
    const ld = q.lineData;
    if (!ld || !ld.left || !ld.left.length) return html;
    const figs = [];
    const re = /<figure>([\s\S]*?)<\/figure>/g;
    let m;
    while ((m = re.exec(html))) figs.push(m[0]);
    if (!figs.length) return html;
    const idx = (typeof ld.fig === "number") ? ld.fig : figs.length - 1;
    const fig = figs[idx] || figs[figs.length - 1];
    const imgM = fig.match(/<img\s[^>]*>/);
    if (!imgM) return html;
    const anchor = (side, arr) => arr.map((a, i) =>
      `<button type="button" class="lnanchor ${side}" data-side="${side}" data-i="${i}" data-x="${a.x}" data-y="${a.y}" style="left:${a.x}%;top:${a.y}%" aria-label="${esc(side)} ${i + 1}"></button>`
    ).join("");
    const svg = `<svg class="linesvg" viewBox="0 0 100 100" preserveAspectRatio="none"><g class="lnlines"></g></svg>`;
    const wrapped = `<span class="diagwrap">${imgM[0]}${svg}${anchor("L", ld.left)}${anchor("R", ld.right)}</span>`;
    const newFig = fig.replace(imgM[0], wrapped);
    return html.replace(fig, newFig);
  }

  /* ---------------- line-matching interaction ---------------- */
  // Rules the student sees:
  //  * each LEFT object may carry only ONE line (one object -> one answer);
  //  * a right-hand group may be shared by several left objects
  //    (e.g. "reptile" <- crocodile + turtle), so its lines are never
  //    dropped just because it was tapped;
  //  * tapping a dot that already has a line CANCELS that line and re-arms
  //    the dot, so a wrong line can always be undone and redrawn.
  let lineState = { edges: [] };  // edges: [ [leftId, rightId], ... ]
  const SVGNS = "http://www.w3.org/2000/svg";

  function lineAnchorEl(side, i) {
    return document.querySelector(`#qstem .lnanchor[data-side="${side}"][data-i="${i}"]`);
  }
  function clearPendingA() {
    const p = document.querySelector("#qstem .lnanchor.pending");
    if (p) p.classList.remove("pending");
  }
  function clearPending() {
    clearPendingA();
    lineState.pending = null;
  }
  function setPending(side, i) {
    clearPendingA();
    lineState.pending = { side, i };
    const el = lineAnchorEl(side, i);
    if (el) el.classList.add("pending");
  }
  function hasEdge(id) {
    return lineState.edges.some(e => e[0] === id || e[1] === id);
  }
  function markLinked() {
    document.querySelectorAll("#qstem .lnanchor").forEach(a => {
      a.classList.toggle("linked", hasEdge(a.dataset.side + a.dataset.i));
    });
  }
  function drawLines() {
    const svg = document.querySelector("#qstem .linesvg");
    if (!svg) return;
    const g = svg.querySelector(".lnlines");
    g.innerHTML = "";
    lineState.edges.forEach((e, idx) => {
      const a = document.querySelector(`#qstem .lnanchor[data-side="${e[0][0]}"][data-i="${parseInt(e[0].slice(1))}"]`);
      const b = document.querySelector(`#qstem .lnanchor[data-side="${e[1][0]}"][data-i="${parseInt(e[1].slice(1))}"]`);
      if (!a || !b) return;
      const ln = document.createElementNS(SVGNS, "line");
      ln.setAttribute("x1", a.dataset.x); ln.setAttribute("y1", a.dataset.y);
      ln.setAttribute("x2", b.dataset.x); ln.setAttribute("y2", b.dataset.y);
      ln.setAttribute("class", "lnline");
      ln.dataset.li = parseInt(e[0].slice(1));
      ln.dataset.r = e[1];
      ln.dataset.ei = idx;
      g.appendChild(ln);
    });
    markLinked();
  }
  function onAnchorClick(el) {
    const side = el.dataset.side, i = parseInt(el.dataset.i);
    const id = side + i;
    const p = lineState.pending;

    // 1. tapping the armed dot again -> put it down
    if (p && p.side === side && p.i === i) { clearPending(); return; }

    // 2. an armed dot on the OTHER side -> complete the line now
    if (p && p.side !== side) {
      const leftId = p.side === "L" ? ("L" + p.i) : ("L" + i);
      const rightId = p.side === "L" ? ("R" + i) : ("R" + p.i);
      // one line per left object: its previous line is replaced, not duplicated
      lineState.edges = lineState.edges.filter(e => e[0] !== leftId);
      lineState.edges.push([leftId, rightId]);
      clearPending();
      drawLines();
      return;
    }

    // 3. this dot already carries a line -> cancel it and re-arm the dot
    //    (a left object may only hold one line, so its line is removed;
    //     a right group may serve several objects, so its lines stay)
    if (hasEdge(id)) {
      if (side === "L") lineState.edges = lineState.edges.filter(e => e[0] !== id);
      setPending(side, i);
      drawLines();
      return;
    }

    // 4. nothing armed yet, or re-aiming on the same side -> arm this dot
    setPending(side, i);
  }
  function bindLineInteractions() {
    const stem = $("#qstem");
    if (!stem) return;
    stem.querySelectorAll(".lnanchor").forEach(a => {
      a.addEventListener("click", () => onAnchorClick(a));
    });
    const svg = stem.querySelector(".linesvg");
    if (svg) {
      svg.addEventListener("click", (ev) => {
        const ln = ev.target.closest && ev.target.closest(".lnline");
        if (ln) {
          const ei = parseInt(ln.dataset.ei);
          lineState.edges = lineState.edges.filter((_, k) => k !== ei);
          drawLines();
        }
      });
    }
    const clr = $("#clearLines");
    if (clr) clr.addEventListener("click", () => {
      lineState.edges = [];
      clearPendingA();
      lineState.pending = null;
      drawLines();
    });
  }

  /* ---------------- drag-and-drop slot interaction ----------------
     A SLOT question that carries q.dragPool becomes a drag-to-sort exercise:
     option tiles shown in a tray are dragged (HTML5 DnD) or tap-tap placed
     into the boxes overlaid on the diagram. slotVals[i] holds the tiles
     currently sitting in box i (an array, since a box may hold several). */
  let slotVals = [];
  let dragCarry = null;            // { value, source:{type:'pool'|'box', i?} }
  let curQ = null;

  const isDragQ = q => !!(q && q.dragPool && q.dragPool.length);

  function removeFromBox(i, value) {
    if (slotVals[i]) slotVals[i] = slotVals[i].filter(v => v !== value);
  }
  function placeInBox(i, value, source) {
    if (!curQ) return;
    if (source && source.type === "box") removeFromBox(source.i, value);
    const slot = curQ.slots[i];
    if (slot && slot.dropMultiple) {
      if (!slotVals[i].includes(value)) slotVals[i].push(value);
    } else {
      slotVals[i] = [value];
    }
  }
  function renderDrag() {
    const pool = document.getElementById("dragpool");
    if (!pool || !curQ) return;
    const multi = curQ.dragMultiUse;
    const placed = multi ? new Set() : new Set();
    if (!multi) slotVals.forEach(a => a.forEach(v => placed.add(v)));
    pool.innerHTML = curQ.dragPool.map(v =>
      (placed.has(v) ? "" :
        `<button type="button" class="drtile${dragCarry && dragCarry.value === v ? " carrying" : ""}" draggable="true" data-pool="1" data-val="${esc(v)}">${esc(v)}</button>`
      )).join("");
    curQ.slots.forEach((s, i) => {
      const z = document.querySelector(`#qstem .dropzone[data-slot="${i}"]`);
      if (!z) return;
      z.innerHTML = (slotVals[i] || []).map(v =>
        `<span class="drtile inzone" draggable="true" data-box="${i}" data-val="${esc(v)}">${esc(v)}</span>`
      ).join("");
      z.classList.toggle("filled", (slotVals[i] || []).length > 0);
    });
  }
  function dragLocked() {
    const stem = document.getElementById("qstem");
    return !!(stem && stem.classList.contains("locked"));
  }
  function onDragClick(e) {
    if (dragLocked()) return;
    if (!isDragQ(curQ)) return;
    const tile = e.target.closest && e.target.closest(".drtile");
    const zone = e.target.closest && e.target.closest(".dropzone");
    if (tile) {
      const v = tile.dataset.val;
      if (tile.dataset.box !== undefined) {           // a placed tile -> send back to tray
        removeFromBox(parseInt(tile.dataset.box), v);
        if (dragCarry && dragCarry.source.type === "pool" && dragCarry.value === v) dragCarry = null;
        renderDrag();
        return;
      }
      if (dragCarry && dragCarry.source.type === "pool" && dragCarry.value === v) dragCarry = null;
      else dragCarry = { value: v, source: { type: "pool" } };
      renderDrag();
      return;
    }
    if (zone && dragCarry) {
      placeInBox(parseInt(zone.dataset.slot), dragCarry.value, dragCarry.source);
      dragCarry = null; renderDrag();
    }
  }
  function onDragStart(e) {
    if (dragLocked()) return;
    const t = e.target.closest && e.target.closest(".drtile");
    if (!t) return;
    dragCarry = { value: t.dataset.val, source: t.dataset.box !== undefined ? { type: "box", i: parseInt(t.dataset.box) } : { type: "pool" } };
    try { e.dataTransfer.setData("text/plain", t.dataset.val); e.dataTransfer.effectAllowed = "move"; } catch (_) {}
  }
  function onDragOver(e) {
    if (dragLocked()) return;
    const z = e.target.closest && e.target.closest(".dropzone");
    if (z) { e.preventDefault(); z.classList.add("over"); }
  }
  function onDragDrop(e) {
    if (dragLocked()) return;
    const z = e.target.closest && e.target.closest(".dropzone");
    if (!z) return;
    e.preventDefault(); z.classList.remove("over");
    if (dragCarry) { placeInBox(parseInt(z.dataset.slot), dragCarry.value, dragCarry.source); dragCarry = null; renderDrag(); }
  }
  function onDragLeave(e) {
    const z = e.target.closest && e.target.closest(".dropzone");
    if (z) z.classList.remove("over");
  }

  /* ---------------- multi-part OEQ (one answer space per sub-question) ---------------- */
  // Some open-ended questions come as (a)(b)(c) sub-questions, each needing its
  // own answer space: a drawing (canvas), a fill-in-the-blank (single input), or
  // a written answer (text box). We detect the sub-parts from the stem and pick
  // a widget per part. Single-part OEQ questions keep the original one-box layout.
  let oeqState = { parts: {}, canvases: {}, ticks: {} };

  /* ---------------- answer ON the diagram ----------------
     Several papers ask the pupil to write a letter / word / tick INSIDE a
     picture ("write S inside the circle"), or to draw arrows straight onto a
     diagram. A textarea under the question cannot say WHERE on the picture
     the answer goes, so the figure itself becomes the answer sheet: tap it
     to drop a small text box, or switch to draw / arrow mode and sketch on
     top of the image. Boxes and strokes are saved with the attempt so the
     review shows them in exactly the same positions. */
  let figState = { boxes: {}, strokes: [], mode: "label", activePart: "", wrap: null, nextId: 1, rec: false };
  let figDragBox = null, figStroke = null;
  const isParted = parts => !!(parts && (parts.length >= 2 ||
    parts.some(p => p.type === "tick" || p.type === "circle" || p.fig || (p.circles && p.circles.length))));

  /* ---------------- "circle the correct answer" ----------------
     The options are plain words printed in the question. Typing them into a
     textarea is pointless, and a keyword grader cannot tell WHICH option a
     pupil picked, so the words themselves become buttons: click one and it is
     circled. Selections are graded exactly against the official answer. */
  const normCircle = s => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  function circleGroups(parts) {
    const out = [];
    (parts || []).forEach(p => (p.circles || []).forEach(g => out.push({ g, part: p })));
    return out;
  }
  function hasCircles(parts) { return circleGroups(parts).length > 0; }

  function circleGroupHTML(g, card) {
    const opts = (g.options || []).map((o, i) =>
      (i ? '<span class="cslash">/</span>' : "") +
      `<button type="button" class="cword" data-group="${esc(g.id)}" data-value="${esc(o)}">${esc(o)}</button>`
    ).join("");
    if (card) {
      return `<span class="cwordrow" data-group="${esc(g.id)}">` +
        `<span class="crowlabel">${esc(g.label || "Circle the correct answer")}</span>` +
        `<span class="cwords">${opts}</span></span>`;
    }
    return `<span class="cgroup" data-group="${esc(g.id)}">( ${opts} )</span>`;
  }

  // Replace each declared option group in the stem, in document order. Repeating
  // anchors (e.g. "( 1 / 2 / 3 / 4 )" three times) are consumed one by one.
  function injectCircleWords(html, parts) {
    let out = html;
    circleGroups(parts).forEach(({ g }) => {
      if (!g.anchor) return;
      const i = out.indexOf(g.anchor);
      if (i < 0) return;
      out = out.slice(0, i) + circleGroupHTML(g, false) + out.slice(i + g.anchor.length);
    });
    return out;
  }

  function readCirclePicks() {
    const out = {};
    document.querySelectorAll("#qstem .cword.sel, #qanswer .cword.sel").forEach(b => {
      (out[b.dataset.group] = out[b.dataset.group] || []).push(b.dataset.value);
    });
    return out;
  }

  function renderCircleReadouts(parts, rec) {
    const picks = rec ? (rec.circles || {}) : readCirclePicks();
    $$("#qanswer .circlereadout").forEach(box => {
      const p = (parts || []).find(x => x.letter === box.dataset.part);
      const chips = ((p && p.circles) || []).map(g => {
        const vals = picks[g.id] || [];
        return vals.length
          ? `<span class="circchip">${esc(g.label ? g.label + ": " : "")}${esc(vals.join(" + "))}</span>`
          : "";
      }).filter(Boolean).join("");
      box.innerHTML = chips || '<span class="muted">Nothing circled yet — click a word above</span>';
    });
  }

  function bindCircleWords(parts, rec) {
    const groups = {};
    circleGroups(parts).forEach(({ g }) => { groups[g.id] = g; });
    const saved = (rec && rec.circles) || {};
    $$("#qstem .cword, #qanswer .cword").forEach(btn => {
      const id = btn.dataset.group, g = groups[id];
      if (!g) return;
      const want = Array.isArray(g.correct) ? g.correct : [g.correct];
      const isRight = want.some(w => normCircle(w) === normCircle(btn.dataset.value));
      if (rec) {
        const got = saved[id] || [];
        const picked = got.some(v => normCircle(v) === normCircle(btn.dataset.value));
        if (picked) btn.classList.add("sel");
        btn.disabled = true;
        if (isRight) btn.classList.add("graded-ok");
        else if (picked) btn.classList.add("graded-miss");
        return;
      }
      btn.addEventListener("click", () => {
        const all = $$('.cword[data-group="' + id + '"]');
        if (g.multi) {
          btn.classList.toggle("sel");
        } else {
          const was = btn.classList.contains("sel");
          all.forEach(x => x.classList.remove("sel"));
          if (!was) btn.classList.add("sel");
        }
        renderCircleReadouts(parts);
      });
    });
    renderCircleReadouts(parts, rec);
  }

  function injectFigureOverlay(html, q) {
    const fa = q.figAnswer;
    if (!fa) return html;
    const figs = []; const re = /<figure>([\s\S]*?)<\/figure>/g; let m;
    while ((m = re.exec(html))) figs.push(m[0]);
    if (!figs.length) return html;
    const idx = (typeof fa.fig === "number") ? fa.fig : figs.length - 1;
    const fig = figs[idx]; if (!fig) return html;
    const imgM = fig.match(/<img\s[^>]*>/); if (!imgM) return html;
    const svg = '<svg class="figsvg" viewBox="0 0 100 100" preserveAspectRatio="none"><defs><marker id="figarrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#c0392b"></path></marker></defs><g class="figink"></g></svg>';
    const layer = '<span class="figlayer"></span><span class="figtip">＋ Click the picture to place an answer box</span>';
    const wrapped = `<span class="diagwrap figans" data-fig="${idx}">${imgM[0]}${svg}${layer}</span>`;
    return html.replace(fig, fig.replace(imgM[0], wrapped));
  }

  function figPct(e, wrap) {
    const r = wrap.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    const cx = t.clientX == null ? 0 : t.clientX, cy = t.clientY == null ? 0 : t.clientY;
    return [Math.max(0, Math.min(100, (cx - r.left) / (r.width || 1) * 100)),
            Math.max(0, Math.min(100, (cy - r.top) / (r.height || 1) * 100))];
  }

  function figBoxesFlat() {
    return Object.keys(figState.boxes).reduce((a, L) => a.concat(figState.boxes[L] || []), []);
  }

  function renderFigChips() {
    $$("#qanswer .figchips").forEach(box => {
      const L = box.dataset.part;
      const items = (figState.boxes[L] || []).filter(b => String(b.value || "").trim());
      const preset = (figState.boxes[L] || []).some(b => b.preset);
      box.innerHTML = items.length
        ? items.map(b => `<span class="figchip">(${esc(L)}) ${esc(b.value)}</span>`).join("")
        : (preset
          ? `<span class="muted" style="font-size:12px">Type your answer in the box marked (${esc(L)}) on the picture above</span>`
          : '<span class="muted" style="font-size:12px">Click the picture to place an answer box</span>');
    });
  }

  function addFigBox(spec) {
    const wrap = figState.wrap; if (!wrap) return null;
    const layer = wrap.querySelector(".figlayer"); if (!layer) return null;
    const part = spec.part || figState.activePart || "a";
    const box = {
      id: spec.id || ("b" + (figState.nextId++)),
      boxId: spec.boxId || null,
      part: part,
      x: Math.max(0, Number(spec.x) || 0), y: Math.max(0, Number(spec.y) || 0),
      w: Number(spec.w) || 9, h: Number(spec.h) || 9,
      value: String(spec.value == null ? "" : spec.value),
      preset: !!spec.preset, keyword: spec.keyword || "",
      ph: spec.ph || "", el: null, input: null
    };
    const el = document.createElement("span");
    el.className = "figbox" + (box.preset ? " preset" : "");
    el.dataset.id = box.id; el.dataset.part = part;
    if (box.boxId) el.dataset.boxid = box.boxId;
    el.style.left = box.x + "%"; el.style.top = box.y + "%";
    el.style.width = box.w + "%"; el.style.height = box.h + "%";
    const bar = document.createElement("span"); bar.className = "figbar";
    bar.innerHTML = `<span class="figtag">(${esc(part)})</span><button type="button" class="figdel" aria-label="Remove this box">×</button>`;
    const inp = document.createElement("input");
    inp.type = "text"; inp.className = "figinput"; inp.maxLength = 24;
    inp.setAttribute("autocomplete", "off");
    inp.placeholder = box.ph || "…"; inp.value = box.value;
    el.appendChild(bar); el.appendChild(inp); layer.appendChild(el);
    box.el = el; box.input = inp;
    (figState.boxes[part] = figState.boxes[part] || []).push(box);
    el.addEventListener("click", ev => ev.stopPropagation());
    if (figState.rec) { inp.readOnly = true; el.classList.add("locked"); }
    else {
      inp.addEventListener("input", () => { box.value = inp.value; renderFigChips(); });
      bar.querySelector(".figdel").addEventListener("click", ev => {
        ev.stopPropagation(); removeFigBox(box);
      });
      const beginDrag = ev => {
        if (figState.rec) return;
        const t = ev.touches ? ev.touches[0] : ev;
        if (!t) return;
        const r = wrap.getBoundingClientRect();
        figDragBox = { box: box, sx: t.clientX, sy: t.clientY, ox: box.x, oy: box.y,
          w: r.width || 1, h: r.height || 1 };
        el.classList.add("dragging");
        if (ev.cancelable) ev.preventDefault();
      };
      bar.addEventListener("mousedown", beginDrag);
      bar.addEventListener("touchstart", beginDrag, { passive: false });
    }
    renderFigChips();
    return box;
  }

  function removeFigBox(box) {
    const arr = figState.boxes[box.part] || [];
    const i = arr.indexOf(box); if (i >= 0) arr.splice(i, 1);
    if (box.el && box.el.parentNode) box.el.parentNode.removeChild(box.el);
    renderFigChips();
  }

  function renderFigInk() {
    const wrap = figState.wrap; if (!wrap) return;
    const ink = wrap.querySelector(".figink"); if (!ink) return;
    ink.innerHTML = "";
    (figState.strokes || []).forEach(s => {
      let el;
      if (s.type === "arrow") {
        el = document.createElementNS(SVGNS, "line");
        el.setAttribute("x1", s.x1); el.setAttribute("y1", s.y1);
        el.setAttribute("x2", s.x2); el.setAttribute("y2", s.y2);
        el.setAttribute("marker-end", "url(#figarrow)");
      } else {
        el = document.createElementNS(SVGNS, "polyline");
        el.setAttribute("points", (s.pts || []).map(p => p[0] + "," + p[1]).join(" "));
      }
      el.setAttribute("class", "figstroke");
      ink.appendChild(el);
    });
  }

  function setFigMode(mode) {
    figState.mode = mode;
    const wrap = figState.wrap; if (!wrap) return;
    wrap.classList.toggle("drawmode", mode !== "label");
    wrap.classList.toggle("labelmode", mode === "label");
    $$("#qanswer .figmode").forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
    const tip = wrap.querySelector(".figtip");
    if (tip) tip.textContent = mode === "label"
      ? "＋ Click the picture to place an answer box"
      : (mode === "arrow" ? "↗ Drag on the picture to draw an arrow" : "✎ Draw on the picture");
  }

  function syncFigValues() {
    figBoxesFlat().forEach(b => { if (b.input) b.value = b.input.value; });
  }
  function serializeFigBoxes() {
    const out = {};
    Object.keys(figState.boxes).forEach(L => {
      out[L] = (figState.boxes[L] || []).map(b => ({
        id: b.id, boxId: b.boxId, part: b.part, x: b.x, y: b.y, w: b.w, h: b.h,
        value: b.value, preset: b.preset, keyword: b.keyword
      }));
    });
    return out;
  }
  function figTextFor(part) {
    return (figState.boxes[part] || []).map(b => {
      const v = String(b.value || "").trim();
      if (!v) return "";
      return b.keyword ? (b.keyword + " " + v) : v;
    }).filter(Boolean).join("; ");
  }

  function initFigureOverlay(q, parts, rec) {
    const fa = q.figAnswer; if (!fa) return;
    const wrap = document.querySelector("#qstem .diagwrap.figans, #qanswer .diagwrap.figans");
    if (!wrap) return;
    const fp = (parts || []).filter(p => p.fig);
    const hasDraw = fp.some(p => p.fig === "draw");
    figState = { boxes: {}, strokes: [], mode: hasDraw ? "draw" : "label",
      activePart: (fp.find(p => p.fig === "text") || fp[0] || {}).letter || "a",
      wrap: wrap, nextId: 1, rec: !!rec };
    figDragBox = null; figStroke = null;
    // pre-placed boxes already show where to write — the floating tip would
    // only cover the picture, so keep it for click-to-add questions only
    if ((fa.boxes || []).length) wrap.classList.add("withpreset");
    const saved = (rec && rec.figBoxes) || null;
    (fa.boxes || []).forEach((b, i) => {
      const bid = b.id || ("p" + i);
      const sv = saved ? (saved[b.part] || []).find(s => s.boxId === bid || s.id === bid) : null;
      addFigBox({ id: bid, boxId: bid, part: b.part, x: b.x, y: b.y, w: b.w, h: b.h,
        value: sv ? sv.value : "", preset: true, keyword: b.keyword, ph: b.ph });
    });
    if (saved) {
      Object.keys(saved).forEach(L => (saved[L] || []).filter(s => !s.preset).forEach(s =>
        addFigBox({ id: s.id, part: L, x: s.x, y: s.y, w: s.w, h: s.h,
          value: s.value, keyword: s.keyword })));
    }
    figState.strokes = (rec && rec.figStrokes) ? rec.figStrokes.slice() : [];
    renderFigInk();
    setFigMode(figState.mode);

    const layer = wrap.querySelector(".figlayer");
    const svg = wrap.querySelector(".figsvg");
    if (layer && !rec) layer.addEventListener("click", ev => {
      if (figState.mode !== "label") return;
      if (ev.target.closest && ev.target.closest(".figbox")) return;
      const p = figPct(ev, wrap);
      const nb = addFigBox({ x: Math.max(0, p[0] - 4.5), y: Math.max(0, p[1] - 4),
        w: 9, h: 8, part: figState.activePart });
      if (nb && nb.input) nb.input.focus();
    });
    if (svg && !rec) {
      const down = ev => {
        if (figState.mode === "label") return;
        const p = figPct(ev, wrap);
        figStroke = figState.mode === "arrow"
          ? { type: "arrow", x1: p[0], y1: p[1], x2: p[0], y2: p[1] }
          : { type: "line", pts: [p] };
        if (ev.cancelable) ev.preventDefault();
      };
      svg.addEventListener("mousedown", down);
      svg.addEventListener("touchstart", ev => {
        if (ev.touches && ev.touches[0]) down(ev);
      }, { passive: false });
    }

    $$("#qanswer .figadd").forEach(btn => btn.addEventListener("click", () => {
      if (rec) return;
      const L = btn.dataset.part;
      figState.activePart = L; setFigMode("label");
      const nb = addFigBox({ x: 42, y: 45, w: 12, h: 9, part: L });
      if (nb && nb.input) nb.input.focus();
    }));
    $$("#qanswer .figclearboxes").forEach(btn => btn.addEventListener("click", () => {
      if (rec) return;
      (figState.boxes[btn.dataset.part] || []).slice().forEach(removeFigBox);
    }));
    $$("#qanswer .figmode").forEach(btn => btn.addEventListener("click", () => {
      if (rec) return; setFigMode(btn.dataset.mode);
    }));
    $$("#qanswer .figclearstroke").forEach(btn => btn.addEventListener("click", () => {
      if (rec) return;
      figState.strokes = []; figStroke = null; renderFigInk();
    }));
    if (rec) $$("#qanswer .figpanel button").forEach(b => b.disabled = true);
    renderFigChips();
  }

  // Global drag / freehand handlers (installed once). They only act while a
  // figure answer sheet is on screen and unlocked.
  function figPointerMove(e) {
    const t = e.touches ? e.touches[0] : e;
    if (!t) return;
    if (figDragBox) {
      const g = figDragBox;
      g.box.x = Math.max(0, Math.min(100 - g.box.w, g.ox + (t.clientX - g.sx) / g.w * 100));
      g.box.y = Math.max(0, Math.min(100 - g.box.h, g.oy + (t.clientY - g.sy) / g.h * 100));
      g.box.el.style.left = g.box.x + "%"; g.box.el.style.top = g.box.y + "%";
      if (e.cancelable) e.preventDefault();
      return;
    }
    if (figStroke && figState.wrap) {
      const p = figPct(e, figState.wrap);
      if (figStroke.type === "arrow") { figStroke.x2 = p[0]; figStroke.y2 = p[1]; }
      else {
        const last = figStroke.pts[figStroke.pts.length - 1];
        if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) > 0.5) figStroke.pts.push(p);
      }
      figState.strokes = figState.strokes.filter(s => !s._live);
      const live = { _live: true, type: figStroke.type };
      if (figStroke.type === "line") live.pts = figStroke.pts.slice();
      else { live.x1 = figStroke.x1; live.y1 = figStroke.y1; live.x2 = figStroke.x2; live.y2 = figStroke.y2; }
      figState.strokes.push(live);
      renderFigInk();
      if (e.cancelable) e.preventDefault();
    }
  }
  function figPointerUp() {
    if (figDragBox) { figDragBox.box.el.classList.remove("dragging"); figDragBox = null; }
    if (figStroke) {
      figState.strokes = figState.strokes.filter(s => !s._live);
      figState.strokes.push(figStroke.type === "line"
        ? { type: "line", pts: figStroke.pts.slice() }
        : { type: "arrow", x1: figStroke.x1, y1: figStroke.y1, x2: figStroke.x2, y2: figStroke.y2 });
      figStroke = null; renderFigInk();
    }
  }
  document.addEventListener("mousemove", figPointerMove);
  document.addEventListener("mouseup", figPointerUp);
  document.addEventListener("touchmove", figPointerMove, { passive: false });
  document.addEventListener("touchend", figPointerUp);

  /* A "tick the correct box(es)" part renders its options straight into the
     question's own table (the column headed "Keep the same" / "Tick (√)" /
     "True | False"). We read the table from the stem so the widget sits exactly
     where the paper prints the boxes, and no separate text box is shown. */
  function tickSpecFor(q, part) {
    const meta = part.tick || {};
    const div = document.createElement("div");
    div.innerHTML = q.stem || "";
    const tables = Array.from(div.querySelectorAll("table"));
    const table = tables[meta.table || 0];
    if (!table) return null;
    const trs = Array.from(table.querySelectorAll("tr"));
    if (trs.length < 2) return null;
    const cellsOf = tr => Array.from(tr.querySelectorAll("td,th"))
      .map(td => (td.textContent || "").replace(/\s+/g, " ").trim());
    const head = cellsOf(trs[0]);
    const body = trs.slice(1).map(cellsOf).filter(r => r.length);
    if (!body.length) return null;
    const blank = c => !c || /^\[\s*\]$/.test(c) || /^[_ ]+$/.test(c);
    const maxCols = Math.max(head.length, ...body.map(r => r.length));
    // First column from which every trailing cell is an empty answer box.
    let startCol = 1;
    for (let c = 1; c < maxCols; c++) {
      if (body.every(r => r.slice(c).every(blank))) { startCol = c; break; }
    }
    const rows = body.map(r => r.slice(0, startCol).filter(Boolean).join(" ").trim());
    const ncols = Math.max(1, maxCols - startCol);
    return {
      table: meta.table || 0, rows, ncols, startCol,
      choices: head.slice(startCol), correct: meta.correct || []
    };
  }

  function injectTickInputs(q, parts, rec) {
    // tables may live in the intro stem or inside a sub-question card, in document order
    const stemTables = Array.from(document.querySelectorAll("#qstem table, #qanswer .partstem table"));
    parts.filter(p => p.type === "tick").forEach(p => {
      const spec = tickSpecFor(q, p);
      if (!spec) return;
      const table = stemTables[spec.table];
      if (!table) return;
      const trs = Array.from(table.querySelectorAll("tr")).slice(1);
      const saved = (rec && rec.ticks && rec.ticks[p.letter]) || {};
      const okRows = (rec && rec.tickOk && rec.tickOk[p.letter]) || null;
      trs.forEach((tr, r) => {
        const tds = Array.from(tr.querySelectorAll("td,th"));
        for (let c = 0; c < spec.ncols; c++) {
          const td = tds[spec.startCol + c];
          if (!td) continue;
          const inp = document.createElement("input");
          inp.type = "checkbox";
          inp.className = "tickinput";
          inp.dataset.tickpart = p.letter;
          inp.dataset.tickrow = String(r);
          inp.dataset.tickcol = String(c);
          const lab = document.createElement("label");
          lab.className = "tickcell";
          lab.title = spec.rows[r] ? spec.rows[r] + (spec.ncols > 1 ? " — " + (spec.choices[c] || "") : "") : "";
          lab.appendChild(inp);
          td.innerHTML = "";
          td.appendChild(lab);
          td.classList.add("tickbox");
          if (saved[r] === c || (spec.ncols === 1 && saved[r] === 0 && c === 0)) inp.checked = true;
          if (rec) {
            inp.disabled = true;
            if (okRows && okRows[r] != null) td.classList.add(okRows[r] ? "graded-ok" : "graded-miss");
          } else if (spec.ncols > 1) {
            // one tick per row, but allow unticking by clicking the same box again
            inp.addEventListener("change", () => {
              if (!inp.checked) return;
              tr.querySelectorAll("input.tickinput").forEach(x => { if (x !== inp) x.checked = false; });
            });
          }
        }
      });
    });
  }

  function readTickInputs(parts) {
    const out = {};
    parts.filter(p => p.type === "tick").forEach(p => { out[p.letter] = {}; });
    document.querySelectorAll("#qstem input.tickinput, #qanswer input.tickinput").forEach(inp => {
      if (!inp.checked) return;
      const L = inp.dataset.tickpart;
      if (!out[L]) out[L] = {};
      out[L][inp.dataset.tickrow] = Number(inp.dataset.tickcol);
    });
    return out;
  }

  function tickText(q, part, selected) {
    const spec = tickSpecFor(q, part);
    if (!spec) return "";
    return spec.rows.map((label, r) => {
      const c = selected[r];
      if (c == null) return "";
      return label + (spec.ncols > 1 && spec.choices[c] ? " → " + spec.choices[c] : "");
    }).filter(Boolean).join("; ");
  }

  // Questions with a tick table are graded exactly: each row is right or wrong,
  // and the written sub-parts are graded on their own checkpoints only.
  function gradeWithTicks(q, parts, textByPart, tickByPart) {
    const res = [], partScores = {}, tickOk = {};
    let score = 0;
    const tickParts = parts.filter(p => p.type === "tick");
    const otherParts = parts.filter(p => p.type !== "tick");
    const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    const tickLabels = [];
    const tickPartLabels = new Set();

    tickParts.forEach(p => {
      tickPartLabels.add(p.label);
      const spec = tickSpecFor(q, p);
      const correct = p.tick ? p.tick.correct : [];
      const selected = tickByPart[p.letter] || {};
      const ok = {};
      let hits = 0;
      if (spec) {
        spec.rows.forEach((label, r) => {
          tickLabels.push(norm(label));
          const want = Array.isArray(correct)
            ? (correct.indexOf(r) >= 0 ? 0 : -1)
            : (correct[String(r)] != null ? Number(correct[String(r)]) : -1);
          const got = selected[r] != null ? Number(selected[r]) : -1;
          const good = got === want;
          ok[r] = good;
          if (good) hits++;
          const wantTxt = want < 0 ? "leave unticked" : "tick " + (spec.choices[want] || "this box");
          const gotTxt = got < 0 ? "you left it blank" : "you ticked " + (spec.choices[got] || "it");
          res.push({ part: p.label, span: label + " — " + wantTxt + (good ? "" : " · " + gotTxt), hit: good });
        });
      }
      tickOk[p.letter] = ok;
      const sc = spec && spec.rows.length ? roundHalf(p.marks * hits / spec.rows.length) : 0;
      partScores[p.letter] = sc;
      score += sc;
    });

    const otherMarks = otherParts.reduce((a, p) => a + (p.marks || 0), 0);
    const cps = (q.checkpoints || []).filter(c => {
      if (c.part && tickPartLabels.has(c.part)) return false;
      if (!c.part) {
        const s = norm(c.span);
        if (tickLabels.some(l => l.length > 4 && s.indexOf(l) >= 0)) return false;
      }
      return true;
    });
    const manual = cps.filter(c => c.manual);
    const tagged = cps.some(c => c.part);
    if (tagged) {
      otherParts.forEach(p => {
        partScores[p.letter] = 0;
        if (p.type === "draw") return;
        const pcps = cps.filter(c => c.part === p.label);
        if (!pcps.length) return;
        const g = window.QBGrade.gradeOEQ({ marks: p.marks, checkpoints: pcps }, textByPart[p.letter] || "");
        partScores[p.letter] = g.score; score += g.score;
        g.res.forEach(r => res.push({ part: p.label, span: r.span, hit: r.hit }));
      });
    } else if (cps.length && otherMarks > 0) {
      const joined = otherParts.map(p => p.type === "draw" ? "" : (textByPart[p.letter] || "")).join(" ");
      const g = window.QBGrade.gradeOEQ({ marks: otherMarks, checkpoints: cps }, joined);
      score += g.score;
      const sole = otherParts.length === 1 ? otherParts[0] : null;
      if (sole) partScores[sole.letter] = g.score;
      g.res.forEach(r => res.push({ part: r.part || (sole ? sole.label : ""), span: r.span, hit: r.hit }));
    }
    return { score: Math.min(roundHalf(score), q.marks), res, manual, auto: true, partScores, drawParts: [], tickOk };
  }

  /* Genuine (a)(b)(c) sub-question labels only. Rejects "(g)" in "mass (g)",
     "(b)" cited in "stated in (b)", "box a)" in a caption, and repeated letters.
     Without this, a question could render a duplicate card and cap full marks. */
  function partLabelIndexes(stem) {
    const re = /\(?([a-z])\)/g;
    let m; const out = []; let expect = 0;   // expect a, then b, then c …
    // "(i)"/"(a)" inside a table row or a figure caption is an option label,
    // not a sub-question — never split on those.
    const ranges = [];
    const blockRe = /<(table|figure|figcaption)\b[^>]*>[\s\S]*?<\/\1>/gi;
    let bm;
    while ((bm = blockRe.exec(stem))) ranges.push([bm.index, bm.index + bm[0].length]);
    const inBlock = i => ranges.some(r => i >= r[0] && i < r[1]);
    while ((m = re.exec(stem))) {
      const L = m[1];
      const pre = m.index > 0 ? stem[m.index - 1] : " ";
      if (/[a-z0-9]/i.test(pre)) continue;          // skip things like "e.g.)"
      if (inBlock(m.index)) continue;
      // A label starts a line when what precedes it is a tag, punctuation,
      // a bullet or a blank line — never when it follows a word ("stated in (b)").
      const tail = stem.slice(0, m.index).replace(/\s+$/, "");
      const lineStart = tail === "" || !/[a-z0-9]/i.test(tail.slice(-1));
      if (!lineStart) continue;
      const k = L.charCodeAt(0) - 97;
      if (k !== expect) continue;                   // rejects "(i)" options and repeated "(a)"
      out.push({ letter: L, index: m.index });
      expect = k + 1;
    }
    return out;
  }

  function getQuestionParts(q) {
    let parts;
    if (Array.isArray(q.parts) && q.parts.length) {
      parts = q.parts.map(p => Object.assign({}, p));
    } else {
      const stem = q.stem || "";
      const idx = partLabelIndexes(stem).map(x => [x.letter, x.index]);
      if (idx.length < 2) {
        // A picture-fill question with no (a)(b) labels still needs its own
        // answer widget (on the image) rather than the generic textarea.
        if (!(q.figAnswer && q.figAnswer.single)) return null;
        parts = [{ label: "", letter: "a", type: "text", marks: q.marks, unit: "", hint: "" }];
      } else {
        const segs = [];
        for (let k = 0; k < idx.length; k++) {
          const s = idx[k][1];
          const e = k + 1 < idx.length ? idx[k + 1][1] : stem.length;
          segs.push({ letter: idx[k][0], text: stem.slice(s, e) });
        }
        const types = segs.map(s => {
          const t = s.text.toLowerCase();
          if (/\b(draw|drawing|sketch|shade)\b/.test(t) && !/\bdraw (a|an) (conclusion|conclusions|inference)\b/.test(t)) return "draw";
          if (/_{2,}|_{3,}\s*[A-Za-z%°\u00b0]|____/.test(s.text)) return "blank";
          return "text";
        });
        const plan = window.QBGrade.allocateMarks(q.marks, segs.length);
        parts = segs.map((s, k) => {
          const unit = (s.text.match(/_{2,}\s*([A-Za-z%°\u00b0]+)/) || [])[1] || "";
          const hint = s.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          return { label: "(" + s.letter + ")", letter: s.letter, type: types[k], marks: plan[k] || 0, unit, hint: hint.slice(0, 150) };
        });
      }
    }
    parts.forEach(p => {
      p.circles = (p.circles || []).map(g => Object.assign({}, g));
      p.circles.forEach((g, i) => { if (!g.id) g.id = p.letter + (i + 1); });
    });
    const fp = (q.figAnswer && q.figAnswer.parts) || {};
    parts.forEach(p => {
      if (!fp[p.letter]) return;
      p.fig = fp[p.letter];
      if (p.fig === "draw" && p.type !== "tick") p.type = "draw";
    });
    return parts;
  }

  /* Exact grading for "write the letter X inside this part of the picture".
     Keyword grading cannot see WHERE a label was put, and a pupil who writes
     "S" in the right circle would otherwise score nothing. Each pre-placed
     box carries the expected text; the mark is awarded only when a box with
     that id still sits inside its zone and holds the right answer. */
  function figExpectOk(value, expect) {
    if (Array.isArray(expect)) return expect.some(e => figExpectOk(value, e));
    const v = String(value || "").trim().toLowerCase();
    const e = String(expect == null ? "" : expect).trim().toLowerCase();
    if (e === "") return !v;                       // box that must be left blank
    if (!v) return false;
    const tick = s => /^[✓√]+$/.test(s) || ["tick", "yes", "true"].indexOf(s) >= 0;
    if (tick(v) && tick(e)) return true;
    const letters = s => (String(s).toUpperCase().match(/[A-Z]/g) || []).sort().join("");
    if (letters(e) && letters(e).length <= 4) return letters(v) === letters(e);
    return v === e || (v.length >= 3 && e.indexOf(v) >= 0);
  }
  function inFigZone(box, z) {
    if (!z) return true;
    const cx = Number(box.x) + Number(box.w) / 2;
    const cy = Number(box.y) + Number(box.h) / 2;
    return cx >= Number(z.x) && cx <= Number(z.x) + Number(z.w) &&
           cy >= Number(z.y) && cy <= Number(z.y) + Number(z.h);
  }
  function gradeFigExact(q, parts, textByPart, figBoxes) {
    const defs = (q.figAnswer.boxes || []).filter(b => b.expect !== undefined && b.expect !== null);
    const okMap = {}, res = [], partScores = {}, drawParts = [];
    const figLetters = new Set(defs.map(b => b.part));
    let score = 0;
    defs.forEach(b => {
      // Match by POSITION + value, not by the pre-placed box's id: a pupil who
      // deletes a box and taps the same spot again still gets the mark.
      const inZone = ((figBoxes || {})[b.part] || []).filter(f => inFigZone(f, b.zone || b));
      const ok = String(b.expect) === ""
        ? !inZone.some(f => String(f.value || "").trim())
        : inZone.some(f => figExpectOk(f.value, b.expect));
      okMap[b.id] = ok;
      res.push({ part: "(" + b.part + ")", span: b.span || ("Write " + (b.expect || "the answer")), hit: ok });
    });
    parts.forEach(p => {
      partScores[p.letter] = 0;
      const bs = defs.filter(b => b.part === p.letter);
      if (bs.length) {
        const hits = bs.filter(b => okMap[b.id]).length;
        partScores[p.letter] = roundHalf(p.marks * hits / bs.length);
        score += partScores[p.letter];
        return;
      }
      if (p.type === "draw" || p.fig === "draw") { drawParts.push(p.letter); return; }
      const pcps = (q.checkpoints || []).filter(c => c.part === "(" + p.letter + ")");
      if (!pcps.length) return;
      const g = window.QBGrade.gradeOEQ({ marks: p.marks, checkpoints: pcps }, textByPart[p.letter] || "");
      partScores[p.letter] = g.score; score += g.score;
      g.res.forEach(r => res.push({ part: "(" + p.letter + ")", span: r.span, hit: r.hit }));
    });
    const untagged = (q.checkpoints || []).filter(c => !c.part);
    const others = parts.filter(p => !figLetters.has(p.letter) && p.type !== "draw" && p.fig !== "draw");
    if (untagged.length && others.length) {
      const g = window.QBGrade.gradeOEQ(
        { marks: others.reduce((a, p) => a + p.marks, 0), checkpoints: untagged },
        others.map(p => textByPart[p.letter] || "").join(" "));
      score += g.score;
      g.res.forEach(r => res.push({ part: "", span: r.span, hit: r.hit }));
    }
    return { score: Math.min(q.marks, roundHalf(score)), res, manual: [], auto: true,
      partScores, drawParts, figOk: okMap };
  }

  function resolveCircleCps(q, p) {
    if (p.cps) return p.cps.map(x => typeof x === "number" ? (q.checkpoints || [])[x] : x).filter(Boolean);
    return (q.checkpoints || []).filter(c => c.part === "(" + p.letter + ")");
  }

  /* Circle questions are graded EXACTLY: a clicked word is either the official
     option or it is not. Written sub-parts are still keyword graded, but only
     against their own checkpoints. Mark totals are declared per part in data.js
     and add up to q.marks, so a fully correct pupil gets full marks — the old
     "5 keywords / 2 marks" split could never reach more than 1.5/2. */
  function gradeCircleParts(q, parts, textByPart, picks) {
    const res = [], partScores = {}, drawParts = [], circleOk = {};
    let score = 0;
    const optWords = new Set();
    circleGroups(parts).forEach(({ g }) => (g.options || []).forEach(o => optWords.add(normCircle(o))));
    parts.forEach(p => {
      partScores[p.letter] = 0;
      const gs = p.circles || [];
      const cMarks = p.circleMarks != null ? p.circleMarks : (p.type === "circle" ? p.marks : 0);
      if (gs.length) {
        const plan = p.circleAll ? null : window.QBGrade.allocateMarks(cMarks, gs.length);
        const hits = gs.map(g => {
          const got = picks[g.id] || [];
          const want = Array.isArray(g.correct) ? g.correct : [g.correct];
          const ok = g.multi
            ? (got.length === want.length && want.every(w => got.some(v => normCircle(v) === normCircle(w))))
            : (got.length === 1 && normCircle(got[0]) === normCircle(want[0]));
          circleOk[g.id] = ok;
          return ok;
        });
        let gained = 0;
        if (p.circleAll) gained = hits.every(Boolean) ? cMarks : 0;
        else hits.forEach((h, i) => { if (h) gained += plan[i] || 0; });
        score += gained;
        partScores[p.letter] += gained;
        gs.forEach((g, i) => {
          const got = picks[g.id] || [];
          const want = Array.isArray(g.correct) ? g.correct.join(" + ") : String(g.correct);
          res.push({ part: p.label || "",
            span: (g.label ? g.label + " → " : "") + want +
              (hits[i] ? "" : " · you circled " + (got.length ? got.join(" + ") : "nothing")),
            hit: hits[i] });
        });
      }
      if (p.type === "draw" || p.fig === "draw") {
        drawParts.push(p.letter);
        res.push({ part: p.label || "", span: "Drawing on the picture — grade yourself", hit: false, manual: true });
        return;
      }
      const tMarks = roundHalf(p.marks - cMarks);
      if (tMarks <= 0) return;
      let cps = resolveCircleCps(q, p).filter(c => !window.QBGrade.isMarkNote(c));
      if (!cps.length) {
        cps = (q.checkpoints || []).filter(c => !c.part && !optWords.has(normCircle(c.span)) &&
          !window.QBGrade.isMarkNote(c));
      }
      if (!cps.length) return;
      const g = window.QBGrade.gradeOEQ({ marks: tMarks, checkpoints: cps }, textByPart[p.letter] || "");
      partScores[p.letter] += g.score;
      score += g.score;
      g.res.forEach(r => res.push({ part: p.label || "", span: r.span, hit: r.hit }));
      g.manual.forEach(m => res.push({ part: p.label || "", span: m.span, hit: false, manual: true }));
    });
    return { score: Math.min(q.marks, roundHalf(score)), res,
      manual: res.filter(r => r.manual), auto: true, partScores, drawParts, circleOk };
  }

  function circleGiveUpRes(q, parts) {
    const res = [];
    parts.forEach(p => {
      (p.circles || []).forEach(g => res.push({ part: p.label || "",
        span: (g.label ? g.label + " → " : "") +
          (Array.isArray(g.correct) ? g.correct.join(" + ") : String(g.correct)), hit: false }));
      if (p.type === "draw" || p.fig === "draw") return;
      resolveCircleCps(q, p).filter(c => !window.QBGrade.isMarkNote(c))
        .forEach(c => res.push({ part: p.label || "", span: c.span, hit: false, manual: !!c.manual }));
    });
    return res;
  }

  // Grade each sub-part against its own checkpoints (matched by the "(a)" part
  // tag). Drawing parts carry no auto keywords (graded by the student). Questions
  // whose checkpoints are not part-tagged fall back to the legacy whole-text grade.
  function gradeParts(q, parts, textByPart, tickByPart, figBoxes, circlePicks) {
    if (hasCircles(parts)) return gradeCircleParts(q, parts, textByPart, circlePicks || {});
    if (q.figAnswer && q.figAnswer.exact) return gradeFigExact(q, parts, textByPart, figBoxes || {});
    if (parts.some(p => p.type === "tick")) return gradeWithTicks(q, parts, textByPart, tickByPart || {});
    const cps = q.checkpoints || [];
    const letters = parts.map(p => p.letter);
    const partsCpSet = new Set(letters.map(l => "(" + l + ")"));
    const hasParted = cps.some(c => c.part && partsCpSet.has(c.part));
    if (!hasParted) {
      // A drawing part also has a note/annotation textarea — include those words
      // so labels written next to a drawing can satisfy their keywords.
      const joined = parts.map(p => textByPart[p.letter] || "").join(" ");
      const g = window.QBGrade.gradeOEQ(q, joined);
      return { score: g.score, res: g.res, manual: g.manual, auto: g.auto, partScores: null, drawParts: [] };
    }
    const res = []; const partScores = {}; const drawParts = []; let score = 0;
    parts.forEach(p => {
      partScores[p.letter] = 0;
      if (p.type === "draw") {
        drawParts.push(p.letter);
        cps.filter(c => c.part === "(" + p.letter + ")").forEach(c =>
          res.push({ part: "(" + p.letter + ")", span: c.span, hit: false, manual: true }));
        return;
      }
      const pcps = cps.filter(c => c.part === "(" + p.letter + ")");
      if (!pcps.length) return;
      const g = window.QBGrade.gradeOEQ({ marks: p.marks, checkpoints: pcps }, textByPart[p.letter] || "");
      partScores[p.letter] = g.score; score += g.score;
      g.res.forEach(r => res.push({ part: "(" + p.letter + ")", span: r.span, hit: r.hit }));
    });
    return { score: Math.min(score, q.marks), res, manual: res.filter(r => r.manual), auto: true, partScores, drawParts };
  }

  /* ---------------- interleave sub-questions with their answer boxes ----------------
     The stem is one HTML blob. Split it at the (a)/(b)/(c) labels using real DOM
     nodes (never raw string offsets) so <p>, <br>, <figure> and <table> markup
     stays well formed. Each slice is then rendered inside the card that holds
     that sub-question's answer widget. If a stem cannot be split safely, return
     null and the caller keeps the original layout. */
  function splitStemForParts(stemHTML, parts) {
    const letters = parts.map(p => p.letter);
    const host = document.createElement("div");
    host.innerHTML = stemHTML;
    const markRe = /\(?([a-z])\)/g;
    let expect = 0;                 // shared across all blocks: a, then b, then c…

    function findMarkers(el) {
      const out = [];
      const walker = document.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
      let n;
      while ((n = walker.nextNode())) {
        const t = n.nodeValue || "";
        markRe.lastIndex = 0;
        let m;
        while ((m = markRe.exec(t))) {
          const L = m[1];
          if (L !== letters[expect]) continue;            // strict a → b → c order
          const pre = m.index > 0 ? t[m.index - 1] : " ";
          if (/[a-z0-9]/i.test(pre)) continue;             // e.g. "e.g.)"
          const before = t.slice(0, m.index).replace(/\s+$/, "");
          const atStart = m.index === 0 || before === "" || !/[a-z0-9]/i.test(before.slice(-1));
          if (!atStart) continue;                         // ignore "(a)" cited mid-sentence
          out.push({ letter: L, node: n, offset: m.index });
          expect++;
        }
      }
      return out;
    }

    function explode(block, markers) {
      const pieces = [];
      for (let i = markers.length - 1; i >= 0; i--) {
        const mk = markers[i];
        const r = document.createRange();
        try { r.selectNodeContents(block); r.setStart(mk.node, mk.offset); }
        catch (e) { continue; }
        const frag = r.extractContents();
        const clone = document.createElement(block.tagName.toLowerCase());
        Array.from(block.attributes).forEach(a => clone.setAttribute(a.name, a.value));
        clone.appendChild(frag);
        while (clone.firstChild && clone.firstChild.nodeName === "BR") clone.removeChild(clone.firstChild);
        while (clone.lastChild && clone.lastChild.nodeName === "BR") clone.removeChild(clone.lastChild);
        pieces.unshift({ node: clone, letter: mk.letter });
      }
      while (block.lastChild && block.lastChild.nodeName === "BR") block.removeChild(block.lastChild);
      const keep = (block.textContent || "").trim() || block.querySelector("img,table,figure,input,svg");
      if (keep) pieces.unshift({ node: block.cloneNode(true), letter: null });
      return pieces;
    }

    const expanded = [];
    Array.from(host.childNodes).forEach(node => {
      const el = node.nodeType === 1 ? node : null;
      if (el && /^(P|DIV|LI|BLOCKQUOTE|H[1-6]|SECTION)$/.test(el.tagName)
        && !el.querySelector("table,figure")) {
        const markers = findMarkers(el);
        if (markers.length) {
          const pieces = explode(el, markers);
          const frag = document.createDocumentFragment();
          pieces.forEach(pc => frag.appendChild(pc.node));
          const parent = el.parentNode;
          parent.insertBefore(frag, el);
          parent.removeChild(el);
          pieces.forEach(pc => expanded.push(pc));
          return;
        }
      }
      expanded.push({ node, letter: null });
    });

    const ser = n => {
      const d = document.createElement("div");
      d.appendChild(n.cloneNode(true));
      return d.innerHTML;
    };
    const seg = {}; letters.forEach(l => seg[l] = []);
    const intro = [];
    let cur = null;
    expanded.forEach(({ node, letter }) => {
      if (letter && letters.indexOf(letter) >= (cur ? letters.indexOf(cur) : -1)) cur = letter;
      const html = ser(node);
      if (!html) return;
      (cur ? seg[cur] : intro).push(html);
    });
    const byLetter = {};
    letters.forEach(l => byLetter[l] = seg[l].join(""));
    if (letters.some(l => !byLetter[l].trim())) return null;   // not safe → legacy layout
    return { intro: intro.join(""), byLetter };
  }

  function initCanvas(cv) {
    if (!cv) return;
    const ctx = cv.getContext && cv.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
    let drawing = false, last = null;
    const pos = e => {
      const r = cv.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return { x: (t.clientX - r.left) * (cv.width / r.width), y: (t.clientY - r.top) * (cv.height / r.height) };
    };
    const start = e => { if (cv.classList.contains("locked")) return; drawing = true; last = pos(e); if (e.cancelable) e.preventDefault(); };
    const move = e => {
      if (!drawing) return;
      const p = pos(e); ctx.strokeStyle = "#222"; ctx.lineWidth = 2; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p;
      if (e.cancelable) e.preventDefault();
    };
    const end = () => { drawing = false; last = null; };
    cv.addEventListener("mousedown", start); cv.addEventListener("mousemove", move);
    cv.addEventListener("mouseup", end); cv.addEventListener("mouseleave", end);
    cv.addEventListener("touchstart", start, { passive: false }); cv.addEventListener("touchmove", move, { passive: false }); cv.addEventListener("touchend", end);
  }
  function drawSaved(cv, url) {
    const ctx = cv.getContext && cv.getContext("2d"); if (!ctx) return;
    const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, cv.width, cv.height); img.src = url;
  }

  function renderPartedOEQ(q, parts, rec, split) {
    const isRec = !!(rec && rec.type === "OEQ" && rec.parts);
    oeqState = { parts: {}, canvases: {}, ticks: {} };
    const box = $("#qanswer");
    let html = `<div class="partsanswers">`;
    parts.forEach(p => {
      // The sub-question's own wording, figures and tables now live inside its
      // answer card, immediately above the widget — no scrolling back up.
      const seg = (split && split.byLetter[p.letter]) || "";
      const markTag = p.marks ? `<span class="pmark">${p.marks} mark${p.marks > 1 ? "s" : ""}</span>` : "";
      html += `<div class="partans${seg ? " withstem" : ""}" data-part="${p.letter}">`;
      if (seg) {
        html += `<div class="partstem qstem" data-part="${p.letter}">${seg}</div>`;
      } else {
        if (p.label) html += `<div class="partlabel">${esc(p.label)} ${markTag}</div>`;
        if (p.hint) html += `<div class="parthint">${esc(p.hint.slice(0, 160))}</div>`;
      }
      if (p.type === "tick") {
        html += seg
          ? `<div class="tickhint">Tick the correct boxes in the table — no written answer needed.</div>`
          : `<div class="tickhint">Tick the boxes in the table above — no written answer needed here.</div>`;
      } else {
        if (seg) html += `<div class="partanswerlabel">Your answer ${markTag}</div>`;
        const cardCircles = (p.circles || []).filter(g => !g.anchor);
        if (cardCircles.length) {
          html += `<div class="circlegroups">${cardCircles.map(g => circleGroupHTML(g, true)).join("")}</div>`;
        }
        if ((p.circles || []).length) {
          html += `<div class="circlereadout" data-part="${p.letter}"></div>`;
        }
        if (p.fig === "text") {
          const presetHint = (q.figAnswer && (q.figAnswer.boxes || []).length)
            ? `<strong>Answer on the picture above.</strong> Type directly into the boxes drawn on the diagram. Drag a coloured bar to move a box, or click anywhere on the picture to add another one.`
            : `<strong>Answer on the picture above.</strong> Click exactly where your answer belongs (inside a circle, box or space) and type it into the little box that appears. Drag the coloured bar to move a box; extra boxes can be removed with ×.`;
          html += `<div class="figpanel" data-part="${p.letter}">
              <div class="fighint">${presetHint} No answer box is needed down here.</div>
              <div class="figtools">
                <button type="button" class="btn sm figadd" data-part="${p.letter}">＋ Add an answer box ${esc(p.label)}</button>
                <button type="button" class="btn sm ghost figclearboxes" data-part="${p.letter}">Clear my boxes</button>
              </div>
              <div class="figchips" data-part="${p.letter}"></div>
            </div>`;
        } else if (p.fig === "draw") {
          html += `<div class="figpanel figdrawpanel" data-part="${p.letter}">
              <div class="fighint"><strong>Draw on the picture above.</strong> Pick a tool, then draw straight on the diagram. Use <em>Label</em> to add a word next to what you drew. Drawings are graded by you against the model answer.</div>
              <div class="figtools">
                <button type="button" class="btn sm figmode active" data-mode="draw">✎ Draw</button>
                <button type="button" class="btn sm ghost figmode" data-mode="arrow">↗ Arrow</button>
                <button type="button" class="btn sm ghost figmode" data-mode="label">T Label</button>
                <button type="button" class="btn sm ghost figclearstroke">Clear drawing</button>
              </div>
              <div class="figchips" data-part="${p.letter}"></div>
            </div>`;
        } else if (p.type === "circle") {
          html += `<div class="circlehint">Click the word in the question above to circle it — no typing needed.${(p.circles || []).some(g => g.multi) ? " Select all the correct words." : ""}</div>`;
        } else if (p.type === "draw") {
          html += `<div class="canvaswrap">
              <canvas class="drawcanvas" data-part="${p.letter}" width="600" height="200"></canvas>
              <button type="button" class="btn sm clearcanvas" data-part="${p.letter}">Clear drawing</button>
            </div>
            <textarea class="ans note" data-part="${p.letter}" placeholder="Add labels or notes for your drawing…"></textarea>`;
        } else if (p.type === "blank") {
          html += `<div class="blankwrap"><input class="ans blank" data-part="${p.letter}" placeholder="your answer" autocomplete="off"><span class="unit">${esc(p.unit || "")}</span></div>`;
        } else {
          html += `<textarea class="ans" data-part="${p.letter}" placeholder="Write your answer for ${esc(p.label)}…"></textarea>`;
        }
      }
      html += `</div>`;
    });
    html += `</div>`;
    const hasTicks = parts.some(p => p.type === "tick");
    const hasFig = parts.some(p => p.fig);
    const hasCircle = hasCircles(parts);
    html += `<div class="structhint"><span>${hasCircle ? "Click the correct word" : (hasTicks ? "Tick the boxes" : (hasFig ? "Answer on the picture" : "One box per (a)(b)(c)"))}</span><span>${hasFig ? "Click the diagram" : (hasCircle ? "Circle it, then submit" : (split ? "Answer under each question" : "Hit the keywords"))}</span><span>Submit</span></div>`;
    html += `<p class="answerhint">${hasCircle
      ? "Click the correct word in the question to circle it — there is no text box for those parts. "
      : (hasFig
        ? "Write or draw your answers in the boxes on the diagram above — there is no separate answer box below. "
        : (split ? "Each sub-question is followed immediately by its own answer space. " : "Each sub-question has its own answer space. "))}${hasTicks ? "Tick the correct boxes in the table; written parts are checked against the scoring keywords." : (hasFig ? "Drawings and their positions are graded by you against the model answer." : "Drawing parts are graded by you afterwards; the rest are checked against the scoring keywords.")}</p>`;
    box.innerHTML = html;
    if (hasTicks) injectTickInputs(q, parts, isRec ? rec : null);
    if (hasCircle) bindCircleWords(parts, isRec ? rec : null);

    parts.forEach(p => {
      const el = box.querySelector(`.ans[data-part="${p.letter}"]`);
      if (isRec && el) { el.value = rec.parts[p.letter] || ""; el.setAttribute("readonly", ""); }
      if (p.type === "draw" && !p.fig) {
        const cv = box.querySelector(`canvas[data-part="${p.letter}"]`);
        const clr = box.querySelector(`.clearcanvas[data-part="${p.letter}"]`);
        if (isRec && rec.canvases && rec.canvases[p.letter]) {
          drawSaved(cv, rec.canvases[p.letter]); cv.classList.add("locked"); if (clr) clr.disabled = true;
        } else if (!isRec) {
          initCanvas(cv);
        }
        if (clr) clr.addEventListener("click", () => {
          if (cv.classList.contains("locked")) return;
          const cx = cv.getContext("2d");
          if (cx) { cx.clearRect(0, 0, cv.width, cv.height); cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height); }
        });
      }
    });
    if (isRec) box.classList.add("locked");
  }

  /* ---------------- keyword grading (implemented in grade.js) ---------------- */
  const gradeOEQ = (q, text) => window.QBGrade.gradeOEQ(q, text);

  /* ---------------- home filters ---------------- */
  const F = { years: new Set(), papers: new Set(), schools: new Set(), subs: new Set(), diffs: new Set() };
  const DIFF_KEYS = ["Easy", "Medium", "Hard"];
  const inDiff = (key, d) => key === "Easy" ? d <= 2 : key === "Medium" ? d === 3 : d >= 4;

  function countBy(fn) {
    const m = new Map();
    QB.forEach(q => { const k = fn(q); m.set(k, (m.get(k) || 0) + 1); });
    return m;
  }

  function buildFilters() {
    const years = countBy(q => q.year);
    $("#fYear").innerHTML = Array.from(years.keys()).sort().map(y =>
      `<button class="chip" data-f="years" data-v="${esc(y)}">${esc(y)}<span class="n">${years.get(y)}</span></button>`
    ).join("");

    const papers = countBy(q => q.paper);
    const plabel = { WA1: "WA1 · Mar", WA2: "WA2 · May", WA3: "WA3 · Aug", EOY: "EOY · Year-end" };
    $("#fPaper").innerHTML = ["WA1", "WA2", "WA3", "EOY"].filter(p => papers.get(p)).map(p =>
      `<button class="chip" data-f="papers" data-v="${p}">${plabel[p]}<span class="n">${papers.get(p)}</span></button>`
    ).join("");

    const schools = countBy(q => q.schoolShort);
    $("#fSchool").innerHTML = Array.from(schools.keys()).sort().map(s =>
      `<button class="chip" data-f="schools" data-v="${esc(s)}">${esc(s)}<span class="n">${schools.get(s)}</span></button>`
    ).join("");

    const subs = countBy(q => q.topic + "|" + q.subtopic);
    $("#fTopic").innerHTML = MAJORS.map(([major, list]) => {
      const chips = list.map(sub => {
        const n = subs.get(major + "|" + sub) || 0;
        if (!n) return "";
        return `<button class="chip" data-f="subs" data-v="${esc(major + "|" + sub)}">${esc(sub)}<span class="n">${n}</span></button>`;
      }).join("");
      return chips ? `<div class="topicrow"><span class="topicmajor">${major}</span>${chips}</div>` : "";
    }).join("");

    const diffBuckets = [["Easy", q => q.difficulty <= 2], ["Medium", q => q.difficulty === 3], ["Hard", q => q.difficulty >= 4]];
    $("#fDiff").innerHTML = diffBuckets.map(([label, fn]) =>
      `<button class="chip" data-f="diffs" data-v="${label}">${label}<span class="n">${QB.filter(fn).length}</span></button>`
    ).join("");
  }

  function pool() {
    return QB.filter(q =>
      (!F.years.size || F.years.has(q.year)) &&
      (!F.papers.size || F.papers.has(q.paper)) &&
      (!F.schools.size || F.schools.has(q.schoolShort)) &&
      (!F.subs.size || F.subs.has(q.topic + "|" + q.subtopic)) &&
      (!F.diffs.size || Array.from(F.diffs).some(k => inDiff(k, q.difficulty)))
    );
  }

  function refreshMatch() {
    const p = pool();
    $("#matchCount").textContent = p.length;
    const mcq = p.filter(q => q.type === "MCQ").length;
    $("#matchDetail").textContent = p.length ? `(MCQ ${mcq} · open-ended ${p.length - mcq})` : "";
    $("#startBtn").disabled = p.length === 0;
  }

  /* ---------------- session ---------------- */
  let S = null; // {ids, i, recs, label}

  function shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  function startSession(ids, label) {
    if (!ids.length) return;
    S = { ids, i: 0, recs: {}, label: label || "" };
    show("quiz");
    renderQ();
  }

  /* ---- navigation --------------------------------------------------
     The student works through the round in order. Going back to review an
     earlier question must never lose their place, so the app always knows
     the "frontier" = the first question that has not been answered yet, and
     offers a one-click way back to it. */
  function frontierIndex() {
    for (let k = 0; k < S.ids.length; k++) if (!S.recs[S.ids[k]]) return k;
    return -1;                       // everything answered
  }

  function renderActions() {
    const rec = S.recs[S.ids[S.i]];
    const answered = !!rec;
    const frontier = frontierIndex();
    const allDone = frontier < 0;
    const last = S.i === S.ids.length - 1;

    // where a "jump back" button should take the student
    let target = -1, label = "";
    if (!allDone && S.i < frontier) {
      target = frontier; label = `⤴ Continue at Q${target + 1}`;
    } else if (allDone && !last) {
      target = S.ids.length - 1; label = `⤴ Back to Q${target + 1}`;
    }

    let hint = "";
    if (!allDone && S.i < frontier) hint = `Reviewing earlier questions — Q${frontier + 1} is where you left off.`;
    else if (S.i > 0) hint = "You can go back to review";
    else if (allDone) hint = "Every question in this round is answered.";

    let html = `<span class="left${(!allDone && S.i < frontier) ? " warn" : ""}">${hint}</span>`;
    if (S.i > 0) html += `<button class="btn ghost" id="prevBtn">← Previous</button>`;
    if (target >= 0) html += `<button class="btn resume" id="resumeBtn">${label}</button>`;
    if (answered) {
      if (!last) html += `<button class="btn ghost" id="nextBtn">Next →</button>`;
      else html += `<button class="btn primary" id="finishBtn">See round results</button>`;
    } else {
      html += `<button class="btn ghost" id="giveupBtn">Don't know — show answer</button>`;
      html += `<button class="btn primary" id="submitBtn">Submit</button>`;
    }
    $("#qactions").innerHTML = html;

    const pb = $("#prevBtn");   if (pb) pb.addEventListener("click", () => { S.i--; renderQ(); });
    const nb = $("#nextBtn");   if (nb) nb.addEventListener("click", () => { S.i++; renderQ(); });
    const rb = $("#resumeBtn"); if (rb) rb.addEventListener("click", () => { S.i = target; renderQ(); });
    const fb = $("#finishBtn"); if (fb) fb.addEventListener("click", finish);
    const sb = $("#submitBtn"); if (sb) sb.addEventListener("click", () => submit(false));
    const gb = $("#giveupBtn"); if (gb) gb.addEventListener("click", () => submit(true));
  }

  function renderQ() {
    const q = BY_ID.get(S.ids[S.i]);
    if (!q) return;
    curQ = q;
    dragCarry = null;
    const _lk = document.getElementById("qstem"); if (_lk) _lk.classList.remove("locked", "intro-empty");
    const _dp = document.getElementById("dragpool"); if (_dp) _dp.classList.remove("locked");
    const _ab = document.getElementById("qanswer"); if (_ab) _ab.classList.remove("locked", "parted");
    const rec = S.recs[q.id];

    $("#progText").textContent = `${S.i + 1} / ${S.ids.length}`;
    $("#progBar").style.width = ((S.i) / S.ids.length * 100) + "%";
    updateLiveScore();

    const isSlot = !!(q.slots && q.slots.length);
    const isLine = !!(q.lineData && q.lineData.left && q.lineData.left.length);
    const isTF = !!(q.tf && q.tf.length);

    const stars = "★".repeat(q.difficulty) + "☆".repeat(Math.max(0, 5 - q.difficulty));
    $("#qmeta").innerHTML = `
      <span class="tag src">${esc(q.schoolShort)} · ${esc(q.year)} ${esc(q.paper)} · ${esc(q.qno)}</span>
      <span class="tag marks">${q.type === "MCQ" ? "MCQ" : isTF ? "True / False" : "Open-ended"} · ${q.marks} mark${q.marks > 1 ? "s" : ""}</span>
      <span class="tag topic">${esc(q.topic)} / ${esc(q.subtopic)}</span>
      <span class="tag diff" title="Difficulty">${stars}</span>`;

    // restore question number if the stem lacks it
    let stem = q.stem;
    if (!new RegExp("^\\s*<p>\\s*(\\*\\*)?\\(?" + q.qno.replace(/[^\d]/g, "")).test(stem) && /^Q?\d/.test(q.qno)) {
      stem = `<p><strong>${esc(q.qno)}.</strong> ${stem.replace(/^<p>/, "")}`;
    }

    if (isSlot) stem = injectDiagramSlots(stem, q);
    if (isLine) stem = injectDiagramLines(stem, q);
    if (q.figAnswer) stem = injectFigureOverlay(stem, q);
    if (isTF) {
      const tfList = q.tf.map((s, i) =>
        `<div class="tfrow" data-tf="${i}"><span class="tftext">${esc(s.label)}) ${esc(s.text)}</span>` +
        `<span class="tfbts"><button type="button" class="tfbtn" data-v="T">T</button>` +
        `<button type="button" class="tfbtn" data-v="F">F</button></span></div>`
      ).join("");
      stem = stem.replace(/______/g, "");
      stem = stem + `<div class="tfwrap">${tfList}</div>`;
    }
    lineState = { edges: [], pending: null };

    // For multi-part OEQ, cut the stem at its (a)(b)(c) labels: the shared
    // introduction stays on top and each sub-question moves into its own card.
    const _qparts = (q.type !== "MCQ" && !isSlot && !isLine && !isTF) ? getQuestionParts(q) : null;
    const _hasCircles = hasCircles(_qparts);
    if (_hasCircles) stem = injectCircleWords(stem, _qparts);
    const _parted = isParted(_qparts);
    const _split = _parted ? splitStemForParts(stem, _qparts) : null;
    $("#qstem").innerHTML = _split ? _split.intro : stem;
    if (_parted) $("#qanswer").classList.add("parted");
    if (_split && !_split.intro.trim()) $("#qstem").classList.add("intro-empty");

    // answer area
    const box = $("#qanswer");
    if (q.type === "MCQ" && q.options.length >= 2) {
      box.innerHTML = `<div class="opts">${q.options.map(o =>
        `<button class="optbtn" data-opt="${esc(o.label)}"><span class="on">${esc(o.label)}</span><span>${esc(o.text)}</span></button>`
      ).join("")}</div>`;
    } else if (q.type === "MCQ") {
      box.innerHTML = `<p class="answerhint">The options are shown in the question diagram. Pick the answer number:</p>
        <div class="opts">${[1, 2, 3, 4].map(n =>
          `<button class="optbtn" data-opt="${n}"><span class="on">${n}</span><span>Option ${n}</span></button>`).join("")}</div>`;
    } else if (isSlot) {
      const isDrag = !!(q.dragPool && q.dragPool.length);
      let html;
      if (isDrag) {
        slotVals = q.slots.map(() => []);
        html = `<p class="answerhint"><strong>Drag each option into the correct box on the diagram above.</strong> Tap an option, then tap its box — or drag it there. Tap a placed option to send it back to the tray.</p>`;
        if (q.extraText && q.extraText.length) {
          html += `<div class="extratext">` + q.extraText.map(t =>
            `<label class="extralbl">${esc(t.part || "")} ${esc(t.prompt || "")}</label>`
          ).join("") + `<textarea class="answer" id="slotExtra" placeholder="Write your answer here…"></textarea></div>`;
        }
        html += `<div class="dragpool" id="dragpool"></div>`;
        html += `<div class="structhint"><span>Tap option</span><span>then tap box</span><span>Submit</span></div>`;
      } else {
        slotVals = [];
        html = `<p class="answerhint"><strong>Fill the boxes directly on the diagram above.</strong> Type the answer into each blank box.`;
        if (q.slots.some(s => s.mode === "letters")) html += ` Use the letters shown in the picture.`;
        html += `</p>`;
        if (q.extraText && q.extraText.length) {
          html += `<div class="extratext">` + q.extraText.map(t =>
            `<label class="extralbl">${esc(t.part || "")} ${esc(t.prompt || "")}</label>`
          ).join("") + `<textarea class="answer" id="slotExtra" placeholder="Write your answer here…"></textarea></div>`;
        }
        html += `<div class="structhint"><span>Fill every box</span><span>${q.slots.some(s => s.mode === "letters") ? "Letters only" : "Short answers"}</span><span>Then submit</span></div>`;
      }
      box.innerHTML = html;
      if (isDrag) {
        if (rec && rec.type === "SLOT" && rec.slotVals) {
          slotVals = rec.slotVals.map(a => a.slice());
          renderDrag();
          const lk = document.getElementById("qstem"); if (lk) lk.classList.add("locked");
          const dp = document.getElementById("dragpool"); if (dp) dp.classList.add("locked");
        } else {
          renderDrag();
        }
      } else if (rec && rec.type === "SLOT") {
        q.slots.forEach((s, i) => {
          const el = box.parentElement.querySelector(`#qstem .slotbox[data-slot="${i}"]`);
          if (el) el.value = rec.vals[i] || "";
        });
        const ex = $("#slotExtra");
        if (ex && rec.textVal) ex.value = rec.textVal;
      }
    } else if (isLine) {
      let html = `<p class="answerhint"><strong>Draw the matching lines directly on the diagram above.</strong> Tap a dot on the left, then a dot on the right to join them. Each object on the left can carry only one line — tap a joined dot again to cancel that line and draw a new one.</p>`;
      if (q.extraText && q.extraText.length) {
        html += `<div class="extratext">` + q.extraText.map(t =>
          `<label class="extralbl">${esc(t.part || "")} ${esc(t.prompt || "")}</label>`
        ).join("") + `<textarea class="answer" id="slotExtra" placeholder="Write your answer here…"></textarea></div>`;
      }
      html += `<div class="structhint"><span>Tap left dot</span><span>then right dot</span><span>Tap joined dot to undo</span></div>`;
      html += `<div class="lineacts"><button class="btn ghost" id="clearLines" type="button">Clear lines</button></div>`;
      box.innerHTML = html;
      if (rec && rec.type === "LINE") {
        lineState.edges = (rec.edges || []).map(e => [e[0], e[1]]);
      }
      bindLineInteractions();
      if (rec && rec.type === "LINE") drawLines();
    } else if (isTF) {
      box.innerHTML = `<p class="answerhint"><strong>Choose T or F</strong> for each statement on the question above — there is no separate answer box. Tap a button, then Submit.</p>`;
      $$("#qstem .tfbtn").forEach(b => {
        b.addEventListener("click", () => {
          if (rec) return;
          const row = b.closest(".tfrow");
          row.querySelectorAll(".tfbtn").forEach(x => x.classList.remove("sel"));
          b.classList.add("sel");
          row.dataset.pick = b.dataset.v;
        });
      });
      if (rec && rec.type === "TF") {
        q.tf.forEach((s, i) => {
          const row = document.querySelector(`#qstem .tfrow[data-tf="${i}"]`);
          if (row && rec.vals[i]) {
            row.querySelectorAll(".tfbtn").forEach(x => x.classList.toggle("sel", x.dataset.v === rec.vals[i]));
          }
        });
      }
    } else {
      const parts = _qparts || getQuestionParts(q);
      if (_parted) {
        renderPartedOEQ(q, parts, rec, _split);
      } else {
        box.innerHTML = `
          <textarea class="answer" id="oeqInput" placeholder="Answer in complete English sentences. Use (a)(b)(c) for sub-questions…"></textarea>
          <div class="structhint"><span>Hit the keywords</span><span>Use full sentences</span><span>Answer every part (a)(b)(c)</span></div>
          <p class="answerhint">Grading matches your answer against the <strong>scoring keywords</strong> — you can fine-tune the score against the model answer afterwards.</p>`;
        if (rec && rec.type === "OEQ" && rec.text != null) {
          const el = $("#oeqInput"); if (el) el.value = rec.text;
        }
      }
    }

    // action bar (Previous / jump-back-to-frontier / Next / Submit)
    renderActions();

    $("#feedback").classList.add("hidden");
    $("#feedback").innerHTML = "";

    if (q.figAnswer) initFigureOverlay(q, _qparts, rec);
    if (_hasCircles && !_parted) bindCircleWords(_qparts, rec);
    if (rec) paintFeedback(q, rec, true);

    // events
    if (q.type === "MCQ") {
      $$("#qanswer .optbtn").forEach(b => {
        b.addEventListener("click", () => {
          if (rec) return;
          $$("#qanswer .optbtn").forEach(x => x.classList.remove("sel"));
          b.classList.add("sel");
          $("#qanswer").dataset.pick = b.dataset.opt;
        });
      });
    }
  }

  function updateLiveScore() {
    let got = 0, tot = 0;
    Object.values(S.recs).forEach(r => { got += r.score; tot += r.marks; });
    $("#liveScore").textContent = round1(got);
    $("#liveTotal").textContent = round1(tot);
  }
  const round1 = n => Math.round(n * 10) / 10;
  // marks in this bank are whole or half marks only
  const roundHalf = n => Math.round((Number(n) || 0) * 2) / 2;

  function submit(giveup) {
    const q = BY_ID.get(S.ids[S.i]);
    if (S.recs[q.id]) return;
    let rec;

    if (giveup) {
      if (q.type === "MCQ") {
        rec = { id: q.id, picked: "-", score: 0, marks: q.marks, ok: false, type: "MCQ", ts: Date.now(), gaveUp: true };
      } else if (q.slots) {
        const g = window.QBGrade.gradeSlots(q, q.slots.map(() => ""));
        const isDrag = !!(q.dragPool && q.dragPool.length);
        rec = { id: q.id, type: "SLOT", vals: q.slots.map(() => ""),
          slotVals: isDrag ? q.slots.map(() => []) : null,
          slotRes: g.slotRes, slotScore: 0,
          slotMarks: g.slotMarks, textVal: "", textScore: 0, textMarks: Math.max(0, q.marks - g.slotMarks),
          textRes: null, textAuto: false, marks: q.marks, score: 0, ok: false, ts: Date.now(), gaveUp: true };
      } else if (q.lineData) {
        const g = window.QBGrade.gradeLines(q, []);
        rec = { id: q.id, type: "LINE", edges: [], lineRes: g.lineRes, lineScore: 0,
          lineMarks: g.lineMarks, textVal: "", textScore: 0, textMarks: Math.max(0, q.marks - g.lineMarks),
          textRes: null, textAuto: false, marks: q.marks, score: 0, ok: false, ts: Date.now(), gaveUp: true };
      } else if (q.tf && q.tf.length) {
        const g = window.QBGrade.gradeTF(q, q.tf.map(() => ""));
        rec = { id: q.id, type: "TF", vals: q.tf.map(() => ""), tfRes: g.tfRes, tfScore: 0,
          tfMarks: g.tfMarks, marks: q.marks, score: 0, ok: false, ts: Date.now(), gaveUp: true };
      } else {
        const parts = getQuestionParts(q);
        if (isParted(parts)) {
          const isCircle = hasCircles(parts);
          const giveRes = isCircle ? circleGiveUpRes(q, parts)
            : (q.checkpoints || []).filter(c => !window.QBGrade.isMarkNote(c))
                .map(c => ({ part: c.part || "", span: c.span, hit: false, manual: !!c.manual }));
          rec = { id: q.id, type: "OEQ", parts: {}, canvases: {}, ticks: {}, tickOk: {}, partRes: null,
            figBoxes: {}, figStrokes: [], figOk: {}, circles: {}, circleOk: {},
            tickParts: parts.filter(p => p.type === "tick").map(p => p.label),
            score: 0, marks: q.marks, ok: false, ts: Date.now(), gaveUp: true,
            res: giveRes, manual: giveRes.filter(r => r.manual), auto: isCircle };
        } else {
          rec = { id: q.id, text: "", score: 0, marks: q.marks, ok: false, type: "OEQ", ts: Date.now(), gaveUp: true,
            res: [], manual: q.checkpoints || [], auto: false };
        }
      }
      S.recs[q.id] = rec;
      STATS.done++; STATS.score += 0; STATS.marks += q.marks;
      save(LS_STATS, STATS);
      wbAdd(rec);
      paintFeedback(q, rec, false);
      afterSubmit();
      updateLiveScore();
      return;
    }

    if (q.type === "MCQ") {
      const pick = $("#qanswer").dataset.pick;
      if (!pick) { flash("Pick an option first"); return; }
      const ok = String(pick) === String(q.choice || "");
      rec = { id: q.id, picked: pick, score: ok ? q.marks : 0, marks: q.marks, ok, type: "MCQ", ts: Date.now() };
    } else if (q.slots) {
      const isDrag = !!(q.dragPool && q.dragPool.length);
      const vals = q.slots.map((s, i) =>
        isDrag ? (slotVals[i] || []).join(", ") : (() => {
          const el = document.querySelector(`#qstem .slotbox[data-slot="${i}"]`);
          return el ? el.value : "";
        })()
      );
      const anyFilled = vals.some(v => v.trim()) ||
        (q.extraText && q.extraText.length && ($("#slotExtra") || {}).value && ($("#slotExtra").value).trim());
      if (!anyFilled) { flash('Fill at least one box (or click "Don\'t know — show answer")'); return; }
      const g = window.QBGrade.gradeSlots(q, vals);
      const textMarks = Math.max(0, q.marks - g.slotMarks);
      let textVal = "", textScore = 0, textRes = null, textAuto = false;
      if (q.extraText && q.extraText.length) {
        textVal = ($("#slotExtra") || {}).value || "";
        if (textVal.trim()) {
          const tg = gradeOEQ({
            checkpoints: (q.textCheckpoints && q.textCheckpoints.length) ? q.textCheckpoints : q.checkpoints,
            marks: textMarks
          }, textVal);
          textScore = tg.score; textRes = tg.res; textAuto = tg.auto;
        }
      }
      const score = Math.min(q.marks, roundHalf(g.slotScore + textScore));
      rec = {
        id: q.id, type: "SLOT", vals, slotVals: isDrag ? slotVals.map(a => a.slice()) : null,
        slotRes: g.slotRes, slotScore: g.slotScore,
        slotMarks: g.slotMarks, textVal, textScore, textMarks: Math.max(0, q.marks - g.slotMarks),
        textRes, textAuto, marks: q.marks, score, ok: score >= q.marks, ts: Date.now()
      };
    } else if (q.lineData) {
      const edges = lineState.edges.map(e => [e[0], e[1]]);
      if (!edges.length) { flash('Draw at least one line (or click "Don\'t know — show answer")'); return; }
      const g = window.QBGrade.gradeLines(q, edges);
      const textMarks = Math.max(0, q.marks - g.lineMarks);
      let textVal = "", textScore = 0, textRes = null, textAuto = false;
      if (q.extraText && q.extraText.length) {
        textVal = ($("#slotExtra") || {}).value || "";
        if (textVal.trim()) {
          const tg = gradeOEQ({
            checkpoints: (q.textCheckpoints && q.textCheckpoints.length) ? q.textCheckpoints : q.checkpoints,
            marks: textMarks
          }, textVal);
          textScore = tg.score; textRes = tg.res; textAuto = tg.auto;
        }
      }
      const score = Math.min(q.marks, Math.round((g.lineScore + textScore) * 10) / 10);
      rec = {
        id: q.id, type: "LINE", edges, lineRes: g.lineRes, lineScore: g.lineScore,
        lineMarks: g.lineMarks, textVal, textScore, textMarks, textRes, textAuto,
        marks: q.marks, score, ok: score >= q.marks, ts: Date.now()
      };
    } else if (q.tf && q.tf.length) {
      const vals = q.tf.map((s, i) => {
        const row = document.querySelector(`#qstem .tfrow[data-tf="${i}"]`);
        return row ? (row.dataset.pick || "") : "";
      });
      if (!vals.some(v => v)) { flash('Choose T or F for at least one statement first'); return; }
      const g = window.QBGrade.gradeTF(q, vals);
      rec = {
        id: q.id, type: "TF", vals, tfRes: g.tfRes, tfScore: g.tfScore,
        tfMarks: g.tfMarks, marks: q.marks, score: g.tfScore, ok: g.tfScore >= q.marks, ts: Date.now()
      };
    } else {
      const parts = getQuestionParts(q);
      if (isParted(parts)) {
        oeqState.parts = {}; oeqState.canvases = {}; oeqState.ticks = {};
        syncFigValues();
        const circlePicks = hasCircles(parts) ? readCirclePicks() : {};
        parts.forEach(p => {
          const el = document.querySelector(`#qanswer .ans[data-part="${p.letter}"]`);
          oeqState.parts[p.letter] = p.fig ? figTextFor(p.letter) : (el ? el.value : "");
          if (p.type === "draw" && !p.fig) {
            const cv = document.querySelector(`#qanswer canvas[data-part="${p.letter}"]`);
            if (cv && cv.toDataURL && typeof cv.toDataURL === "function") {
              try { oeqState.canvases[p.letter] = cv.toDataURL(); } catch (e) {}
            }
          }
        });
        circleGroups(parts).forEach(({ g, part }) => {
          const vals = circlePicks[g.id] || [];
          if (!vals.length) return;
          const prev = oeqState.parts[part.letter] || "";
          oeqState.parts[part.letter] = (prev ? prev + " · " : "") + vals.join(" + ");
        });
        const hasTicks = parts.some(p => p.type === "tick");
        if (hasTicks) {
          oeqState.ticks = readTickInputs(parts);
          parts.filter(p => p.type === "tick").forEach(p => {
            oeqState.parts[p.letter] = tickText(q, p, oeqState.ticks[p.letter] || {});
          });
        }
        const anyFilled = Object.values(oeqState.parts).some(v => v.trim())
          || Object.keys(oeqState.canvases).length > 0
          || Object.values(oeqState.ticks).some(t => Object.keys(t).length > 0)
          || figBoxesFlat().some(b => String(b.value || "").trim())
          || Object.keys(circlePicks).some(k => (circlePicks[k] || []).length)
          || (figState.strokes || []).filter(s => !s._live).length > 0;
        if (!anyFilled) { flash('Answer at least one sub-question (or click "Don\'t know — show answer")'); return; }
        const g = gradeParts(q, parts, oeqState.parts, oeqState.ticks, figState.boxes, circlePicks);
        rec = {
          id: q.id, type: "OEQ", parts: oeqState.parts, canvases: oeqState.canvases,
          ticks: oeqState.ticks, tickOk: g.tickOk || {},
          circles: circlePicks, circleOk: g.circleOk || {},
          figBoxes: serializeFigBoxes(), figStrokes: (figState.strokes || []).filter(s => !s._live),
          figOk: g.figOk || {},
          tickParts: parts.filter(p => p.type === "tick").map(p => p.label),
          partRes: g.partScores, drawParts: g.drawParts, score: g.score, marks: q.marks,
          res: g.res, manual: g.manual, auto: g.auto, ok: g.score >= q.marks, ts: Date.now()
        };
      } else {
        const txt = ($("#oeqInput") || {}).value || "";
        if (!txt.trim()) { flash('Write something first (or click "Don\'t know — show answer")'); return; }
        const g = gradeOEQ(q, txt);
        rec = {
          id: q.id, text: txt, score: g.score, marks: q.marks, type: "OEQ",
          res: g.res, manual: g.manual, auto: g.auto, ok: g.score >= q.marks, ts: Date.now()
        };
      }
    }

    S.recs[q.id] = rec;
    STATS.done++; STATS.score += rec.score; STATS.marks += rec.marks;
    save(LS_STATS, STATS);
    if (rec.score < rec.marks) wbAdd(rec);

    paintFeedback(q, rec, false);
    afterSubmit();
    updateLiveScore();
    const fbel = $("#feedback");
    if (fbel.scrollIntoView) fbel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function afterSubmit() {
    // the question now has a record, so the shared action bar shows
    // Previous / Next (or the jump-back button when reviewing)
    renderActions();
  }

  function flash(msg) {
    const el = document.createElement("div");
    el.textContent = msg;
    el.style.cssText = "position:fixed;left:50%;bottom:32px;transform:translateX(-50%);background:#1b2430;color:#fff;padding:9px 18px;border-radius:10px;font-size:13.5px;z-index:99;opacity:.95";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }

  /* ---------------- feedback ---------------- */
  function paintFeedback(q, rec, readonly) {
    const fb = $("#feedback");
    fb.classList.remove("hidden");
    let html = "";

    const cls = rec.score >= rec.marks ? "full" : (rec.score > 0 ? "part" : "zero");
    const verdict = rec.score >= rec.marks ? "Full marks" : (rec.score > 0 ? "Partial" : "No marks");
    html += `<div class="scoreline">
      <span class="scorebadge ${cls}">${round1(rec.score)}</span>
      <span class="scoreof">/ ${rec.marks}</span>
      <span class="verdict ${rec.score >= rec.marks ? "ok" : "no"}">${verdict}</span>
      ${rec.override ? '<span class="tag">Self-graded</span>' : ""}
    </div>`;

    if (rec.figOk) {
      Object.keys(rec.figOk).forEach(id => {
        const el = document.querySelector(`#qstem .figbox[data-boxid="${id}"], #qanswer .figbox[data-boxid="${id}"]`);
        if (el) el.classList.add(rec.figOk[id] ? "graded-ok" : "graded-miss");
      });
    }
    const figItems = [];
    Object.keys(rec.figBoxes || {}).forEach(L => (rec.figBoxes[L] || []).forEach(b => {
      if (String(b.value || "").trim()) figItems.push(`(${esc(L)}) ${esc(b.value)}`);
    }));
    const nStrokes = (rec.figStrokes || []).length;
    // Only show this block for genuine diagram questions with something on the
    // picture. Every parted OEQ record carries empty figBoxes/figStrokes keys.
    if (q.figAnswer && (figItems.length || nStrokes)) {
      const items = figItems.slice();
      if (nStrokes) items.push(`${nStrokes} drawing stroke${nStrokes > 1 ? "s" : ""} on the picture`);
      html += `<div class="kwblock"><div class="kwtitle">Your answer on the diagram</div><div class="kwchips">` +
        (items.length ? items.map(t => `<span class="kw hit"><span class="mark">✓</span><span class="txt">${t}</span></span>`).join("")
          : `<span class="muted">Nothing entered on the diagram</span>`) +
        `</div><p class="answerhint" style="margin-top:8px">Check where your labels and drawing sit against the model answer below; adjust your own score if needed.</p></div>`;
    }

    if (rec.type === "MCQ") {
      const right = q.options.find(o => String(o.label) === String(q.choice));
      html += `<p class="muted" style="margin:6px 0 0">Correct answer: <strong>(${esc(q.choice)})</strong>${right ? " " + esc(right.text) : ""} &nbsp;·&nbsp; Your choice: (${esc(rec.picked)})</p>`;
    }

    // keyword check
    if (rec.type === "OEQ") {
      if (!rec.auto) {
        html += `<div class="kwblock"><div class="kwtitle">Keyword check</div>
          <div class="kw manual"><span class="mark">?</span><span class="txt">This question has no machine-checkable keywords (open-ended phrasing). Compare with the model answer below and grade yourself.</span></div></div>`;
      } else {
        const res = rec.res || [];
        const hasParts = !!(rec.partRes || res.some(r => r.part));
        const drawSet = new Set((rec.drawParts || []).map(l => "(" + l + ")"));
        const tickSet = new Set(rec.tickParts || []);
        if (!hasParts) {
          const hits = res.filter(r => r.hit);
          const miss = res.filter(r => !r.hit);
          html += `<div class="kwblock"><div class="kwtitle">Keyword check · ${hits.length}/${res.length} matched</div><div class="kwchips">`;
          res.forEach(r => {
            html += `<div class="kw ${r.hit ? "hit" : "miss"}"><span class="mark">${r.hit ? "✓" : "✗"}</span>
              <span class="txt">${r.part ? `<span class="part">${esc(r.part)}</span>` : ""}${esc(r.span)}</span></div>`;
          });
          (rec.manual || []).forEach(r => {
            html += `<div class="kw manual"><span class="mark">?</span><span class="txt">${r.part ? `<span class="part">${esc(r.part)}</span>` : ""}${esc(r.span)} (needs manual check)</span></div>`;
          });
          html += `</div>`;
          if ((rec.manual || []).length >= res.length) {
            html += `<p class="answerhint" style="margin-top:8px">Most scoring points here need manual judgement — treat the automatic score as a guide and self-grade against the model answer.</p>`;
          }
          html += `</div>`;
          html += `<div class="twocol" style="margin-top:14px">
            <div class="panel"><h4>Scored on · ${hits.length}</h4>
              <div class="ansline">${hits.length ? hits.map(h => esc(h.span)).join("<br>") : '<span class="muted">None</span>'}</div></div>
            <div class="panel" style="background:#fdf7f6;border-color:#f3cfcd"><h4>Missed · ${miss.length}</h4>
              <div class="ansline">${miss.length ? miss.map(m => esc(m.span)).join("<br>") : '<span class="muted">Nothing missed — well done</span>'}</div></div>
          </div>`;
        } else {
          const groups = {};
          res.forEach(r => { const k = r.part || ""; (groups[k] = groups[k] || []).push(r); });
          html += `<div class="kwblock"><div class="kwtitle">Keyword check · ${res.filter(r => r.hit).length}/${res.length} matched</div>`;
          Object.keys(groups).forEach(k => {
            const items = groups[k];
            const isDraw = drawSet.has(k);
            html += `<div class="kwpart"><div class="kwparthead">${esc(k || "Whole question")}${isDraw ? ' <span class="tag drawtag">drawing — grade yourself</span>' : (tickSet.has(k) ? ' <span class="tag ticktag">tick boxes</span>' : '')}</div><div class="kwchips">`;
            items.forEach(r => {
              html += `<div class="kw ${r.manual ? "manual" : (r.hit ? "hit" : "miss")}"><span class="mark">${r.manual ? "?" : (r.hit ? "✓" : "✗")}</span><span class="txt">${esc(r.span)}</span></div>`;
            });
            html += `</div></div>`;
          });
          if (drawSet.size) {
            html += `<div class="drawreview">`;
            rec.drawParts.forEach(l => {
              const url = rec.canvases && rec.canvases[l];
              html += `<div class="drawrevitem"><div class="kwparthead">(${esc(l)}) Your drawing</div>${url ? `<img src="${url}" class="drawrevimg" alt="drawing ${l}">` : '<span class="muted">No drawing saved</span>'}</div>`;
            });
            html += `</div>`;
          }
          html += `</div>`;
        }
      }
    }

    if (rec.type === "SLOT") {
      const correct = rec.slotRes.filter(r => r.ok).length;
      const plan = rec.slotRes.map(r => r.mark || 0);
      // only spell out the split when the boxes are NOT worth the same
      const planTxt = (plan.length && new Set(plan).size > 1)
        ? ` · marks per box: ${plan.join(" + ")}` : "";
      html += `<div class="kwblock"><div class="kwtitle">Diagram boxes · ${correct}/${rec.slotRes.length} correct · ${round1(rec.slotScore)}/${rec.slotMarks} marks${planTxt}</div><div class="kwchips">`;
      rec.slotRes.forEach(r => {
        html += `<div class="kw ${r.ok ? "hit" : "miss"}"><span class="mark">${r.ok ? "✓" : "✗"}</span>
          <span class="txt">${r.label ? `<span class="part">${esc(r.label)}</span>` : ""}${esc(r.value || "(blank)")} → expected <b>${esc(r.expect)}</b> · worth ${r.mark} mark${r.mark === 1 ? "" : "s"}</span></div>`;
      });
      html += `</div></div>`;
      if (rec.textRes) {
        const hits = rec.textRes.filter(r => r.hit), miss = rec.textRes.filter(r => !r.hit);
        const txtParts = (q.extraText && q.extraText.length) ? q.extraText.map(t => t.part).filter(Boolean).join("") + " " : "";
        html += `<div class="kwblock"><div class="kwtitle">${txtParts}Written-answer keyword check · ${hits.length}/${rec.textRes.length} matched</div><div class="kwchips">`;
        rec.textRes.forEach(r => {
          html += `<div class="kw ${r.hit ? "hit" : "miss"}"><span class="mark">${r.hit ? "✓" : "✗"}</span><span class="txt">${r.part ? `<span class="part">${esc(r.part)}</span>` : ""}${esc(r.span)}</span></div>`;
        });
        html += `</div></div>`;
      }
      rec.slotRes.forEach(r => {
        const el = document.querySelector(`#qstem .slotbox[data-slot="${r.i}"], #qstem .dropzone[data-slot="${r.i}"]`);
        if (el) { el.classList.add(r.ok ? "graded-ok" : "graded-miss"); }
      });
      const dpl = document.getElementById("dragpool"); if (dpl) dpl.classList.add("locked");
      const qst = document.getElementById("qstem"); if (qst) qst.classList.add("locked");
      dragCarry = null;
    }

    if (rec.type === "LINE") {
      const ld = q.lineData;
      const correct = rec.lineRes.filter(r => r.ok).length;
      html += `<div class="kwblock"><div class="kwtitle">Diagram lines · ${correct}/${rec.lineRes.length} correct</div><div class="kwchips">`;
      rec.lineRes.forEach(r => {
        const left = ld.left[r.i];
        const right = r.rightId ? ld.right[parseInt(r.rightId.slice(1))] : null;
        const expLabels = r.expect.map(ri => ld.right[parseInt(ri.slice(1))].label).join(" / ");
        html += `<div class="kw ${r.ok ? "hit" : "miss"}"><span class="mark">${r.ok ? "✓" : "✗"}</span>`
          + `<span class="txt">${esc(left.label)}${right ? " → " + esc(right.label) : " → (no line drawn)"}`
          + `${r.ok ? "" : ` · expected ${esc(left.label)} → ${esc(expLabels)}`}</span></div>`;
      });
      html += `</div></div>`;
      if (rec.textRes) {
        const hits = rec.textRes.filter(r => r.hit), miss = rec.textRes.filter(r => !r.hit);
        const txtParts = (q.extraText && q.extraText.length) ? q.extraText.map(t => t.part).filter(Boolean).join("") + " " : "";
        html += `<div class="kwblock"><div class="kwtitle">${txtParts}Written-answer keyword check · ${hits.length}/${rec.textRes.length} matched</div><div class="kwchips">`;
        rec.textRes.forEach(r => {
          html += `<div class="kw ${r.hit ? "hit" : "miss"}"><span class="mark">${r.hit ? "✓" : "✗"}</span><span class="txt">${r.part ? `<span class="part">${esc(r.part)}</span>` : ""}${esc(r.span)}</span></div>`;
        });
        html += `</div></div>`;
      }
      const wrap = document.querySelector("#qstem .diagwrap");
      if (wrap) wrap.classList.add("locked");
      rec.lineRes.forEach(r => {
        if (r.rightId) {
          const aEl = document.querySelector(`#qstem .lnanchor[data-side="L"][data-i="${r.i}"]`);
          if (aEl) aEl.classList.add(r.ok ? "graded-ok" : "graded-miss");
        }
        const ln = document.querySelector(`#qstem .lnline[data-li="${r.i}"]`);
        if (ln) ln.classList.add(r.ok ? "graded-ok" : "graded-miss");
      });
    }

    if (rec.type === "TF") {
      const correct = rec.tfRes.filter(r => r.ok).length;
      html += `<div class="kwblock"><div class="kwtitle">True / False · ${correct}/${rec.tfRes.length} correct</div><div class="kwchips">`;
      rec.tfRes.forEach(r => {
        html += `<div class="kw ${r.ok ? "hit" : "miss"}"><span class="mark">${r.ok ? "✓" : "✗"}</span>`
          + `<span class="txt">${r.label ? `<span class="part">${esc(r.label)}</span>` : ""}${esc(r.text)} → you: <b>${esc(r.got || "—")}</b> (answer ${esc(r.expect)})</span></div>`;
      });
      html += `</div></div>`;
      rec.tfRes.forEach(r => {
        const row = document.querySelector(`#qstem .tfrow[data-tf="${r.i}"]`);
        if (row) {
          row.classList.add("graded");
          row.querySelectorAll(".tfbtn").forEach(b => {
            b.disabled = true;
            if (b.dataset.v === r.expect) b.classList.add("graded-ok");
            if (b.dataset.v === r.got && !r.ok) b.classList.add("graded-miss");
          });
        }
      });
    }

    // model answer / my answer
    const mineTxt = rec.type === "MCQ" ? "(" + rec.picked + ")"
      : rec.type === "SLOT"
        ? (rec.slotRes.map(r => (r.label ? r.label + ": " : "") + (r.value || "—")).join("; ")
            + (rec.textVal ? (" | " + (q.extraText && q.extraText[0] ? q.extraText[0].part + ": " : "") + rec.textVal) : ""))
        : rec.type === "LINE"
          ? (rec.lineRes.map(r => {
              const left = q.lineData.left[r.i];
              const right = r.rightId ? q.lineData.right[parseInt(r.rightId.slice(1))] : null;
              return esc(left.label) + " → " + (right ? esc(right.label) : "(none)");
            }).join("; ")
            + (rec.textVal ? (" | " + (q.extraText && q.extraText[0] ? q.extraText[0].part + ": " : "") + rec.textVal) : ""))
          : rec.type === "TF"
            ? rec.tfRes.map(r => (r.label ? r.label + ": " : "") + (r.got || "—") + " (ans " + r.expect + ")").join("; ")
            : (rec.parts
                ? Object.keys(rec.parts).sort().map(k => "(" + k + ") " + (rec.parts[k] || "—")).join("  ·  ")
                  + (rec.canvases && Object.keys(rec.canvases).length ? "  ·  [drawing saved]" : "")
                : (rec.text || ""));
    html += `<div class="twocol">
      <div class="panel official"><h4>Model answer (official)</h4><div class="ansline">${esc(q.answer || "—")}</div></div>
      <div class="panel mine"><h4>My answer</h4><div class="ansline">${esc(mineTxt || "—")}</div></div>
    </div>`;

    if (q.keypoints) {
      html += `<details class="keypoints"><summary>Full scoring keywords &amp; common pitfalls</summary><div class="kpbody">${esc(q.keypoints)}</div></details>`;
    }

    // self-grade
    if (!readonly) {
      html += `<div class="selfgrade">
        <div class="sgtitle">Score looks off? Grade it yourself against the model answer (syncs to the wrong-answer book)</div>
        <div class="sgbtns">
          <button class="sgbtn" data-sg="full">I got it right (${q.marks})</button>
          <button class="sgbtn" data-sg="half">Partly right (${round1(q.marks / 2)})</button>
          <button class="sgbtn" data-sg="zero">Actually wrong (0)</button>
        </div>
        <div class="sgnote">The machine only matches keywords — if your wording differs but the idea is right, adjust the score manually.</div>
      </div>`;
    }

    fb.innerHTML = html;

    if (!readonly) {
      $$("#feedback .sgbtn").forEach(b => b.addEventListener("click", () => {
        const v = b.dataset.sg;
        const val = v === "full" ? q.marks : (v === "half" ? Math.round(q.marks / 2 * 2) / 2 : 0);
        S.recs[q.id].score = val;
        S.recs[q.id].override = true;
        if (val >= q.marks) wbRemove(q.id, true); else wbAdd(S.recs[q.id]);
        $$("#feedback .sgbtn").forEach(x => x.classList.remove("on"));
        b.classList.add("on");
        updateLiveScore();
        const sb = fb.querySelector(".scorebadge");
        sb.className = "scorebadge " + (val >= q.marks ? "full" : (val > 0 ? "part" : "zero"));
        sb.textContent = round1(val);
        fb.querySelector(".verdict").textContent = val >= q.marks ? "Full marks" : (val > 0 ? "Partial" : "No marks");
        fb.querySelector(".verdict").className = "verdict " + (val >= q.marks ? "ok" : "no");
        flash(val >= q.marks ? "Removed from wrong-answer book" : "Score updated by self-grade");
      }));
    }
  }

  /* ---------------- wrong-answer book ---------------- */
  function wbAdd(rec) {
    const q = BY_ID.get(rec.id);
    if (!q) return;
    const cur = WB.items[rec.id];
    WB.items[rec.id] = {
      id: rec.id,
      score: rec.score,
      marks: rec.marks,
      ts: Date.now(),
      tries: (cur ? cur.tries : 0) + 1
    };
    save(LS_WRONG, WB);
    refreshBadges();
  }
  function wbRemove(id, silent) {
    delete WB.items[id];
    save(LS_WRONG, WB);
    refreshBadges();
    if (!silent) { renderWrong(); }
  }
  function refreshBadges() {
    const n = wbCount();
    const b = $("#wrongBadge");
    b.textContent = n;
    b.classList.toggle("zero", n === 0);
  }

  let wSel = new Set();

  function wrongItems() {
    return Object.values(WB.items).map(it => ({ it, q: BY_ID.get(it.id) })).filter(x => x.q);
  }

  function renderWrong() {
    const all = wrongItems();
    $("#wrongSummary").textContent = all.length
      ? `${all.length} question${all.length > 1 ? "s" : ""} · all from answers that missed full marks; scoring full marks on a redo removes them automatically.`
      : "No wrong answers yet.";

    // filter dropdowns
    const schools = Array.from(new Set(all.map(x => x.q.schoolShort))).sort();
    const topics = Array.from(new Set(all.map(x => x.q.topic + " / " + x.q.subtopic))).sort();
    const curS = $("#wSchool").value, curT = $("#wTopic").value;
    $("#wSchool").innerHTML = `<option value="">All schools</option>` + schools.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
    $("#wTopic").innerHTML = `<option value="">All topics</option>` + topics.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
    $("#wSchool").value = curS; $("#wTopic").value = curT;

    let list = all.filter(x =>
      (!$("#wSchool").value || x.q.schoolShort === $("#wSchool").value) &&
      (!$("#wTopic").value || (x.q.topic + " / " + x.q.subtopic) === $("#wTopic").value)
    );
    const sort = $("#wSort").value;
    list.sort((a, b) => sort === "oldest" ? a.it.ts - b.it.ts
      : sort === "score" ? (b.it.marks - b.it.score) - (a.it.marks - a.it.score)
      : b.it.ts - a.it.ts);

    $("#wrongEmpty").classList.toggle("hidden", all.length > 0);
    $("#wrongList").innerHTML = list.map(({ it, q }) => {
      const lost = round1(it.marks - it.score);
      const snippet = q.stem.replace(/<img[^>]*>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
      return `<div class="wrow ${wSel.has(q.id) ? "sel" : ""}" data-id="${esc(q.id)}">
        <input type="checkbox" class="chk" ${wSel.has(q.id) ? "checked" : ""}>
        <div class="wmain">
          <div class="wtop">
            <span class="wsrc">${esc(q.schoolShort)} · ${esc(q.year)} ${esc(q.paper)} · ${esc(q.qno)}</span>
            <span class="tag topic">${esc(q.subtopic)}</span>
            <span class="tag">${q.type === "MCQ" ? "MCQ" : "Open-ended"} · ${q.marks}</span>
            <span class="tag">Redone ${it.tries}×</span>
          </div>
          <div class="wstem">${esc(snippet)}…</div>
        </div>
        <div class="wside">
          <div class="wscore">Lost ${lost} <span>/ ${it.marks}</span></div>
          <div class="wacts">
            <button class="btn sm" data-act="redo">Redo</button>
            <button class="btn sm" data-act="print">Print</button>
            <button class="btn sm ghost" data-act="del">Remove</button>
          </div>
        </div>
      </div>`;
    }).join("");

    $$("#wrongList .wrow").forEach(row => {
      const id = row.dataset.id;
      row.querySelector(".chk").addEventListener("change", e => {
        e.target.checked ? wSel.add(id) : wSel.delete(id);
        row.classList.toggle("sel", e.target.checked);
        updateSelInfo();
      });
      row.querySelector('[data-act="redo"]').addEventListener("click", () => startSession([id], "Wrong-answer redo"));
      row.querySelector('[data-act="print"]').addEventListener("click", () => openPrint([id]));
      row.querySelector('[data-act="del"]').addEventListener("click", () => { wSel.delete(id); wbRemove(id); });
    });
    updateSelInfo();
  }

  function updateSelInfo() {
    const n = wSel.size;
    $("#wSelInfo").textContent = n ? `${n} selected` : "Nothing selected";
    $("#wRedo").disabled = !n;
    $("#wPrint").disabled = !n;
    $("#wRemove").disabled = !n;
  }

  /* ---------------- export / import wrong book (cross-device, free) ---------------- */
  function exportWrongBook() {
    const payload = {
      app: "p3qb",
      version: 1,
      exportedAt: new Date().toISOString(),
      wrong: WB,
      stats: STATS
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date(), p = n => String(n).padStart(2, "0");
    a.href = url;
    a.download = `p3qb-wrongbook-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    flash("错题集已导出为 JSON 文件 — 在另一台设备点 Import 读回即可");
  }

  function importWrongBook(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try { data = JSON.parse(reader.result); }
      catch (e) { alert("文件不是有效的错题集 JSON。"); return; }
      if (!data || data.app !== "p3qb" || !data.wrong || !data.wrong.items) {
        alert("这不是本题库导出的错题集文件。"); return;
      }
      const inc = data.wrong.items || {};
      let added = 0, updated = 0;
      for (const id in inc) {
        const it = inc[id];
        const cur = WB.items[id];
        if (!cur) { WB.items[id] = it; added++; }
        else if ((it.ts || 0) > (cur.ts || 0) ||
                ((it.ts || 0) === (cur.ts || 0) && (it.tries || 0) > (cur.tries || 0))) {
          WB.items[id] = it; updated++;
        }
      }
      if (data.stats && typeof data.stats === "object") {
        STATS.done = Math.max(STATS.done || 0, data.stats.done || 0);
        STATS.score = Math.max(STATS.score || 0, data.stats.score || 0);
        STATS.marks = Math.max(STATS.marks || 0, data.stats.marks || 0);
      }
      save(LS_WRONG, WB); save(LS_STATS, STATS);
      refreshBadges(); renderWrong();
      flash(`错题集已导入：新增 ${added}，更新 ${updated}`);
    };
    reader.readAsText(file);
  }

  /* ---------------- round results ---------------- */
  function finish() {
    const recs = S.ids.map(id => S.recs[id]).filter(Boolean);
    const got = recs.reduce((a, r) => a + r.score, 0);
    const tot = recs.reduce((a, r) => a + r.marks, 0);
    $("#resScore").textContent = round1(got);
    $("#resTotal").textContent = "/" + round1(tot);
    const rate = tot ? Math.round(got / tot * 100) : 0;
    $("#resRate").textContent = `Score rate ${rate}%`;
    const wrongN = recs.filter(r => r.score < r.marks).length;
    $("#resNote").textContent = wrongN ? `${wrongN} question${wrongN > 1 ? "s" : ""} missed full marks and were added to the wrong-answer book.` : "Full marks on everything — brilliant!";

    $("#resList").innerHTML = S.ids.map(id => {
      const q = BY_ID.get(id), r = S.recs[id];
      if (!q || !r) return "";
      const cls = r.score >= r.marks ? "ok" : (r.score > 0 ? "part" : "no");
      return `<div class="resrow">
        <span class="idx">${S.ids.indexOf(id) + 1}</span>
        <span class="src">${esc(q.schoolShort)} · ${esc(q.year)} ${esc(q.paper)} · ${esc(q.qno)}</span>
        <span class="tp">${esc(q.subtopic)}</span>
        <span class="sc ${cls}">${round1(r.score)} / ${r.marks}</span>
      </div>`;
    }).join("");

    $("#printRound").disabled = wrongN === 0;
    refreshHomeStats();
    show("result");
  }

  /* ---------------- print ---------------- */
  let printIds = [];
  function openPrint(ids) {
    printIds = ids.filter(id => BY_ID.get(id));
    if (!printIds.length) return;
    $("#printModal").classList.remove("hidden");
  }

  function buildPrint(ids, opt) {
    const items = ids.map(id => BY_ID.get(id)).filter(Boolean);
    const today = new Date();
    const dstr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    let html = `<div class="psheet">
      <h2>P3 Science · Practice Worksheet</h2>
      <div class="pmeta">${items.length} questions · Generated ${dstr} · Name ____________ &nbsp; Date ____________ &nbsp; Score ______ / ${items.reduce((a, q) => a + q.marks, 0)}</div>
    </div>`;

    items.forEach((q, i) => {
      html += `<div class="pq">
        <div class="phead">
          <span>${opt.source ? `${esc(q.schoolShort)} · ${esc(q.year)} ${esc(q.paper)} · ${esc(q.qno)} · ${esc(q.subtopic)}` : "Question " + (i + 1)}</span>
          <span>[${q.marks} mark${q.marks > 1 ? "s" : ""}]</span>
        </div>
        <div class="pstem">${q.stem}</div>`;
      if (q.options.length >= 2) {
        html += `<div class="popt">${q.options.map(o => `(${esc(o.label)}) ${esc(o.text)}`).join(" &nbsp;&nbsp; ")}</div>`;
      }
      if (opt.blank) {
        const lines = q.type === "MCQ" ? 0 : Math.max(2, Math.ceil(q.marks * 2));
        for (let k = 0; k < lines; k++) html += `<div class="pline"></div>`;
      }
      html += `</div>`;
    });

    if (opt.answer) {
      html += `<div class="pkey"><h2 style="font-size:13pt">Answers &amp; Scoring Keywords</h2>`;
      items.forEach((q, i) => {
        html += `<div class="pkitem"><b>${i + 1}. ${esc(q.schoolShort)} ${esc(q.qno)} (${q.marks})</b><br>
          Model answer: ${esc(q.answer || "—")}<br>
          <span style="color:#555">Scoring keywords: ${esc((q.keypoints || "—").replace(/\n/g, " ").slice(0, 380))}</span></div>`;
      });
      html += `</div>`;
    }

    $("#printArea").innerHTML = html;
    const imgs = Array.from($("#printArea").querySelectorAll("img"));
    let pending = imgs.filter(im => !im.complete).length;
    const go = () => window.print();
    if (!pending) { setTimeout(go, 60); return; }
    const timer = setTimeout(go, 2500);           // safety: never wait longer than 2.5 s
    imgs.forEach(im => {
      if (im.complete) return;
      const done = () => { if (--pending <= 0) { clearTimeout(timer); setTimeout(go, 60); } };
      im.addEventListener("load", done, { once: true });
      im.addEventListener("error", done, { once: true });
    });
  }

  /* ---------------- event binding ---------------- */
  function bind() {
    // drag-and-drop slot interactions (event delegation; handlers guard on drag mode)
    document.addEventListener("dragstart", onDragStart);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDragDrop);
    document.addEventListener("dragleave", onDragLeave);
    document.addEventListener("click", onDragClick);
    document.addEventListener("click", e => {
      const g = e.target.closest("[data-go]");
      if (g) {
        const v = g.dataset.go;
        if (v === "wrong") renderWrong();
        if (v === "home") refreshHomeStats();
        show(v);
      }
      const c = e.target.closest(".chip");
      if (c && c.dataset.f) {
        const f = c.dataset.f, v = c.dataset.v;
        if (F[f].has(v)) { F[f].delete(v); c.classList.remove("on"); }
        else { F[f].add(v); c.classList.add("on"); }
        refreshMatch();
      }
    });

    $("#schoolAll").addEventListener("click", () => {
      $$('#fSchool .chip').forEach(c => { F.schools.add(c.dataset.v); c.classList.add("on"); });
      refreshMatch();
    });
    $("#schoolNone").addEventListener("click", () => {
      $$('#fSchool .chip').forEach(c => c.classList.remove("on"));
      F.schools.clear(); refreshMatch();
    });

    $("#startBtn").addEventListener("click", () => {
      const p = pool();
      if (!p.length) return;
      const n = parseInt($("#countSel").value, 10);
      const picked = shuffle(p).slice(0, n === 0 ? p.length : n);
      startSession(picked.map(q => q.id), "Practice");
    });

    $("#quitBtn").addEventListener("click", () => {
      const done = Object.keys(S.recs).length;
      if (done && !confirm("Exit this round? Answered questions that missed full marks are already saved to the wrong-answer book.")) return;
      show("home");
    });

    $("#againWrong").addEventListener("click", () => {
      const ids = S.ids.filter(id => { const r = S.recs[id]; return r && r.score < r.marks; });
      if (ids.length) startSession(ids, "Wrong-answer redo");
    });
    $("#printRound").addEventListener("click", () => {
      const ids = S.ids.filter(id => { const r = S.recs[id]; return r && r.score < r.marks; });
      openPrint(ids);
    });

    $("#wAll").addEventListener("change", e => {
      const rows = $$("#wrongList .wrow");
      if (e.target.checked) rows.forEach(r => { wSel.add(r.dataset.id); r.classList.add("sel"); r.querySelector(".chk").checked = true; });
      else rows.forEach(r => { wSel.delete(r.dataset.id); r.classList.remove("sel"); r.querySelector(".chk").checked = false; });
      updateSelInfo();
    });
    $("#wRedo").addEventListener("click", () => { if (wSel.size) startSession(Array.from(wSel), "Wrong-answer redo"); });
    $("#wPrint").addEventListener("click", () => openPrint(Array.from(wSel)));
    $("#wRemove").addEventListener("click", () => {
      if (!wSel.size) return;
      if (!confirm(`Remove the ${wSel.size} selected question${wSel.size > 1 ? "s" : ""} from the wrong-answer book?`)) return;
      Array.from(wSel).forEach(id => { delete WB.items[id]; });
      save(LS_WRONG, WB); wSel.clear(); refreshBadges(); renderWrong();
    });

    $("#wbExport").addEventListener("click", exportWrongBook);
    $("#wbImport").addEventListener("click", () => $("#wbImportFile").click());
    $("#wbImportFile").addEventListener("change", e => {
      const f = e.target.files && e.target.files[0];
      if (f) importWrongBook(f);
      e.target.value = "";
    });
    ["wSchool", "wTopic", "wSort"].forEach(id => $("#" + id).addEventListener("change", renderWrong));

    $("#printCancel").addEventListener("click", () => $("#printModal").classList.add("hidden"));
    $("#printGo").addEventListener("click", () => {
      $("#printModal").classList.add("hidden");
      buildPrint(printIds, {
        answer: $("#optAnswer").checked,
        source: $("#optSource").checked,
        blank: $("#optBlank").checked
      });
    });

    // keyboard: 1-4 pick option, Enter submit / next
    document.addEventListener("keydown", e => {
      if ($("#view-quiz").classList.contains("hidden")) return;
      if (e.target.tagName === "TEXTAREA" && e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
        return; // newline inside textarea
      }
      if (/^[1-4]$/.test(e.key)) {
        const b = document.querySelector(`#qanswer .optbtn[data-opt="${e.key}"]`);
        if (b && !S.recs[BY_ID.get(S.ids[S.i]).id]) b.click();
      }
      if (e.key === "Enter" && !e.shiftKey) {
        if (S.recs[BY_ID.get(S.ids[S.i]).id]) {
          const n = $("#nextBtn") || $("#finishBtn");
          if (n) { e.preventDefault(); n.click(); }
        } else {
          const s = $("#submitBtn");
          if (s) { e.preventDefault(); s.click(); }
        }
      }
    });
  }

  function refreshHomeStats() {
    $("#stWrong").textContent = wbCount();
    $("#stDone").textContent = STATS.done || 0;
  }

  /* ---------------- boot ---------------- */
  function boot() {
    buildFilters();
    bind();
    refreshMatch();
    refreshBadges();
    $("#stTotal").textContent = QB.length;
    $("#stPapers").textContent = new Set(QB.map(q => q.school + q.year + q.paper)).size;
    $("#stWrong").textContent = wbCount();
    $("#stDone").textContent = STATS.done || 0;
    $("#brandSub").textContent = `${META.years ? META.years.join(" · ") : "2025"} · ${new Set(QB.map(q => q.school)).size} schools · ${QB.length} questions`;
    renderWrong();
    window.QB_APP = {
      startSession, renderQ, submit, BY_ID,
      goToQuestion: (id) => { startSession([id], id); renderQ(); }
    };
  }
  boot();
})();
