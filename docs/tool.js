// exam.net Anonymisierer
// Two modes, same logic:
//   - Bookmarklet on exam.net: overlay, reads classes/exams/submissions with the teacher's session.
//   - Install page (index.html): manual upload of .docx/.txt/.md/.zip files.
// Everything runs in the browser; no data leaves it. See PLAN.md / CLAUDE.md.
(() => {
  "use strict";

  const ON_EXAMNET = /(^|\.)exam\.net$/.test(location.hostname);
  const MOUNT = document.getElementById("anon-app");
  if (!ON_EXAMNET && !MOUNT) {
    alert("Bitte zuerst exam.net öffnen und dort eingeloggt sein.");
    return;
  }
  if (ON_EXAMNET && document.getElementById("exam-anon-host")) {
    document.getElementById("exam-anon-host").style.display = "block";
    return;
  }

  // ---------- Config ----------
  const FETCH_TIMEOUT_MS = 30000;
  const TINY_WORDS = 20; // submissions shorter than this are deselected by default
  const COLORS = ["Rot", "Blau", "Grün", "Gelb", "Grau", "Braun", "Schwarz", "Weiss", "Golden",
    "Silbern", "Violett", "Türkis", "Pink"];
  // Neutral animals only (nothing usable as an insult). g = grammatical gender for the adjective ending.
  const ANIMALS = [
    ["Fuchs", "m"], ["Elefant", "m"], ["Adler", "m"], ["Biber", "m"], ["Dachs", "m"], ["Delfin", "m"],
    ["Falke", "m"], ["Igel", "m"], ["Luchs", "m"], ["Otter", "m"], ["Panda", "m"], ["Pinguin", "m"],
    ["Rabe", "m"], ["Tiger", "m"], ["Wal", "m"], ["Wolf", "m"], ["Bär", "m"], ["Hirsch", "m"],
    ["Kranich", "m"], ["Löwe", "m"], ["Specht", "m"], ["Steinbock", "m"], ["Uhu", "m"], ["Gepard", "m"],
    ["Jaguar", "m"], ["Koala", "m"], ["Leopard", "m"], ["Papagei", "m"], ["Reiher", "m"], ["Storch", "m"],
    ["Kolibri", "m"], ["Flamingo", "m"], ["Seehund", "m"], ["Eule", "f"], ["Giraffe", "f"], ["Möwe", "f"],
    ["Robbe", "f"], ["Schildkröte", "f"], ["Libelle", "f"], ["Antilope", "f"], ["Gazelle", "f"],
    ["Katze", "f"], ["Hummel", "f"], ["Amsel", "f"], ["Lerche", "f"], ["Pferd", "n"], ["Zebra", "n"],
    ["Eichhörnchen", "n"], ["Murmeltier", "n"], ["Nashorn", "n"], ["Chamäleon", "n"], ["Lama", "n"],
    ["Känguru", "n"], ["Reh", "n"], ["Wiesel", "n"],
  ];
  const ENDING = { m: "er", f: "e", n: "es" };

  // ---------- Small helpers ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const today = () => new Date().toISOString().slice(0, 10);
  const safeFile = (s) => String(s).replace(/[\/\\:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Ohne Titel";
  const normName = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
  const looseName = (s) => normName(s).replace(/[0-9]+/g, " ").replace(/\s+/g, " ").trim();
  const wordCount = (t) => t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

  function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  function htmlToText(html) {
    const h = String(html || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|blockquote|tr|pre)>/gi, "\n\n")
      .replace(/<li[^>]*>/gi, "- ");
    const t = new DOMParser().parseFromString(h, "text/html").body.textContent || "";
    return t.replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  // exam.net usually stores the essay as one HTML string. If it is JSON (several questions),
  // collect all string values in order.
  function answerToText(answer) {
    if (answer == null) return "";
    let a = answer;
    if (typeof a === "string") {
      const s = a.trim();
      if (!/^[\[{]/.test(s)) return htmlToText(s);
      try { a = JSON.parse(s); } catch { return htmlToText(s); }
    }
    const parts = [];
    (function walk(v) {
      if (v == null) return;
      if (typeof v === "string") { if (v.trim()) parts.push(htmlToText(v)); }
      else if (Array.isArray(v)) v.forEach(walk);
      else if (typeof v === "object") Object.values(v).forEach(walk);
    })(a);
    return parts.filter(Boolean).join("\n\n");
  }

  async function fetchT(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(url, { credentials: "include", signal: ctrl.signal });
      if (r.status === 401 || r.status === 403) throw new Error("Nicht eingeloggt oder keine Berechtigung. Bitte bei exam.net neu einloggen.");
      if (!r.ok) throw new Error(`exam.net antwortet mit Fehler ${r.status}.`);
      return r;
    } catch (e) {
      if (e.name === "AbortError") throw new Error("exam.net antwortet nicht (Zeitüberschreitung). Bitte später nochmals versuchen.");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  function download(name, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ---------- ZIP (write: stored; read: stored + deflate via DecompressionStream) ----------
  const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  function crc32(bytes) {
    let c = 0xffffffff;
    for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function zipStore(files) {
    const enc = new TextEncoder();
    const chunks = [], central = [];
    let offset = 0;
    for (const [name, content] of files) {
      const nameBytes = enc.encode(name), data = enc.encode(content), crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
      local.setUint16(12, 0x0021, true);
      local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
      cd.setUint16(14, 0x0021, true);
      cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
      cd.setUint16(28, nameBytes.length, true); cd.setUint32(42, offset, true);
      chunks.push(new Uint8Array(local.buffer), nameBytes, data);
      central.push(new Uint8Array(cd.buffer), nameBytes);
      offset += 30 + nameBytes.length + data.length;
    }
    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
  }

  async function unzip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("Keine gültige ZIP-Datei.");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = [];
    const dec = new TextDecoder();
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const lofs = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (name.endsWith("/")) continue;
      const start = lofs + 30 + dv.getUint16(lofs + 26, true) + dv.getUint16(lofs + 28, true);
      const raw = u8.subarray(start, start + csize);
      out.push({
        name,
        read: async () => {
          if (method === 0) return raw;
          if (method !== 8) throw new Error("Nicht unterstützte ZIP-Kompression.");
          const s = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
          return new Uint8Array(await new Response(s).arrayBuffer());
        },
      });
    }
    return out;
  }

  async function docxToText(buf) {
    const entries = await unzip(buf);
    const doc = entries.find((e) => e.name === "word/document.xml");
    if (!doc) throw new Error("Word-Datei ohne Inhalt.");
    const xml = new DOMParser().parseFromString(new TextDecoder().decode(await doc.read()), "application/xml");
    const paras = [];
    for (const p of xml.getElementsByTagName("w:p")) {
      let t = "";
      for (const n of p.getElementsByTagName("*")) {
        if (n.tagName === "w:t") t += n.textContent;
        else if (n.tagName === "w:tab") t += "\t";
        else if (n.tagName === "w:br") t += "\n";
      }
      if (t.trim()) paras.push(t.trim());
    }
    return paras.join("\n\n");
  }

  // ---------- CSV (key) ----------
  function csvLine(fields) {
    return fields.map((f) => {
      const s = String(f ?? "");
      return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(";");
  }
  function parseCsv(text) {
    text = text.replace(/^﻿/, "");
    const firstLine = text.split(/\r?\n/)[0];
    const delim = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ";" : ",";
    const rows = [];
    let row = [], f = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { f += '"'; i++; }
        else if (c === '"') q = false;
        else f += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(f); f = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(f); rows.push(row); row = []; f = "";
      } else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim()));
  }
  const splitMulti = (s) => String(s || "").split("|").map((x) => x.trim()).filter(Boolean);

  function parseKey(text) {
    const rows = parseCsv(text);
    if (!rows.length) throw new Error("Der Schlüssel ist leer.");
    const head = rows[0].map((h) => normName(h));
    const col = (re) => head.findIndex((h) => re.test(h));
    const iCode = col(/^codename/), iMail = col(/^e ?mail/), iNames = col(/^schreibweise|^name/), iDev = col(/^ger(a|ae)te/);
    if (iCode < 0 || iNames < 0) throw new Error("Das ist keine Schlüssel-Datei dieses Tools (Spalte «Codename» fehlt).");
    return rows.slice(1).map((r) => ({
      code: (r[iCode] || "").trim(),
      emails: iMail >= 0 ? splitMulti(r[iMail]).map((e) => e.toLowerCase()) : [],
      names: splitMulti(r[iNames]),
      devices: iDev >= 0 ? splitMulti(r[iDev]) : [],
    })).filter((p) => p.code);
  }

  // ---------- exam.net source ----------
  const examnet = {
    async groups() {
      const j = await (await fetchT("/api/groups")).json();
      return (j.groups || []).map((g) => ({ id: g.id, title: g.title }));
    },
    async exams(groupId) {
      const j = await (await fetchT("/api/exams/?group=" + encodeURIComponent(groupId))).json();
      return (j.exams || []).filter((e) => !e.deleted_at)
        .map((e) => ({ id: e.id, title: e.name, created: (e.created_at || "").slice(0, 10) }))
        .sort((a, b) => b.created.localeCompare(a.created));
    },
    async load(exam) {
      const html = await (await fetchT("/print/exams/" + encodeURIComponent(exam.id))).text();
      const el = new DOMParser().parseFromString(html, "text/html").querySelector("exam-print-view");
      if (!el) throw new Error(`«${exam.title}»: Abgaben nicht gefunden. Vielleicht hat exam.net seine Seite geändert, oder du bist nicht mehr eingeloggt.`);
      let list;
      try { list = JSON.parse(el.getAttribute(":students") || "[]"); }
      catch { throw new Error(`«${exam.title}»: Daten von exam.net nicht lesbar.`); }
      const subs = list.filter((s) => !s.is_demo).map((s) => {
        let extra = {};
        try { extra = typeof s.extra === "string" ? JSON.parse(s.extra) : (s.extra || {}); } catch { /* ignore */ }
        const text = answerToText(s.answer);
        return {
          uid: "x" + exam.id + "_" + s.id,
          examKey: "x" + exam.id,
          firstName: (s.firstName || "").trim(),
          lastName: (s.lastName || "").trim(),
          email: (s.email || "").trim().toLowerCase(),
          device: extra.deviceIdentifier || "",
          createdAt: s.created_at || "",
          text, words: wordCount(text),
        };
      });
      const dates = subs.map((s) => s.createdAt.slice(0, 10)).filter(Boolean).sort();
      return { exam: { key: "x" + exam.id, title: exam.title, date: dates[0] || exam.created }, subs };
    },
  };

  // ---------- Matching ----------
  // Nodes: key persons (from a loaded key) and submissions. Union-find with cannot-link pairs.
  function buildNodes(keyPersons, subs) {
    const nodes = [];
    keyPersons.forEach((k, i) => nodes.push({ id: "k" + i, kind: "key", key: k,
      names: k.names, emails: k.emails, devices: k.devices, exams: [] }));
    subs.forEach((s) => nodes.push({ id: s.uid, kind: "sub", sub: s,
      names: [[s.firstName, s.lastName].filter(Boolean).join(" ") || "(ohne Namen)"],
      emails: s.email ? [s.email] : [], devices: s.device ? [s.device] : [], exams: [s.examKey] }));
    return nodes;
  }

  function makeClusters(nodes, parent) {
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const map = new Map();
    nodes.forEach((n, i) => {
      const r = find(i);
      if (!map.has(r)) map.set(r, { root: r, idx: [], names: new Set(), norm: new Set(), loose: new Set(), emails: new Set(), devices: new Set(), exams: new Set(), keys: 0 });
      const c = map.get(r);
      c.idx.push(i);
      n.names.forEach((x) => { c.names.add(x); c.norm.add(normName(x)); c.loose.add(looseName(x)); });
      n.emails.forEach((x) => c.emails.add(x));
      n.devices.forEach((x) => c.devices.add(x));
      n.exams.forEach((x) => c.exams.add(x));
      if (n.kind === "key") c.keys++;
    });
    return { list: [...map.values()], find };
  }

  const intersects = (a, b) => { for (const x of a) if (b.has(x)) return true; return false; };

  function similarNames(A, B) {
    for (const a of A.norm) for (const b of B.norm) {
      if (!a || !b) continue;
      const la = looseName(a), lb = looseName(b);
      if (la && la === lb && a !== b) return true;
      const tol = Math.min(a.length, b.length) <= 5 ? 1 : 2;
      if (a !== b && levenshtein(a, b) <= tol) return true;
      const ta = a.split(" "), tb = b.split(" ");
      if (a !== b && ta[0] === tb[0] && (ta.length === 1 || tb.length === 1)) return true;
    }
    return false;
  }

  function resolve(state) {
    const { nodes, cannot, yes } = state;
    const parent = nodes.map((_, i) => i);
    const idxOf = new Map(nodes.map((n, i) => [n.id, i]));
    let { list, find } = makeClusters(nodes, parent);
    const blocked = (X, Y) => {
      if (X.keys && Y.keys) return true;
      if (X.emails.size && Y.emails.size && !intersects(X.emails, Y.emails)) return true;
      for (const i of X.idx) for (const j of Y.idx) if (cannot.has(nodes[i].id + "|" + nodes[j].id)) return true;
      return false;
    };
    const union = (X, Y) => { parent[find(Y.root)] = find(X.root); };

    // Confirmed pairs first.
    for (const [a, b] of yes) {
      const i = idxOf.get(a), j = idxOf.get(b);
      if (i != null && j != null) parent[find(j)] = find(i);
    }
    // Automatic rules until stable.
    for (let changed = true; changed;) {
      changed = false;
      ({ list, find } = makeClusters(nodes, parent));
      // A name is ambiguous only if two different groups with that name appear in the same exam
      // (then there really are two people called e.g. "Lia"). Otherwise all "Lia"s are one person.
      const ambiguous = (X, Y) => list.some((Z) => (intersects(Z.norm, X.norm) || intersects(Z.norm, Y.norm)) &&
        list.some((W) => W !== Z && intersects(W.norm, Z.norm) && intersects(W.exams, Z.exams)));
      // With two people of the same name, a shared device still decides, if it points to exactly one group.
      const devUnique = (X, Y) => intersects(X.devices, Y.devices) &&
        list.filter((Z) => Z !== X && intersects(Z.norm, X.norm) && intersects(Z.devices, X.devices) && !intersects(Z.exams, X.exams)).length === 1 &&
        list.filter((Z) => Z !== Y && intersects(Z.norm, Y.norm) && intersects(Z.devices, Y.devices) && !intersects(Z.exams, Y.exams)).length === 1;
      outer: for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
        const X = list[x], Y = list[y];
        if (blocked(X, Y)) continue;
        let merge = intersects(X.emails, Y.emails);
        if (!merge && intersects(X.norm, Y.norm) && !intersects(X.exams, Y.exams)) {
          merge = !ambiguous(X, Y) || devUnique(X, Y);
        }
        if (merge) { union(X, Y); changed = true; break outer; }
      }
    }
    ({ list, find } = makeClusters(nodes, parent));

    // Open questions.
    const questions = [];
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
      const X = list[x], Y = list[y];
      if (blocked(X, Y)) continue;
      const sameDev = intersects(X.devices, Y.devices);
      const sameExam = intersects(X.exams, Y.exams);
      const sameName = intersects(X.norm, Y.norm);
      const looseEq = intersects(X.loose, Y.loose);
      const reasons = [];
      if (sameExam) {
        // Same exam: only a re-login is plausible. Same device, or "Savva" vs "Savva 2".
        // Same name on different devices in one exam = two different people, no question.
        if (sameDev) reasons.push("gleiches Gerät");
        if (sameDev && sameName) reasons.push("gleicher Name");
        else if (!sameName && looseEq) reasons.push("ähnlicher Name");
        if (reasons.length) reasons.push("beide in derselben Prüfung (doppelt eingeloggt?)");
      } else {
        if (sameDev && !sameName) reasons.push("gleiches Gerät, anderer Name");
        if (!sameName && similarNames(X, Y)) reasons.push("ähnlicher Name");
        if (sameName) reasons.push("gleicher Name, aber es gibt mehrere Personen mit diesem Namen");
      }
      if (reasons.length) questions.push({ a: X, b: Y, reasons, sameDev });
    }
    return { clusters: list, questions };
  }

  // ---------- Codenames ----------
  function allCodes() {
    const out = [];
    for (const c of COLORS) for (const [a, g] of ANIMALS) out.push(c + ENDING[g] + " " + a);
    return out;
  }
  function shuffle(arr) {
    const r = new Uint32Array(arr.length);
    crypto.getRandomValues(r);
    for (let i = arr.length - 1; i > 0; i--) { const j = r[i] % (i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }

  // ---------- Anonymization ----------
  function buildReplacer(persons) {
    const tokenCodes = new Map(); // lowercased token -> Set of codes
    const add = (tok, code) => {
      tok = String(tok || "").trim();
      if (tok.length < 2) return;
      const k = tok.toLowerCase();
      if (!tokenCodes.has(k)) tokenCodes.set(k, new Set());
      tokenCodes.get(k).add(code);
    };
    for (const p of persons) {
      p.emails.forEach((e) => add(e, p.code));
      for (const n of p.names) {
        if (n === "(ohne Namen)") continue;
        add(n, p.code);
        n.split(/\s+/).forEach((part) => add(part.replace(/^[^\p{L}]+|[^\p{L}\p{N}]+$/gu, ""), p.code));
      }
    }
    const tokens = [...tokenCodes.keys()].sort((a, b) => b.length - a.length);
    if (!tokens.length) return { apply: (t) => ({ text: t, count: 0 }), tokens: [] };
    // Optional German genitive ("Mias", "Mia's") is part of the match and kept in a readable form.
    const re = new RegExp("(?<![\\p{L}\\p{N}@])(" + tokens.map(reEsc).join("|") + ")(s|['’]s)?(?![\\p{L}\\p{N}@])", "giu");
    return {
      tokens,
      apply(text) {
        let count = 0;
        const out = text.replace(re, (m, name, gen) => {
          let codes = tokenCodes.get(m.toLowerCase());
          if (codes) gen = ""; // the token itself ends in s (e.g. "Jonas")
          else codes = tokenCodes.get(name.toLowerCase());
          if (!codes) return m;
          count++;
          const code = codes.size === 1 ? [...codes][0] : "[Name]";
          return gen ? code + (/[sxzß]$/i.test(code) ? "’" : "s") : code;
        });
        return { text: out, count };
      },
    };
  }

  // ---------- App state ----------
  const S = {
    mode: ON_EXAMNET ? "examnet" : "upload",
    step: "source",
    error: "",
    busy: "",
    // examnet
    groups: null, groupId: "", groupTitle: "", exams: null, examSel: new Set(), examMeta: new Map(), examCache: new Map(),
    // upload
    uploadLabel: "", batches: [], // {title, date, files:[{name, text, words}]}
    // common
    keyPersons: [], keyFileName: "",
    loadedExams: [], subs: [],
    nodes: [], cannot: new Set(), yes: [], questions: [], answers: {},
    persons: [], personSel: new Set(), subSel: new Set(), subDecided: new Set(), codeOf: new Map(),
    format: "person", personLayout: "folder",
    lastCheck: null,
  };

  // ---------- UI shell ----------
  const host = document.createElement("div");
  host.id = ON_EXAMNET ? "exam-anon-host" : "anon-host";
  const root = host.attachShadow({ mode: "open" });
  if (ON_EXAMNET) {
    host.style.cssText = "position:fixed;inset:0;z-index:2147483647;";
    document.body.appendChild(host);
  } else {
    MOUNT.appendChild(host);
  }
  ["keydown", "keyup", "keypress"].forEach((t) => host.addEventListener(t, (e) => e.stopPropagation()));

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); overflow: auto; padding: 24px 16px; }
    .panel { background: #fff; color: #111; max-width: 920px; margin: 0 auto; border: 2px solid #111;
      font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
    .inline .panel { border: 0; max-width: none; }
    header { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; border-bottom: 2px solid #111; }
    header h1 { font-size: 19px; margin: 0; }
    .x { background: none; border: 0; font-size: 26px; line-height: 1; cursor: pointer; padding: 0 4px; color: #111; }
    .body { padding: 18px 20px 24px; }
    .inline .body { padding: 0; }
    h2 { font-size: 16px; margin: 22px 0 8px; padding-top: 10px; border-top: 1px solid #111; }
    h2:first-child { margin-top: 0; border-top: 0; padding-top: 0; }
    p { margin: 0 0 10px; color: #444; }
    .muted { color: #666; font-size: 13px; }
    .err { border-left: 4px solid #c8102e; padding: 6px 12px; margin: 0 0 14px; color: #c8102e; font-weight: 600; white-space: pre-wrap; }
    .warn { border-left: 4px solid #c8102e; padding: 6px 12px; margin: 10px 0; }
    .ok { border-left: 4px solid #111; padding: 6px 12px; margin: 10px 0; }
    .busy { padding: 8px 12px; background: #f1f1f1; margin: 0 0 14px; }
    button.b { font: inherit; font-weight: 700; padding: 8px 16px; border: 2px solid #111; background: #111; color: #fff; cursor: pointer; }
    button.b2 { font: inherit; padding: 6px 12px; border: 2px solid #111; background: #fff; color: #111; cursor: pointer; }
    button:disabled { opacity: .4; cursor: default; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin: 12px 0; }
    .list { border: 1px solid #111; max-height: 340px; overflow: auto; }
    .list label { display: flex; gap: 10px; align-items: baseline; padding: 6px 10px; border-bottom: 1px solid #ddd; cursor: pointer; }
    .list label:last-child { border-bottom: 0; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { border: 2px solid #111; padding: 4px 10px; cursor: pointer; background: #fff; font: inherit; }
    .chip.on { background: #111; color: #fff; }
    input[type=text], input[type=date] { font: inherit; padding: 5px 8px; border: 1px solid #111; }
    table { border-collapse: collapse; width: 100%; font-size: 14px; }
    th, td { border-bottom: 1px solid #ddd; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { border-bottom: 2px solid #111; }
    td.num { white-space: nowrap; }
    .tiny { color: #c8102e; }
    .q { border: 2px solid #111; padding: 12px; margin: 0 0 12px; }
    .q .why { font-weight: 700; margin-bottom: 8px; }
    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 640px) { .pair { grid-template-columns: 1fr; } }
    .side { background: #f6f6f6; padding: 8px 10px; font-size: 14px; }
    .side .n { font-weight: 700; font-size: 15px; }
    .snip { font-size: 13px; color: #555; margin-top: 4px; font-style: italic; }
    .opts label { display: block; padding: 4px 0; cursor: pointer; }
    .sub { margin-left: 26px; }
    code { font: 13px ui-monospace, Menlo, monospace; background: #f1f1f1; padding: 1px 4px; }
  `;

  function render() {
    const inner = ({ source: viewSource, questions: viewQuestions, select: viewSelect })[S.step]();
    const shell = `
      <div class="panel">
        ${ON_EXAMNET ? `<header><h1>Aufsätze anonymisieren</h1><button class="x" data-act="close" title="Schliessen">×</button></header>` : ""}
        <div class="body">
          ${S.error ? `<div class="err">${esc(S.error)}</div>` : ""}
          ${S.busy ? `<div class="busy">${esc(S.busy)}</div>` : ""}
          ${inner}
        </div>
      </div>`;
    // Keep the scroll position of the overlay (and of wide tables) across re-renders.
    const scrollers = [...root.querySelectorAll(".backdrop, .list, .tablewrap")].map((e) => [e.className, e.scrollTop, e.scrollLeft]);
    root.innerHTML = `<style>${CSS}</style><div class="${ON_EXAMNET ? "backdrop" : "inline"}">${shell}</div>`;
    for (const [cls, top, left] of scrollers) {
      const e = root.querySelector("." + cls.split(" ")[0]);
      if (e) { e.scrollTop = top; e.scrollLeft = left; }
    }
  }

  // ---------- Step 1: source ----------
  function viewKeyBlock() {
    return `
      <h2>Schlüssel vom letzten Mal (optional)</h2>
      <p>Damit alle wieder denselben Codenamen bekommen wie beim letzten Export.</p>
      <div class="row">
        <input type="file" accept=".csv,text/csv" data-act="key">
        ${S.keyPersons.length ? `<span>✓ ${S.keyPersons.length} Personen aus <b>${esc(S.keyFileName)}</b></span> <button class="b2" data-act="key-clear">Entfernen</button>` : ""}
      </div>`;
  }

  function viewSource() {
    if (S.mode === "examnet") {
      if (!S.groups) return `<p>Klassen werden geladen …</p>`;
      const groups = S.groups.map((g) => `<button class="chip ${String(g.id) === String(S.groupId) ? "on" : ""}" data-act="group" data-id="${esc(g.id)}">${esc(g.title)}</button>`).join("");
      let exams = "";
      if (S.groupId) {
        if (!S.exams) exams = `<p>Prüfungen werden geladen …</p>`;
        else if (!S.exams.length) exams = `<p>In diesem Ordner gibt es keine Prüfungen.</p>`;
        else exams = `
          <div class="row"><button class="b2" data-act="exam-all">Alle</button><button class="b2" data-act="exam-none">Keine</button>
            <span class="muted">${S.examSel.size} gewählt${S.exams.filter((e) => S.examSel.has(String(e.id))).length < S.examSel.size ? " (auch in anderen Ordnern)" : ""}</span></div>
          <div class="list">${S.exams.map((e) => `
            <label><input type="checkbox" data-act="exam" data-id="${esc(e.id)}" ${S.examSel.has(String(e.id)) ? "checked" : ""}>
              <span>${esc(e.title)}</span><span class="muted">erstellt ${esc(e.created)}</span></label>`).join("")}
          </div>`;
      }
      return `
        <h2>1. Klasse wählen</h2>
        <div class="chips">${groups || `<p>Keine Ordner gefunden. Lege auf exam.net pro Klasse einen Ordner an.</p>`}</div>
        ${S.groupId ? `<h2>2. Prüfungen wählen</h2>${exams}` : ""}
        ${viewKeyBlock()}
        ${S.persons.length ? `<p class="muted">Bisherige Antworten und Codenamen bleiben erhalten. Bei Bedarf in einem anderen Ordner weitere Prüfungen anhaken (z.B. Nachprüfung).</p>` : ""}
        <div class="row"><button class="b" data-act="load" ${S.examSel.size && !S.busy ? "" : "disabled"}>${S.persons.length ? "Übernehmen" : "Abgaben laden"}</button></div>`;
    }
    // upload
    const batches = S.batches.map((b, bi) => `
      <div class="q">
        <div class="row">
          <label>Titel <input type="text" data-act="b-title" data-b="${bi}" value="${esc(b.title)}" placeholder="z.B. Rekonstruktion 1"></label>
          <label>Datum <input type="date" data-act="b-date" data-b="${bi}" value="${esc(b.date)}"></label>
          <button class="b2" data-act="b-del" data-b="${bi}">Aufsatz entfernen</button>
        </div>
        <div class="row"><input type="file" multiple accept=".docx,.txt,.md,.zip" data-act="b-files" data-b="${bi}">
          <span class="muted">Word, Text oder ZIP. Eine Datei = eine Abgabe.</span></div>
        ${b.files.length ? `<table><tr><th>Name (aus Dateiname, anpassbar)</th><th>Wörter</th><th></th></tr>
          ${b.files.map((f, fi) => `<tr><td><input type="text" data-act="f-name" data-b="${bi}" data-f="${fi}" value="${esc(f.name)}"></td>
            <td class="num ${f.words < TINY_WORDS ? "tiny" : ""}">${f.words}</td>
            <td><button class="b2" data-act="f-del" data-b="${bi}" data-f="${fi}">×</button></td></tr>`).join("")}</table>` : ""}
      </div>`).join("");
    const ready = S.batches.length && S.batches.every((b) => b.title.trim() && b.date && b.files.length);
    return `
      <h2>1. Bezeichnung</h2>
      <div class="row"><label>Klasse / Gruppe <input type="text" data-act="u-label" value="${esc(S.uploadLabel)}" placeholder="z.B. 6c"></label></div>
      <h2>2. Aufsätze hinzufügen</h2>
      <p>Pro Aufsatz (Prüfung) einen Block. Der Name der Person wird aus dem Dateinamen gelesen. Bitte prüfen und korrigieren.</p>
      ${batches}
      <div class="row"><button class="b2" data-act="b-add">+ Aufsatz hinzufügen</button></div>
      ${viewKeyBlock()}
      <div class="row"><button class="b" data-act="load" ${ready && !S.busy ? "" : "disabled"}>Weiter</button>
        ${S.batches.length && !ready ? `<span class="muted">Jeder Aufsatz braucht Titel, Datum und mindestens eine Datei.</span>` : ""}</div>`;
  }

  // ---------- Step 2: questions ----------
  function clusterSummary(C) {
    const names = [...C.names].filter((n) => n !== "(ohne Namen)");
    const subs = C.idx.map((i) => S.nodes[i]).filter((n) => n.kind === "sub").map((n) => n.sub);
    const key = C.idx.map((i) => S.nodes[i]).find((n) => n.kind === "key");
    const exams = subs.map((s) => {
      const e = S.loadedExams.find((x) => x.key === s.examKey);
      return `${esc(e ? e.title : "?")} <span class="muted">(${esc(e ? e.date : "")}, ${s.words} Wörter)</span>`;
    });
    const snip = subs.find((s) => s.text)?.text.slice(0, 140);
    return `
      <div class="side">
        <div class="n">${esc(names.join(" / ") || "(ohne Namen)")}</div>
        ${[...C.emails].length ? `<div class="muted">${esc([...C.emails].join(", "))}</div>` : ""}
        ${key ? `<div>Aus dem Schlüssel: <b>${esc(key.key.code)}</b></div>` : ""}
        ${exams.length ? `<div>${exams.join("<br>")}</div>` : ""}
        ${snip ? `<div class="snip">«${esc(snip)}…»</div>` : ""}
      </div>`;
  }

  function viewQuestions() {
    const qs = S.questions;
    return `
      <h2>Zuordnung klären</h2>
      <p>Bei diesen Abgaben ist nicht klar, ob es dieselbe Person ist. Bitte entscheiden. Danach rechnet das Tool neu. Es kann sein, dass dann noch einzelne weitere Fragen kommen.</p>
      ${qs.map((q, i) => `
        <div class="q">
          <div class="why">${esc(q.reasons.join(" · "))}</div>
          <div class="pair">${clusterSummary(q.a)}${clusterSummary(q.b)}</div>
          <div class="row">
            <label><input type="radio" name="q${i}" data-act="ans" data-i="${i}" value="yes" ${S.answers[i] === "yes" ? "checked" : ""}> Gleiche Person</label>
            <label><input type="radio" name="q${i}" data-act="ans" data-i="${i}" value="no" ${S.answers[i] === "no" ? "checked" : ""}> Verschiedene Personen</label>
          </div>
        </div>`).join("")}
      <div class="row">
        <button class="b" data-act="apply" ${Object.keys(S.answers).length === qs.length ? "" : "disabled"}>Antworten übernehmen</button>
        <span class="muted">${Object.keys(S.answers).length} von ${qs.length} beantwortet</span>
        <button class="b2" data-act="back">Zurück</button>
      </div>`;
  }

  // ---------- Step 3: select + export ----------
  function orderedExams() {
    const ex = [...S.loadedExams].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
    const pad = ex.length >= 10 ? 2 : 1;
    return ex.map((e, i) => ({ ...e, nr: String(i + 1).padStart(pad, "0") }));
  }

  function viewSelect() {
    const ex = orderedExams();
    const active = S.persons.filter((p) => p.subs.length);
    const rows = active.map((p) => `
      <tr>
        <td><input type="checkbox" data-act="psel" data-code="${esc(p.code)}" ${S.personSel.has(p.code) ? "checked" : ""}></td>
        <td><b>${esc(p.code)}</b><div class="muted">${esc(p.names.filter((n) => n !== "(ohne Namen)").join(" / "))}</div></td>
        ${ex.map((e) => {
          const subs = p.subs.filter((s) => s.examKey === e.key);
          if (!subs.length) return `<td class="num muted">–</td>`;
          return `<td class="num">${subs.map((s) => `<label title="${s.words < TINY_WORDS ? "Sehr kurz, standardmässig abgewählt" : ""}">
            <input type="checkbox" data-act="ssel" data-uid="${esc(s.uid)}" ${S.subSel.has(s.uid) ? "checked" : ""}>
            <span class="${s.words < TINY_WORDS ? "tiny" : ""}">${s.words}</span></label>`).join("<br>")}</td>`;
        }).join("")}
      </tr>`).join("");
    const opt = (name, val, label, cur) => `<label><input type="radio" name="${name}" data-act="${name}" value="${val}" ${cur === val ? "checked" : ""}> ${label}</label>`;
    const nSubs = active.filter((p) => S.personSel.has(p.code)).reduce((n, p) => n + p.subs.filter((s) => S.subSel.has(s.uid)).length, 0);
    return `
      <h2>Schüler/innen und Abgaben wählen</h2>
      <p>${active.length} Personen erkannt. Zahlen = Wörter. Sehr kurze Abgaben (<span class="tiny">rot</span>, z.B. abgebrochenes Login) sind abgewählt.</p>
      <div class="row"><button class="b2" data-act="p-all">Alle</button><button class="b2" data-act="p-none">Keine</button>
        <button class="b2" data-act="restart-match">Zuordnung neu beginnen</button></div>
      <div class="tablewrap" style="overflow:auto"><table>
        <tr><th></th><th>Codename</th>${ex.map((e) => `<th>${esc(e.nr)}. ${esc(e.title)}<div class="muted">${esc(e.date)}</div></th>`).join("")}</tr>
        ${rows}
      </table></div>

      <h2>Format</h2>
      <div class="opts">
        ${opt("format", "person", "<b>Pro Schüler/in</b>", S.format)}
        ${S.format === "person" ? `<div class="sub">
          ${opt("personLayout", "folder", "Ordner pro Person, eine Datei pro Aufsatz", S.personLayout)}
          ${opt("personLayout", "file", "Eine Datei pro Person mit allen Aufsätzen", S.personLayout)}</div>` : ""}
        ${opt("format", "exam", "<b>Pro Aufsatz</b>: eine Datei pro Prüfung mit allen Texten", S.format)}
        ${opt("format", "single", "<b>Alles in einer Datei</b>", S.format)}
      </div>
      <p class="muted">Aufsätze sind nach Datum nummeriert (1 = ältester). Namen und E-Mail-Adressen im Text werden durch Codenamen ersetzt, auch Namen von Mitschüler/innen.</p>

      <h2>Herunterladen</h2>
      <div class="row">
        <button class="b" data-act="export" ${nSubs ? "" : "disabled"}>Texte herunterladen (${nSubs})</button>
        <button class="b2" data-act="export-key">Schlüssel herunterladen (CSV)</button>
        <button class="b2" data-act="back">${S.mode === "examnet" ? "Weitere Prüfungen hinzufügen" : "Weitere Aufsätze hinzufügen"}</button>
      </div>
      <p class="muted">Der Schlüssel enthält die echten Namen. Gut aufbewahren, nicht der KI geben. Beim nächsten Mal wieder laden, damit die Codenamen gleich bleiben.</p>
      ${S.lastCheck ? (S.lastCheck.leaks.length
        ? `<div class="warn"><b>Achtung:</b> Im Export steht möglicherweise noch: ${esc(S.lastCheck.leaks.join(", "))}. Bitte vor dem Weitergeben prüfen.</div>`
        : `<div class="ok">Geprüft: Im Export steht keine E-Mail-Adresse und kein bekannter Name mehr (${S.lastCheck.count} Ersetzungen).</div>`) : ""}`;
  }

  // ---------- Logic: load, match, persons ----------
  async function loadSource() {
    S.error = ""; S.lastCheck = null;
    try {
      if (S.mode === "examnet") {
        // Selection may span several folders (e.g. a make-up exam in another folder).
        const chosen = [...S.examSel].map((id) => S.examMeta.get(id)).filter(Boolean);
        S.loadedExams = []; S.subs = [];
        for (let i = 0; i < chosen.length; i++) {
          const id = String(chosen[i].id);
          if (!S.examCache.has(id)) {
            S.busy = `Lade Abgaben ${i + 1} von ${chosen.length}: ${chosen[i].title} …`; render();
            S.examCache.set(id, await examnet.load(chosen[i]));
          }
          const { exam, subs } = S.examCache.get(id);
          S.loadedExams.push(exam); S.subs.push(...subs);
        }
      } else {
        S.loadedExams = S.batches.map((b) => ({ key: "u" + b.id, title: b.title.trim(), date: b.date }));
        S.subs = S.batches.flatMap((b) => b.files.map((f) => {
          const parts = f.name.trim().split(/\s+/);
          return { uid: "u" + f.id, examKey: "u" + b.id, firstName: parts[0] || "", lastName: parts.slice(1).join(" "),
            email: "", device: "", createdAt: b.date, text: f.text, words: f.words };
        }));
      }
      S.busy = "";
      if (!S.subs.length) throw new Error("Keine Abgaben gefunden.");
      // Node ids are stable, so earlier answers (S.yes / S.cannot) and codenames stay valid
      // when exams are added later.
      S.nodes = buildNodes(S.keyPersons, S.subs);
      runMatching();
    } catch (e) {
      S.busy = ""; S.error = e.message || String(e); render();
    }
  }

  function runMatching() {
    const { clusters, questions } = resolve(S);
    S.answers = {};
    if (questions.length) { S.questions = questions; S.step = "questions"; render(); return; }
    try { buildPersons(clusters); } catch (e) { S.error = e.message; S.step = "source"; render(); return; }
    S.step = "select"; render();
  }

  function applyAnswers() {
    S.questions.forEach((q, i) => {
      const A = q.a.idx.map((k) => S.nodes[k].id), B = q.b.idx.map((k) => S.nodes[k].id);
      // Pin the whole confirmed group, so automatic merges inside it survive the recomputation.
      if (S.answers[i] === "yes") for (const x of [...A, ...B]) S.yes.push([A[0], x]);
      else if (S.answers[i] === "no") for (const a of A) for (const b of B) { S.cannot.add(a + "|" + b); S.cannot.add(b + "|" + a); }
    });
    runMatching();
  }

  function buildPersons(clusters) {
    const persons = clusters.map((C) => {
      const ns = C.idx.map((i) => S.nodes[i]);
      const key = ns.find((n) => n.kind === "key");
      // Reuse a codename given earlier in this session, so adding exams does not reshuffle names.
      const earlier = ns.map((n) => S.codeOf.get(n.id)).filter(Boolean).sort()[0];
      return {
        nodeIds: ns.map((n) => n.id),
        code: key ? key.key.code : (earlier || ""),
        names: [...C.names],
        emails: [...C.emails],
        devices: [...C.devices],
        subs: ns.filter((n) => n.kind === "sub").map((n) => n.sub).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      };
    });
    // New codenames: unused, and not containing any known name word (else the name check would fire).
    // Two groups that got the same earlier code (cannot normally happen) → second gets a new one.
    const seen = new Set();
    for (const p of persons) { if (p.code && seen.has(p.code)) p.code = ""; if (p.code) seen.add(p.code); }
    const used = new Set([...seen, ...S.codeOf.values()]);
    const nameWords = new Set(persons.flatMap((p) => p.names.flatMap((n) => normName(n).split(" "))));
    const pool = shuffle(allCodes().filter((c) => !used.has(c) && !normName(c).split(" ").some((w) => nameWords.has(w))));
    for (const p of persons) if (!p.code) {
      if (!pool.length) throw new Error("Zu viele Personen für die Codenamen-Liste.");
      p.code = pool.pop();
    }
    for (const p of persons) for (const id of p.nodeIds) S.codeOf.set(id, p.code);
    persons.sort((a, b) => a.code.localeCompare(b.code, "de"));
    // Keep the teacher's earlier choices; new persons/submissions get the defaults.
    const prevPersons = S.persons.map((p) => p.code);
    S.persons = persons;
    S.personSel = new Set(persons.filter((p) => p.subs.length && (S.personSel.has(p.code) || !prevPersons.includes(p.code))).map((p) => p.code));
    S.subSel = new Set(S.subs.filter((s) => S.subDecided.has(s.uid) ? S.subSel.has(s.uid) : s.words >= TINY_WORDS).map((s) => s.uid));
    S.subs.forEach((s) => S.subDecided.add(s.uid));
  }

  // ---------- Export ----------
  function buildExport() {
    const ex = orderedExams();
    const exByKey = new Map(ex.map((e) => [e.key, e]));
    const rep = buildReplacer(S.persons);
    let count = 0;
    const anon = (t) => { const r = rep.apply(t); count += r.count; return r.text; };
    const label = S.mode === "examnet" ? S.groupTitle : (S.uploadLabel.trim() || "Upload");

    // essays[code][examKey] = [{text, words}]
    const chosen = S.persons.filter((p) => S.personSel.has(p.code))
      .map((p) => ({ p, subs: p.subs.filter((s) => S.subSel.has(s.uid)) }))
      .filter((x) => x.subs.length);
    const essayBody = (subs) => subs.length === 1 ? anon(subs[0].text)
      : subs.map((s, i) => `### Abgabe ${i + 1} von ${subs.length}\n\n${anon(s.text)}`).join("\n\n");
    const words = (subs) => subs.reduce((n, s) => n + s.words, 0);
    const head = (e, code, subs, level) => `${"#".repeat(level)} Aufsatz ${e.nr} – ${e.title} (${e.date}) · ${code} · ${words(subs)} Wörter`;
    const byExam = (x) => ex.map((e) => ({ e, subs: x.subs.filter((s) => s.examKey === e.key) })).filter((y) => y.subs.length);

    const overview = [
      `# Übersicht`, ``,
      `Anonymisierte Aufsätze. Namen und E-Mail-Adressen wurden durch Codenamen ersetzt («[Name]» = mehrdeutiger Name).`,
      `Die Aufsätze sind nach Datum nummeriert; dieselbe Nummer bedeutet denselben Aufsatz.`, ``,
      `| Nr. | Aufsatz | Datum | Abgaben |`, `|---|---|---|---|`,
      ...ex.map((e) => `| ${e.nr} | ${e.title} | ${e.date} | ${chosen.filter((x) => x.subs.some((s) => s.examKey === e.key)).length} |`),
      ``, `Personen (${chosen.length}): ${chosen.map((x) => x.p.code).join(", ")}`, ``,
    ].join("\n");

    const files = [];
    if (S.format === "person" && S.personLayout === "folder") {
      for (const x of chosen) for (const { e, subs } of byExam(x)) {
        files.push([`${safeFile(x.p.code)}/${e.nr} ${safeFile(e.title)}.md`, `${head(e, x.p.code, subs, 1)}\n\n${essayBody(subs)}\n`]);
      }
    } else if (S.format === "person") {
      for (const x of chosen) {
        files.push([`${safeFile(x.p.code)}.md`, `# ${x.p.code}\n\n` + byExam(x).map(({ e, subs }) => `${head(e, x.p.code, subs, 2)}\n\n${essayBody(subs)}`).join("\n\n") + "\n"]);
      }
    } else if (S.format === "exam") {
      for (const e of ex) {
        const parts = chosen.map((x) => ({ code: x.p.code, subs: x.subs.filter((s) => s.examKey === e.key) })).filter((y) => y.subs.length);
        if (!parts.length) continue;
        files.push([`${e.nr} ${safeFile(e.title)}.md`, `# Aufsatz ${e.nr} – ${e.title} (${e.date})\n\n` +
          parts.map((y) => `## ${y.code} · ${words(y.subs)} Wörter\n\n${essayBody(y.subs)}`).join("\n\n") + "\n"]);
      }
    } else {
      const body = chosen.map((x) => `# ${x.p.code}\n\n` + byExam(x).map(({ e, subs }) => `${head(e, x.p.code, subs, 2)}\n\n${essayBody(subs)}`).join("\n\n")).join("\n\n");
      files.push([`${safeFile(label)} anonymisiert ${today()}.md`, overview + "\n" + body + "\n"]);
    }
    if (S.format !== "single") files.unshift(["Übersicht.md", overview]);

    // Leak check: any e-mail address or any known name token left?
    const all = files.map((f) => f[1]).join("\n");
    const leaks = new Set();
    if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(all)) leaks.add("eine E-Mail-Adresse");
    const codeWords = new Set(S.persons.flatMap((p) => p.code.toLowerCase().split(" ")));
    for (const t of rep.tokens) {
      if (t.length < 3 || t.includes("@") || codeWords.has(t)) continue;
      const re = new RegExp("(?<![\\p{L}\\p{N}])" + reEsc(t) + "(?![\\p{L}\\p{N}])", "iu");
      if (re.test(all)) leaks.add("«" + t + "»");
    }
    S.lastCheck = { leaks: [...leaks], count };
    return { files, label };
  }

  function doExport() {
    const { files, label } = buildExport();
    if (S.format === "single") download(files[0][0], files[0][1], "text/markdown;charset=utf-8");
    else download(`${safeFile(label)} anonymisiert ${today()}.zip`, zipStore(files));
    render();
  }

  function doExportKey() {
    const label = S.mode === "examnet" ? S.groupTitle : (S.uploadLabel.trim() || "Upload");
    const ex = orderedExams();
    const lines = [csvLine(["Codename", "E-Mail", "Schreibweisen", "Geräte-IDs", "Prüfungen"])];
    for (const p of S.persons) {
      const exams = [...new Set(p.subs.map((s) => s.examKey))].map((k) => ex.find((e) => e.key === k)).filter(Boolean)
        .map((e) => `${e.date} ${e.title}`);
      lines.push(csvLine([p.code, p.emails.join(" | "), p.names.filter((n) => n !== "(ohne Namen)").join(" | "), p.devices.join(" | "), exams.join(" | ")]));
    }
    download(`Schluessel ${safeFile(label)} ${today()}.csv`, "﻿" + lines.join("\r\n") + "\r\n", "text/csv;charset=utf-8");
  }

  // ---------- Events ----------
  root.addEventListener("click", async (ev) => {
    const t = ev.target.closest("[data-act]");
    if (!t) return;
    const act = t.dataset.act;
    if (t.tagName === "INPUT" && (t.type === "checkbox" || t.type === "radio" || t.type === "file" || t.type === "text" || t.type === "date")) return;
    S.error = "";
    switch (act) {
      case "close": host.style.display = "none"; return;
      case "group": {
        S.groupId = t.dataset.id;
        // The first folder names the export; selections in other folders are kept.
        if (!S.groupTitle || !S.examSel.size) S.groupTitle = S.groups.find((g) => String(g.id) === S.groupId)?.title || "";
        S.exams = null; render();
        try { S.exams = await examnet.exams(S.groupId); S.exams.forEach((e) => S.examMeta.set(String(e.id), e)); }
        catch (e) { S.error = e.message; S.exams = []; }
        break;
      }
      case "exam-all": S.exams.forEach((e) => S.examSel.add(String(e.id))); break;
      case "exam-none": S.exams.forEach((e) => S.examSel.delete(String(e.id))); break;
      case "key-clear": S.keyPersons = []; S.keyFileName = ""; break;
      case "load": await loadSource(); return;
      case "b-add": S.batches.push(newBatch()); break;
      case "b-del": S.batches.splice(+t.dataset.b, 1); break;
      case "f-del": S.batches[+t.dataset.b].files.splice(+t.dataset.f, 1); break;
      case "apply": applyAnswers(); return;
      case "back": S.step = "source"; S.lastCheck = null; break;
      case "restart-match": S.cannot = new Set(); S.yes = []; runMatching(); return;
      case "p-all": S.personSel = new Set(S.persons.filter((p) => p.subs.length).map((p) => p.code)); break;
      case "p-none": S.personSel = new Set(); break;
      case "export": try { doExport(); } catch (e) { S.error = e.message; render(); } return;
      case "export-key": doExportKey(); return;
      default: return;
    }
    render();
  });

  root.addEventListener("change", async (ev) => {
    const t = ev.target;
    const act = t.dataset && t.dataset.act;
    if (!act) return;
    S.error = "";
    switch (act) {
      case "exam": t.checked ? S.examSel.add(t.dataset.id) : S.examSel.delete(t.dataset.id); break;
      case "key": {
        const f = t.files[0];
        if (!f) return;
        try { S.keyPersons = parseKey(await f.text()); S.keyFileName = f.name; }
        catch (e) { S.error = e.message; }
        break;
      }
      case "ans": S.answers[+t.dataset.i] = t.value; break;
      case "psel": t.checked ? S.personSel.add(t.dataset.code) : S.personSel.delete(t.dataset.code); break;
      case "ssel": t.checked ? S.subSel.add(t.dataset.uid) : S.subSel.delete(t.dataset.uid); break;
      case "format": S.format = t.value; S.lastCheck = null; break;
      case "personLayout": S.personLayout = t.value; S.lastCheck = null; break;
      case "u-label": S.uploadLabel = t.value; return;
      case "b-title": S.batches[+t.dataset.b].title = t.value; break;
      case "b-date": S.batches[+t.dataset.b].date = t.value; break;
      case "f-name": S.batches[+t.dataset.b].files[+t.dataset.f].name = t.value; return;
      case "b-files": {
        const b = S.batches[+t.dataset.b];
        S.busy = "Dateien werden gelesen …"; render();
        try { b.files.push(...await readUploads([...t.files])); }
        catch (e) { S.error = e.message; }
        S.busy = "";
        break;
      }
      default: return;
    }
    render();
  });

  // Keep typed text without re-rendering on every key; update buttons on input.
  root.addEventListener("input", (ev) => {
    const t = ev.target, act = t.dataset && t.dataset.act;
    if (act === "b-title") { S.batches[+t.dataset.b].title = t.value; }
    else if (act === "u-label") { S.uploadLabel = t.value; return; }
    else if (act === "f-name") { S.batches[+t.dataset.b].files[+t.dataset.f].name = t.value; return; }
    else return;
    const btn = root.querySelector('[data-act="load"]');
    const ready = S.batches.length && S.batches.every((b) => b.title.trim() && b.date && b.files.length);
    if (btn) btn.disabled = !ready;
  });

  let seq = 0;
  const newBatch = () => ({ id: ++seq, title: "", date: today(), files: [] });

  async function readUploads(files) {
    const out = [];
    const nameOf = (fn) => fn.split("/").pop().replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
    const addText = (fn, text) => { text = text.replace(/\r\n?/g, "\n").trim(); out.push({ id: ++seq, name: nameOf(fn), text, words: wordCount(text) }); };
    for (const f of files) {
      const lower = f.name.toLowerCase();
      if (lower.endsWith(".docx")) addText(f.name, await docxToText(await f.arrayBuffer()));
      else if (lower.endsWith(".txt") || lower.endsWith(".md")) addText(f.name, await f.text());
      else if (lower.endsWith(".zip")) {
        for (const e of await unzip(await f.arrayBuffer())) {
          const n = e.name.toLowerCase();
          if (n.startsWith("__macosx/") || n.split("/").pop().startsWith(".")) continue;
          if (n.endsWith(".docx")) addText(e.name, await docxToText(await e.read()));
          else if (n.endsWith(".txt") || n.endsWith(".md")) addText(e.name, new TextDecoder().decode(await e.read()));
        }
      } else if (lower.endsWith(".pdf")) {
        throw new Error("PDF wird nicht unterstützt. Bitte bei exam.net «Word (nur Freitextantworten)» herunterladen.");
      }
    }
    if (!out.length) throw new Error("In den gewählten Dateien wurden keine Texte gefunden.");
    return out;
  }

  // ---------- Start ----------
  render();
  if (S.mode === "examnet") {
    examnet.groups().then((g) => { S.groups = g; render(); })
      .catch((e) => { S.groups = []; S.error = e.message; render(); });
  } else {
    S.batches.push(newBatch());
    render();
  }

  // For tests only (not used by the UI).
  window.__examAnonTest = { normName, looseName, levenshtein, similarNames, buildReplacer, parseKey, parseCsv, csvLine, htmlToText, answerToText, unzip, zipStore, resolve, buildNodes, allCodes };
})();
