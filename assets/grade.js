/* ===== keyword grading (independently testable) ===== */
(function (root) {
  "use strict";

  // synonym clusters: different wording still counts
  const SYN = {
    air: ["air", "oxygen"], oxygen: ["air", "oxygen"],
    water: ["water", "moisture", "wet", "damp"], moisture: ["water", "moisture"],
    heat: ["heat", "warmth", "warm", "hot", "temperature"], warmth: ["heat", "warmth"], temperature: ["heat", "warmth", "temperature"],
    light: ["light", "sunlight", "sunshine"], sunlight: ["light", "sunlight"],
    food: ["food", "nutrient", "energy"], nutrient: ["food", "nutrient"],
    grow: ["grow", "growth", "grew"], growth: ["grow", "growth"],
    survive: ["survive", "survival"], survival: ["survive", "survival"],
    die: ["die", "dead", "death"], dead: ["die", "dead"], death: ["die", "dead"],
    move: ["move", "movement", "moving"], movement: ["move", "movement"],
    reproduce: ["reproduce", "reproduction", "breed", "offspring"], reproduction: ["reproduce", "reproduction"],
    attract: ["attract", "attraction", "attracted"], repel: ["repel", "repulsion", "repelled"],
    float: ["float", "floats"], sink: ["sink", "sinks"],
    absorb: ["absorb", "absorbent", "absorbency"], waterproof: ["waterproof", "water"],
    flex: ["flex", "flexible", "flexibility", "bend"], strong: ["strong", "strength"],
    transparent: ["transparent", "transparency", "see", "through"], opaque: ["opaque", "block"],
    thru: ["through"], through: ["through", "thru"]
  };

  function normWord(w) {
    w = String(w || "").toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
    if (!w) return "";
    return w.replace(/(ations|ation|ments|ment|ings|ing|ies|ied|es|ed|s)$/, "");
  }

  function expand(token) {
    const n = normWord(token);
    if (!n) return [];
    const out = new Set([n]);
    (SYN[n] || []).forEach(x => out.add(normWord(x)));
    return Array.from(out);
  }

  function answerWords(text) {
    const raw = String(text || "").toLowerCase().match(/[a-z][a-z\-']*|\d+(?:\.\d+)?/g) || [];
    const set = new Set();
    raw.forEach(w => { const n = normWord(w); if (n) set.add(n); });
    return set;
  }

  // token hit: exact match / synonym cluster / same first 5 letters (reproduce / reproduction)
  function tokenHit(t, set) {
    const variants = expand(t);
    if (!variants.length) return false;
    for (const v of variants) {
      if (set.has(v)) return true;
      if (v.length >= 5) {
        for (const w of set) {
          if (w.length >= 5 && v.slice(0, 5) === w.slice(0, 5)) return true;
        }
      }
    }
    return false;
  }

  function altHit(tokens, set) {
    if (!tokens || !tokens.length) return false;
    const hits = tokens.filter(t => tokenHit(t, set)).length;
    // long keywords may miss one token (students often paraphrase)
    const need = tokens.length >= 3 ? tokens.length - 1 : tokens.length;
    return hits >= need;
  }

  /* ---------------- mark arithmetic ---------------- */
  // Singapore primary marking uses whole or half marks only.
  const roundHalf = n => Math.round((Number(n) || 0) * 2) / 2;

  // Spread `total` marks over `n` answer items so that every item carries a
  // legal 0.5-step value and the sum is preserved exactly.
  // This is needed whenever the item count does not divide the marks
  // (e.g. 4 diagram boxes for 3 marks -> 1 + 1 + 0.5 + 0.5, never 0.75 each).
  // `explicit` is an optional hand-set scheme (must sum to `total`).
  function allocateMarks(total, n, explicit) {
    const count = Math.max(0, Math.round(Number(n) || 0));
    if (!count) return [];
    const t = Math.max(0, Number(total) || 0);
    if (Array.isArray(explicit) && explicit.length === count) {
      const nums = explicit.map(x => Math.max(0, Number(x) || 0));
      const sum = nums.reduce((a, b) => a + b, 0);
      if (Math.abs(sum - t) < 0.001) return nums;
    }
    let units = Math.round(t * 2);            // work in half-mark units
    const base = Math.floor(units / count);
    const rem = units - base * count;
    const out = new Array(count).fill(base);
    for (let i = 0; i < rem; i++) out[i] += 1;  // leftover half-marks to the leading items
    return out.map(u => u / 2);
  }

  /* Some bank entries accidentally turned a mark-scheme note into a scoring
     checkpoint ("0.5 mark for each part", "usually 0.5 mark each"). It looks
     like a keyword but can never be written by a pupil, so answering every
     real part correctly still loses marks. Never score those rows. */
  function isMarkNote(c) {
    const s = String((c && c.span) || "");
    if (s.length > 60) return false;
    const flat = ((c && c.alts) || []).reduce((a, x) => a.concat(x || []), []);
    if (!flat.length || !flat.every(t => /^\d+(?:\.\d+)?$/.test(String(t)))) return false;
    return /(?:\d+(?:\.\d+)?|½)\s*marks?\s+(?:for\s+)?(?:each|per)\b/i.test(s);
  }

  function gradeOEQ(q, text) {
    const set = answerWords(text);
    const real = (q.checkpoints || []).filter(c => !isMarkNote(c));
    const auto = real.filter(c => !c.manual);
    const manual = real.filter(c => c.manual);
    const res = auto.map(c => ({
      part: c.part || "",
      span: c.span,
      hit: (c.alts || []).some(alt => altHit(alt, set))
    }));
    const total = res.length;
    const hits = res.filter(r => r.hit).length;
    let score = 0;
    if (total) score = hits === total ? q.marks : roundHalf(q.marks * hits / total);
    return { score: Math.min(score, q.marks), res, manual, auto: total > 0, hits, total };
  }

  /* ---------------- on-diagram answer boxes (slots) ---------------- */
  // A slot holds a short answer written directly onto the diagram.
  // mode "letters": compare the SET of expected letters (e.g. "D, F").
  // mode "text":    compare against acceptable answers, leniently.
  function gradeSlot(slot, value) {
    const v = String(value == null ? "" : value).trim();
    if (!v) return false;
    if (slot.mode === "letters") {
      const got = new Set((v.toUpperCase().match(/[A-Z]/g) || []));
      const exp = new Set((String(slot.expect || "").toUpperCase().match(/[A-Z]/g) || []));
      if (got.size !== exp.size || exp.size === 0) return false;
      for (const c of exp) if (!got.has(c)) return false;
      return true;
    }
    const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const got = norm(v);
    if (!got) return false;
    const acc = (Array.isArray(slot.accept) && slot.accept.length ? slot.accept : [slot.expect])
      .map(x => norm(x));
    return acc.some(a => got === a || (a && (a.indexOf(got) >= 0 || got.indexOf(a) >= 0)));
  }

  // Per-box mark plan. A hand-set scheme may be given either as
  // q.slotWeights = [..] or as a "mark" on each slot object.
  function slotMarkPlan(q, slots, slotMarks) {
    const n = slots.length;
    if (!n) return [];
    if (Array.isArray(q.slotWeights) && q.slotWeights.length === n) {
      return allocateMarks(slotMarks, n, q.slotWeights);
    }
    if (slots.some(s => typeof s.mark === "number")) {
      const arr = slots.map(s => (typeof s.mark === "number" ? s.mark : 0));
      return allocateMarks(slotMarks, n, arr);
    }
    return allocateMarks(slotMarks, n);
  }

  function gradeSlots(q, vals) {
    const slots = q.slots || [];
    const slotMarks = (typeof q.slotMarks === "number") ? q.slotMarks : q.marks;
    // marks are allocated so each box carries a legal 0.5-step value
    // (4 boxes for 3 marks -> 1 + 1 + 0.5 + 0.5, never 0.75 each)
    const plan = slotMarkPlan(q, slots, slotMarks);
    const slotRes = slots.map((s, i) => {
      const ok = gradeSlot(s, vals[i]);
      return {
        i, label: s.label || "", value: vals[i] || "", expect: s.expect || "",
        mode: s.mode, ok, mark: plan[i] || 0
      };
    });
    const slotScore = roundHalf(slotRes.reduce((a, r) => a + (r.ok ? r.mark : 0), 0));
    return {
      slotRes, slotScore, slotMarks, weights: plan,
      weight: slots.length ? Math.round((slotMarks / slots.length) * 100) / 100 : 0
    };
  }

  /* ---------------- on-diagram line-matching ---------------- */
  // Student draws lines joining left-column anchors to right-column anchors.
  // edges: array of [leftId, rightId], leftId like "L0", rightId like "R3".
  // A left anchor is "correct" when it is joined to one of its expected rights.
  function gradeLines(q, edges) {
    const ld = q.lineData || {};
    const left = ld.left || [];
    const right = ld.right || [];
    const total = left.length;
    const lineMarks = (typeof ld.marks === "number") ? ld.marks : q.marks;
    const pairSet = new Set((ld.pairs || []).map(p => p[0] + "-" + p[1]));
    const plan = allocateMarks(lineMarks, total);

    const norm = (e) => {
      if (!e || e.length !== 2) return null;
      let a = e[0], b = e[1];
      if (a[0] === "R") { const t = a; a = b; b = t; }
      if (a[0] !== "L") return null;
      return [a, b];
    };
    const valid = (edges || []).map(norm).filter(Boolean);

    const perLeft = [];
    let correct = 0;
    for (let i = 0; i < total; i++) {
      const L = "L" + i;
      const expectR = (ld.pairs || []).filter(p => p[0] === L).map(p => p[1]);
      const mine = valid.filter(e => e[0] === L).map(e => e[1]);
      // an object counts as correct when it is joined to one of its expected
      // rights (normally there is only ever ONE line per left object)
      const hit = mine.find(r => expectR.indexOf(r) >= 0);
      const ok = !!hit;
      const rightId = ok ? hit : (mine.length ? mine[0] : null);
      if (ok) correct++;
      perLeft.push({ i, ok, rightId, expect: expectR, mark: plan[i] || 0 });
    }
    const weight = total ? lineMarks / total : 0;
    const lineScore = roundHalf(perLeft.reduce((a, r) => a + (r.ok ? r.mark : 0), 0));
    return {
      lineRes: perLeft, lineScore, lineMarks, correct, total,
      pairSet, weights: plan, weight: Math.round(weight * 100) / 100, edges: valid
    };
  }

  /* ---------------- True / False questions ---------------- */
  // Each statement in q.tf carries its own correct answer ("T"/"F").
  // 1 mark per correct statement (weight = tfMarks / count).
  function gradeTF(q, vals) {
    const tf = q.tf || [];
    const tfMarks = (typeof q.tfMarks === "number") ? q.tfMarks : q.marks;
    const weight = tf.length ? tfMarks / tf.length : 0;
    const plan = allocateMarks(tfMarks, tf.length);
    const norm = v => {
      let g = String(v == null ? "" : v).trim().toUpperCase();
      if (g === "TRUE") g = "T";
      if (g === "FALSE") g = "F";
      return g;
    };
    const tfRes = tf.map((s, i) => {
      const got = norm(vals[i]);
      const expect = String(s.answer || "").trim().toUpperCase();
      const ok = got === expect;
      return { i, label: s.label || "", text: s.text || "", got, expect, ok, mark: plan[i] || 0 };
    });
    const correct = tfRes.filter(r => r.ok).length;
    const tfScore = roundHalf(tfRes.reduce((a, r) => a + (r.ok ? r.mark : 0), 0));
    return { tfRes, tfScore, tfMarks, correct, total: tf.length, weights: plan, weight: Math.round(weight * 100) / 100 };
  }

  root.QBGrade = { answerWords, tokenHit, altHit, gradeOEQ, isMarkNote, normWord, gradeSlot, gradeSlots, gradeLines, gradeTF, allocateMarks, roundHalf };
})(typeof window !== "undefined" ? window : global);
