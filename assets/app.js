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
    const stemTables = Array.from(document.querySelectorAll("#qstem table"));
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
    document.querySelectorAll("#qstem input.tickinput").forEach(inp => {
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

  function getQuestionParts(q) {
    if (Array.isArray(q.parts) && q.parts.length) return q.parts;
    const stem = q.stem || "";
    const re = /\(?([a-z])\)/g; let m; const idx = [];
    while ((m = re.exec(stem))) {
      const pre = m.index > 0 ? stem[m.index - 1] : " ";
      if (/[a-z0-9]/i.test(pre)) continue;          // skip things like "e.g.)"
      idx.push([m[1], m.index]);
    }
    if (idx.length < 2) return null;                // single-part -> keep one box
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
    return segs.map((s, k) => {
      const unit = (s.text.match(/_{2,}\s*([A-Za-z%°\u00b0]+)/) || [])[1] || "";
      const hint = s.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      return { label: "(" + s.letter + ")", letter: s.letter, type: types[k], marks: plan[k] || 0, unit, hint: hint.slice(0, 150) };
    });
  }

  // Grade each sub-part against its own checkpoints (matched by the "(a)" part
  // tag). Drawing parts carry no auto keywords (graded by the student). Questions
  // whose checkpoints are not part-tagged fall back to the legacy whole-text grade.
  function gradeParts(q, parts, textByPart, tickByPart) {
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

  function initCanvas(cv) {
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

  function renderPartedOEQ(q, parts, rec) {
    const isRec = !!(rec && rec.type === "OEQ" && rec.parts);
    oeqState = { parts: {}, canvases: {}, ticks: {} };
    const box = $("#qanswer");
    let html = `<div class="partsanswers">`;
    parts.forEach(p => {
      html += `<div class="partans" data-part="${p.letter}">`;
      if (p.label) html += `<div class="partlabel">${esc(p.label)} ${p.marks ? `<span class="pmark">${p.marks} mark${p.marks > 1 ? "s" : ""}</span>` : ""}</div>`;
      if (p.hint) html += `<div class="parthint">${esc(p.hint.slice(0, 160))}</div>`;
      if (p.type === "tick") {
        html += `<div class="tickhint">Tick the boxes in the table above — no written answer needed here.</div>`;
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
      html += `</div>`;
    });
    html += `</div>`;
    const hasTicks = parts.some(p => p.type === "tick");
    html += `<div class="structhint"><span>${hasTicks ? "Tick the boxes above" : "One box per (a)(b)(c)"}</span><span>Hit the keywords</span><span>Submit</span></div>`;
    html += `<p class="answerhint">${hasTicks ? "Tick the correct boxes in the question table, and write answers only for the other sub-questions. Ticked boxes are graded automatically." : "Each sub-question has its own answer space. Drawing parts are graded by you afterwards; the rest are checked against the scoring keywords."}</p>`;
    box.innerHTML = html;
    if (hasTicks) injectTickInputs(q, parts, isRec ? rec : null);

    parts.forEach(p => {
      const el = box.querySelector(`.ans[data-part="${p.letter}"]`);
      if (isRec && el) { el.value = rec.parts[p.letter] || ""; el.setAttribute("readonly", ""); }
      if (p.type === "draw") {
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
    const _lk = document.getElementById("qstem"); if (_lk) _lk.classList.remove("locked");
    const _dp = document.getElementById("dragpool"); if (_dp) _dp.classList.remove("locked");
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
    $("#qstem").innerHTML = stem;

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
      const parts = getQuestionParts(q);
      if (parts && (parts.length >= 2 || parts.some(p => p.type === "tick"))) {
        renderPartedOEQ(q, parts, rec);
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
        if (parts && (parts.length >= 2 || parts.some(p => p.type === "tick"))) {
          rec = { id: q.id, type: "OEQ", parts: {}, canvases: {}, ticks: {}, tickOk: {}, partRes: null,
            tickParts: parts.filter(p => p.type === "tick").map(p => p.label),
            score: 0, marks: q.marks, ok: false, ts: Date.now(), gaveUp: true,
            res: (q.checkpoints || []).map(c => ({ part: c.part || "", span: c.span, hit: false, manual: !!c.manual })),
            manual: (q.checkpoints || []).filter(c => c.manual), auto: false };
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
      if (parts && (parts.length >= 2 || parts.some(p => p.type === "tick"))) {
        oeqState.parts = {}; oeqState.canvases = {}; oeqState.ticks = {};
        parts.forEach(p => {
          const el = document.querySelector(`#qanswer .ans[data-part="${p.letter}"]`);
          oeqState.parts[p.letter] = el ? el.value : "";
          if (p.type === "draw") {
            const cv = document.querySelector(`#qanswer canvas[data-part="${p.letter}"]`);
            if (cv && cv.toDataURL && typeof cv.toDataURL === "function") {
              try { oeqState.canvases[p.letter] = cv.toDataURL(); } catch (e) {}
            }
          }
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
          || Object.values(oeqState.ticks).some(t => Object.keys(t).length > 0);
        if (!anyFilled) { flash('Answer at least one sub-question (or click "Don\'t know — show answer")'); return; }
        const g = gradeParts(q, parts, oeqState.parts, oeqState.ticks);
        rec = {
          id: q.id, type: "OEQ", parts: oeqState.parts, canvases: oeqState.canvases,
          ticks: oeqState.ticks, tickOk: g.tickOk || {},
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
