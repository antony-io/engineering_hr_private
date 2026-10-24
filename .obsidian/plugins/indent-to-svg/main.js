const { Plugin, Keymap, TFolder, TFile, Notice, PluginSettingTab, Setting } = require("obsidian");

/* Indent to SVG (pbstree) — v1.1.0
 * 1.0.0 : indented list -> SVG tree (system / sub-systems / components), colours, links.
 * 1.1.0 : - "@source: <folder>" builds the tree LIVE from the vault: one column per sub-folder
 *           (label = H1 / `label:` of its 00_Index note), people notes (`type: person`) nested by
 *           `manager`, grouped by `sub_team`, coloured by `contract` / `status`. Re-renders when a
 *           note of the folder changes.
 *         - colour code: lead blue, open position light orange, others standard; RED = `agreed_with_hr` not true;
 *         - HR watch: any change to a person note (content, properties or file name) sets `agreed_with_hr: false`;
 *           you set it back to true by hand once shared with HR (Settings > Indent to SVG). tags CDD / Consultant; dashed = arriving.
 *         - staff row: the root person's own team is drawn just below the root ("@staff: off" to disable).
 *         - visual legend above the tree ("@legend: on|off", on by default with @source).
 *         - HTML export: button on each tree + command "Export org chart as HTML" (self-contained file).
 *         - two-line boxes: "Label // subtitle" (the subtitle is used for the role in @source mode).
 */

const NS = "http://www.w3.org/2000/svg";
const PAD_X = 14, BOX_H = 34, BOX_H2 = 48, MIN_W = 60;
const GAP_X = 30;       // espace horizontal entre colonnes de sous-systèmes
const GAP_Y = 36;       // espace vertical système -> sous-systèmes
const ROW_GAP = 12;     // espace vertical entre boîtes d'une colonne
const INDENT = 22;      // décalage d'un niveau dans une colonne
const MARGIN = 12;

const ctx = document.createElement("canvas").getContext("2d");
function textWidth(t, size = 14) {
  ctx.font = `${size}px sans-serif`;
  return Math.ceil(ctx.measureText(t).width);
}

// ---- Couleurs -------------------------------------------------------------
function contrastText(color) {
  ctx.fillStyle = "#000";
  ctx.fillStyle = color;
  const v = ctx.fillStyle;
  let r, g, b;
  let m = v.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (m) [r, g, b] = [1, 2, 3].map(i => parseInt(m[i], 16));
  else if ((m = v.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/))) [r, g, b] = [1, 2, 3].map(i => +m[i]);
  else return null;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#111" : "#fff";
}

// Palette used in @source mode (overridable with "@palette: key=#hex, ...")
const DEFAULT_PALETTE = {
  lead: "#2f6fed", tbh: "#f6b26b", nohr: "#c62828", subteam: "#7f8c8d", team: null,
  // tags (small label on the box corner)
  cdd: "#c99a06", consultant: "#e07b00",
};

// ---- Parsing --------------------------------------------------------------
// Ligne :      Texte  |  [[Note]]  |  [[Note|Libellé]]  |  Texte {#e74c3c}  |  Texte // sous-titre
// Directives : @couleurs: #4a90d9, -, #7bc47f      (une couleur par niveau, "-" = défaut)
//              @source: dossier/du/coffre           (arbre construit depuis les notes)
//              @root: [[Note|Libellé]]              (racine en mode @source)
//              @details: role, dates | none         (contenu du sous-titre en mode @source)
//              @palette: lead=…, tbh=… (open position), nohr=… (not agreed with HR), subteam=…, cdd=…, consultant=…
//              @legend: on | off                    (légende visuelle ; par défaut : on en mode @source)
//              @stats: on | off                     (effectifs : total, CDI, CDD, stagiaires, consultants, TBH)
//              @staff: on | off                     (équipe de la racine sur une ligne sous la racine ; défaut : on)
function parseLabel(raw) {
  let text = raw, color = null, link = null, sub = null;
  const c = text.match(/\s*\{([^{}]+)\}\s*$/);
  if (c) { color = c[1].trim(); text = text.slice(0, c.index); }
  const l = text.match(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/);
  if (l) {
    link = l[1].trim();
    text = text.replace(l[0], (l[2] || l[1]).trim());
  }
  const s = text.split(/\s+\/\/\s+/);
  if (s.length > 1) { text = s[0]; sub = s.slice(1).join(" // ").trim() || null; }
  return { text: text.trim(), color, link, sub };
}

function mkNode(label) {
  const w = Math.max(MIN_W, textWidth(label.text) + 2 * PAD_X, label.sub ? textWidth(label.sub, 11) + 2 * PAD_X : 0);
  return { ...label, children: [], w, h: label.sub ? BOX_H2 : BOX_H };
}

function parse(source) {
  const roots = [];
  const stack = [];
  const opts = { levelColors: [], source: null, root: null, legend: null, stats: null, staff: true, details: ["role", "dates"], palette: { ...DEFAULT_PALETTE } };
  for (const raw of source.split("\n")) {
    if (!raw.trim()) continue;
    const d = raw.match(/^\s*@([a-zé]+)\s*:\s*(.*)$/i);
    if (d) {
      const key = d[1].toLowerCase(), val = d[2].trim();
      if (/^(couleurs?|colou?rs?)$/.test(key))
        opts.levelColors = val.split(",").map(x => x.trim()).map(x => (x === "-" || x === "" ? null : x));
      else if (key === "source") opts.source = val.replace(/^\/+|\/+$/g, "");
      else if (key === "root" || key === "racine") opts.root = parseLabel(val);
      else if (key === "legend" || key === "legende" || key === "légende") opts.legend = !/^(off|non|no|none|false|0)$/i.test(val);
      else if (key === "stats" || key === "effectifs") opts.stats = !/^(off|non|no|none|false|0)$/i.test(val);
      else if (key === "staff") opts.staff = !/^(off|non|no|none|false|0)$/i.test(val);
      else if (key === "details") opts.details = /^(none|aucun|-)$/i.test(val) ? [] : val.split(",").map(x => x.trim().toLowerCase());
      else if (key === "palette")
        val.split(",").forEach(kv => { const [k, v] = kv.split("=").map(x => x && x.trim()); if (k) opts.palette[k.toLowerCase()] = (v === "-" ? null : v); });
      continue;
    }
    const m = raw.match(/^([ \t]*)(.*)$/);
    const indent = m[1].replace(/\t/g, "    ").length;
    const label = parseLabel(m[2].replace(/^([-*+]|\d+[.)])\s+/, ""));
    if (!label.text) continue;
    const node = mkNode(label);
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else roots.push(node);
    stack.push({ indent, node });
  }
  return { roots, opts };
}

function applyLevelColors(roots, levelColors) {
  const walk = (n, level) => {
    n.level = level;
    n.fill = n.color || (levelColors.length ? levelColors[Math.min(level, levelColors.length - 1)] : null);
    n.children.forEach(c => walk(c, level + 1));
    (n.staff || []).forEach(c => { c.level = level + 1; c.fill = c.color || null; });
  };
  roots.forEach(r => walk(r, 0));
}

// ---- Construction depuis le coffre (@source) -------------------------------
const linkName = v => {
  if (Array.isArray(v)) v = v[0];
  if (!v) return "";
  return String(v).replace(/^\[\[|\]\]$/g, "").split("|")[0].split("/").pop().replace(/\.md$/, "").trim();
};
const str = v => (v == null ? "" : String(v)).trim();
function ddmmyy(v) {
  const m = str(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : "";
}
const AB = [["Engineering", "Eng."], ["Engineer", "Eng."], ["Architecture", "Arch."], ["Architect", "Arch."],
  [" and ", " & "], ["Electronics", "Elec."], ["Electronic", "Elec."], ["Electrical", "Elec."],
  ["Mechanical", "Mech."], ["Systems", "Sys."], ["System", "Sys."], ["Satellite", "Sat."],
  ["Team Manager", "Mgr"], ["Digital Signal Processing", "DSP"], ["Computer Vision", "CV"], ["Machine Learning", "ML"]];
function shortRole(r, n = 32) {
  for (const [a, b] of AB) { if (r.length <= n) break; r = r.split(a).join(b); }
  return r;
}

function indexOf(app, folder) {
  const f = folder.children.find(c => c instanceof TFile && c.extension === "md" && /^(00_)?index/i.test(c.basename));
  if (!f) return { file: null, fm: {}, title: null };
  const cache = app.metadataCache.getFileCache(f) || {};
  const h1 = (cache.headings || []).find(h => h.level === 1);
  return { file: f, fm: cache.frontmatter || {}, title: h1 ? h1.heading : null };
}

function peopleIn(app, folder) {
  const out = [];
  const walk = fo => fo.children.forEach(c => {
    if (c instanceof TFolder) walk(c);
    else if (c instanceof TFile && c.extension === "md") {
      const fm = (app.metadataCache.getFileCache(c) || {}).frontmatter || {};
      if (str(fm.type).toLowerCase() === "person") out.push({ file: c, name: c.basename, fm });
    }
  });
  walk(folder);
  return out;
}

const isTrue = v => v === true || /^(true|yes|oui|1)$/i.test(str(v));

function kindOf(p) {
  const c = str(p.fm.contract).toLowerCase(), s = str(p.fm.status).toLowerCase();
  if (p.name.startsWith("TBH") || s === "to hire") return "tbh";
  if (c.includes("consult") || c.includes("freelance")) return "consultant";
  if (c.includes("intern") || c.includes("apprent") || c.includes("stage")) return "intern";
  if (c.includes("fixed") || c.includes("cdd")) return "fixed";
  return null;
}

function personNode(p, isLead, opts) {
  const tbh = p.name.startsWith("TBH");
  const parts = [];
  if (opts.details.includes("role") && str(p.fm.role)) parts.push(shortRole(str(p.fm.role)));
  if (opts.details.includes("dates")) {
    const st = str(p.fm.status).toLowerCase();
    if (st === "incoming" && ddmmyy(p.fm.start_date)) parts.push(`arrives ${ddmmyy(p.fm.start_date)}`);
    if (st === "leaving" && ddmmyy(p.fm.end_date)) parts.push(`leaves ${ddmmyy(p.fm.end_date)}`);
    if (tbh && ddmmyy(p.fm.target_hire_date)) parts.push(`target ${ddmmyy(p.fm.target_hire_date)}`);
  }
  const node = mkNode({ text: tbh ? "TBH" : p.name, sub: parts.join(" · ") || null, link: p.file.path, color: null });
  // fill: not agreed with HR -> red · lead blue · open position light orange · others standard
  const hr = isTrue(p.fm[opts.hrKey || "agreed_with_hr"]);
  const k = !hr ? "nohr" : (isLead && !tbh ? "lead" : (tbh ? "tbh" : null));
  node.color = (k && opts.palette[k]) || null;
  const c = str(p.fm.contract).toLowerCase();
  if (c.includes("consult")) node.tag = { text: "Consultant", fill: opts.palette.consultant };
  else if (c.includes("freelance")) node.tag = { text: "Freelance", fill: opts.palette.consultant };
  else if (c.includes("fixed") || c.includes("cdd")) node.tag = { text: "CDD", fill: opts.palette.cdd };
  node.status = str(p.fm.status).toLowerCase();
  return node;
}

const byName = (a, b) => (a.name.startsWith("TBH") - b.name.startsWith("TBH")) || a.name.localeCompare(b.name);

// people -> nodes, nested by manager inside the group
function nest(group, opts, leadName) {
  const names = new Set(group.map(p => p.name));
  const kids = new Map();
  const top = [];
  group.forEach(p => {
    const m = linkName(p.fm.manager);
    if (m && m !== p.name && names.has(m)) { if (!kids.has(m)) kids.set(m, []); kids.get(m).push(p); }
    else top.push(p);
  });
  const seen = new Set();
  const build = p => {
    seen.add(p.name);
    const n = personNode(p, p.name === leadName, opts);
    (kids.get(p.name) || []).sort(byName).forEach(c => { if (!seen.has(c.name)) n.children.push(build(c)); });
    return n;
  };
  const res = top.sort(byName).map(build);
  group.filter(p => !seen.has(p.name)).sort(byName).forEach(p => res.push(build(p))); // manager loops
  return res;
}

function buildFromVault(app, opts) {
  const folder = app.vault.getAbstractFileByPath(opts.source);
  if (!(folder instanceof TFolder)) throw new Error(`Dossier introuvable : ${opts.source}`);
  const idx = indexOf(app, folder);
  const rootLabel = opts.root || { text: str(idx.fm.label) || idx.title || folder.name, link: idx.file ? idx.file.path : null, color: null, sub: null };
  const rootName = rootLabel.link ? linkName(rootLabel.link) : null;
  const root = mkNode(rootLabel);
  root.color = rootLabel.color;

  const teams = folder.children.filter(c => c instanceof TFolder && !c.name.startsWith("_") && !c.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name));
  root.staff = [];
  const st = { total: 0, cdi: 0, cdd: 0, intern: 0, consultant: 0, tbh: 0, arriving: 0 };
  for (const tf of teams) for (const p of peopleIn(app, tf)) {
    const c = str(p.fm.contract).toLowerCase();
    if (p.name.startsWith("TBH") || str(p.fm.status).toLowerCase() === "to hire") { st.tbh++; continue; }
    st.total++;
    if (str(p.fm.status).toLowerCase() === "incoming") st.arriving++;
    if (c.includes("consult") || c.includes("freelance")) st.consultant++;
    else if (c.includes("intern") || c.includes("apprent") || c.includes("stage")) st.intern++;
    else if (c.includes("fixed") || c.includes("cdd")) st.cdd++;
    else st.cdi++;
  }
  root.stats = st;
  for (const tf of teams) {
    const all = peopleIn(app, tf);
    const people = all.filter(p => p.name !== rootName);
    if (!people.length) continue;
    if (opts.staff && rootName && all.some(p => p.name === rootName)) {
      // the root person's own team: shown as a row just below the root, above the teams
      nest(people, opts, null).forEach(n => root.staff.push(n));
      continue;
    }
    const ti = indexOf(app, tf);
    const tlabel = str(ti.fm.label) || ti.title || tf.name.replace(/^\d+[_ -]*/, "").replace(/_/g, " ");
    const team = mkNode({ text: tlabel, link: ti.file ? ti.file.path : null, sub: null,
      color: str(ti.fm.color) || opts.palette.team || null });
    root.children.push(team);

    // Team lead: `lead:` in the team index, else the only member reporting to the root person
    const names = new Set(people.map(p => p.name));
    let leadName = linkName(ti.fm.lead);
    if (!leadName || !names.has(leadName)) {
      const toRoot = people.filter(p => rootName && linkName(p.fm.manager) === rootName);
      leadName = toRoot.length === 1 ? toRoot[0].name : null;
    }
    let parent = team, rest = people;
    if (leadName) {
      const lp = people.find(p => p.name === leadName);
      parent = personNode(lp, true, opts);
      team.children.push(parent);
      rest = people.filter(p => p !== lp);
      // members whose manager is outside the team hang under the lead
    }
    const subs = [...new Set(rest.map(p => str(p.fm.sub_team)).filter(Boolean))].sort();
    const order = Array.isArray(ti.fm.sub_teams) ? ti.fm.sub_teams.map(str) : [];
    subs.sort((a, b) => ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)) || a.localeCompare(b));
    if (subs.length > 1) {
      for (const s of subs) {
        const sn = mkNode({ text: s, link: null, sub: null, color: opts.palette.subteam });
        nest(rest.filter(p => str(p.fm.sub_team) === s), opts, leadName).forEach(n => sn.children.push(n));
        parent.children.push(sn);
      }
      nest(rest.filter(p => !str(p.fm.sub_team)), opts, leadName).forEach(n => parent.children.push(n));
    } else {
      nest(rest, opts, leadName).forEach(n => parent.children.push(n));
    }
  }
  return root;
}

// ---- Rendu ----------------------------------------------------------------
function el(parent, name, attrs, cls) {
  const e = document.createElementNS(NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (cls) e.setAttribute("class", cls);
  parent.appendChild(e);
  return e;
}
function box(svg, x, y, n, cls, onLink) {
  const extra = (n.link ? " svgtree-link" : "") + (n.status ? ` svgtree-${n.status.replace(/\s+/g, "-")}` : "");
  const g = el(svg, "g", {}, cls + extra);
  if (n.link) g.setAttribute("data-link", n.link);
  const r = el(g, "rect", { x, y, width: n.w, height: n.h, rx: 6 }, "svgtree-box");
  const mid = x + n.w / 2;
  const t = el(g, "text", { x: mid, y: n.sub ? y + 17 : y + n.h / 2, "text-anchor": "middle", "dominant-baseline": "central" });
  t.textContent = n.text;
  let t2 = null;
  if (n.sub) {
    t2 = el(g, "text", { x: mid, y: y + 34, "text-anchor": "middle", "dominant-baseline": "central" }, "svgtree-subtitle");
    t2.textContent = n.sub;
  }
  if (n.fill) {
    r.style.fill = n.fill;
    r.style.stroke = n.fill;
    const tc = contrastText(n.fill);
    if (tc) { t.style.fill = tc; if (t2) t2.style.fill = tc; }
  }
  if (n.tag) {
    const tw = textWidth(n.tag.text, 10) + 10, th = 14;
    const tx = x + n.w - tw - 6, ty = y - th / 2;
    const tr = el(g, "rect", { x: tx, y: ty, width: tw, height: th, rx: 7 }, "svgtree-tag");
    if (n.tag.fill) tr.style.fill = n.tag.fill;
    const tt = el(g, "text", { x: tx + tw / 2, y: ty + th / 2, "text-anchor": "middle", "dominant-baseline": "central" }, "svgtree-tag-text");
    tt.textContent = n.tag.text;
    if (n.tag.fill) { const c = contrastText(n.tag.fill); if (c) tt.style.fill = c; }
  }
  if (n.link) {
    g.addEventListener("click", evt => onLink(n.link, evt));
    el(g, "title", {}).textContent = n.link;
  }
}
function line(svg, d) { el(svg, "path", { d }, "svgtree-line"); }

function colWidth(n, depth = 0) {
  return Math.max(depth * INDENT + n.w, ...n.children.map(c => colWidth(c, depth + 1)));
}

function drawColumn(svg, n, x, y, onLink) {
  box(svg, x, y, n, "", onLink);
  let next = y + n.h + ROW_GAP;
  if (!n.children.length) return next;
  const trunkX = x + INDENT / 2;
  let lastMid = 0;
  for (const c of n.children) {
    lastMid = next + c.h / 2;
    line(svg, `M${trunkX} ${lastMid} H${x + INDENT}`);
    next = drawColumn(svg, c, x + INDENT, next, onLink);
  }
  line(svg, `M${trunkX} ${y + n.h} V${lastMid}`);
  return next;
}

function render(root, onLink) {
  const subs = root.children;
  const widths = subs.map(s => colWidth(s));
  const rowW = widths.reduce((a, b) => a + b, 0) + GAP_X * Math.max(0, subs.length - 1);
  const subH = Math.max(BOX_H, ...subs.map(s => s.h));
  // Staff row (root's own team): split left / right of the trunk
  const staff = root.staff || [];
  const STAFF_GAP = 26, STAFF_SEP = 16;
  const half = Math.ceil(staff.length / 2);
  const left = staff.slice(0, half), right = staff.slice(half);
  const sideW = arr => arr.reduce((a, n) => a + n.w, 0) + STAFF_SEP * Math.max(0, arr.length - 1);
  const staffSide = Math.max(sideW(left), sideW(right));
  const staffW = staff.length ? 2 * (staffSide + STAFF_GAP) : 0;
  const staffH = staff.length ? Math.max(...staff.map(n => n.h)) : 0;
  const totalW = Math.max(rowW, root.w, staffW) + 2 * MARGIN;

  const svg = document.createElementNS(NS, "svg");
  const rootX = (totalW - root.w) / 2;
  const staffY = MARGIN + root.h + GAP_Y * 0.6;
  const topH = staff.length ? staffY + staffH - MARGIN : root.h;
  const subY = MARGIN + topH + GAP_Y;
  const busY = MARGIN + topH + GAP_Y / 2;

  let x = (totalW - rowW) / 2;
  const subX = [];
  for (let i = 0; i < subs.length; i++) { subX.push(x); x += widths[i] + GAP_X; }

  let maxY = MARGIN + topH;
  if (subs.length) {
    const rootMid = totalW / 2;
    const centers = subs.map((s, i) => subX[i] + s.w / 2);
    line(svg, `M${rootMid} ${MARGIN + root.h} V${busY}`);
    const xs = [...centers, rootMid];
    line(svg, `M${Math.min(...xs)} ${busY} H${Math.max(...xs)}`);
    centers.forEach(cx => line(svg, `M${cx} ${busY} V${subY}`));
  }
  if (staff.length) {
    const mid = totalW / 2, sy = staffY + staffH / 2;
    if (!subs.length) line(svg, `M${mid} ${MARGIN + root.h} V${sy}`);
    const pos = [];
    let lx = mid - STAFF_GAP;
    left.forEach(n => { lx -= n.w; pos.push([n, lx]); lx -= STAFF_SEP; });
    let rx = mid + STAFF_GAP;
    right.forEach(n => { pos.push([n, rx]); rx += n.w + STAFF_SEP; });
    const xs = pos.map(([n, x]) => x + n.w / 2).concat([mid]);
    line(svg, `M${Math.min(...xs)} ${sy} H${Math.max(...xs)}`);
    pos.forEach(([n, x]) => box(svg, x, staffY + (staffH - n.h) / 2, n, "svgtree-staff", onLink));
  }
  box(svg, rootX, MARGIN, root, "svgtree-root", onLink);
  subs.forEach((s, i) => {
    const sx = subX[i];
    box(svg, sx, subY, s, "svgtree-sub", onLink);
    let next = subY + subH + ROW_GAP;
    if (s.children.length) {
      const trunkX = sx + INDENT / 2;
      let lastMid = 0;
      for (const c of s.children) {
        lastMid = next + c.h / 2;
        line(svg, `M${trunkX} ${lastMid} H${sx + INDENT}`);
        next = drawColumn(svg, c, sx + INDENT, next, onLink);
      }
      line(svg, `M${trunkX} ${subY + s.h} V${lastMid}`);
    }
    maxY = Math.max(maxY, next - ROW_GAP, subY + subH);
  });

  const totalH = maxY + MARGIN;
  svg.setAttribute("xmlns", NS);
  svg.setAttribute("viewBox", `0 0 ${totalW} ${totalH}`);
  svg.setAttribute("width", totalW);
  svg.setAttribute("height", totalH);
  return svg;
}

// Effectifs : total, CDI, CDD, interns, consultants, open positions
function renderStats(st, palette) {
  const items = [
    { k: "Total", v: st.total, fill: "#1f2d5c", bold: true },
    { k: "CDI", v: st.cdi, fill: "#4a6fc7" },
    { k: "CDD", v: st.cdd, fill: palette.cdd },
    { k: "Consultants", v: st.consultant, fill: palette.consultant },
    { k: "Interns", v: st.intern, fill: "#8a8a8a" },
    { k: "TBH", v: st.tbh, fill: palette.tbh },
  ];
  const H = 30, GAP = 10, svg = document.createElementNS(NS, "svg");
  let x = MARGIN;
  for (const it of items) {
    const label = `${it.k}  ${it.v}`;
    const w = textWidth(label, 13) + 22;
    const g = el(svg, "g", {}, "svgtree-stat");
    const r = el(g, "rect", { x, y: 2, width: w, height: H - 4, rx: 13 }, "svgtree-stat-box");
    r.style.fill = it.fill; r.style.stroke = it.fill;
    const t = el(g, "text", { x: x + w / 2, y: H / 2, "text-anchor": "middle", "dominant-baseline": "central" }, "svgtree-stat-text");
    t.textContent = label;
    const c = contrastText(it.fill); if (c) t.style.fill = c;
    x += w + GAP;
  }
  const note = el(svg, "text", { x: x + 4, y: H / 2, "dominant-baseline": "central" }, "svgtree-legend-text");
  note.textContent = `Total = people in post or arriving${st.arriving ? ` (incl. ${st.arriving} arriving)` : ""}; TBH = open positions`;
  x += textWidth(note.textContent, 13) + 8;
  svg.setAttribute("xmlns", NS);
  svg.setAttribute("viewBox", `0 0 ${x + MARGIN} ${H}`);
  svg.setAttribute("width", x + MARGIN);
  svg.setAttribute("height", H);
  svg.setAttribute("class", "svgtree-legend svgtree-stats");
  return svg;
}

// Légende : petits carrés de couleur + description
function renderLegend(palette) {
  const items = [
    { fill: palette.lead, text: "Team lead" },
    { fill: null, text: "Team member" },
    { fill: palette.tbh, text: "Open position" },
    { fill: palette.nohr, text: "Change not yet agreed with HR" },
    { fill: null, text: "Arriving", dashed: true },
    { fill: null, text: "Leaving", faded: true },
    { fill: palette.subteam, text: "Sub-team" },
    { tag: "CDD", fill: palette.cdd, text: "Fixed-term contract" },
    { tag: "Consultant", fill: palette.consultant, text: "Consultant / freelance" },
  ];
  const SQ = 16, GAP = 8, SEP = 22, H = 28;
  const svg = document.createElementNS(NS, "svg");
  let x = MARGIN;
  for (const it of items) {
    const g = el(svg, "g", {}, "svgtree-legend-item" + (it.faded ? " svgtree-leaving" : "") + (it.dashed ? " svgtree-incoming" : ""));
    let sw = SQ;
    if (it.tag) {
      sw = textWidth(it.tag, 10) + 10;
      const r = el(g, "rect", { x, y: (H - 14) / 2, width: sw, height: 14, rx: 7 }, "svgtree-tag");
      r.style.fill = it.fill;
      const tt = el(g, "text", { x: x + sw / 2, y: H / 2, "text-anchor": "middle", "dominant-baseline": "central" }, "svgtree-tag-text");
      tt.textContent = it.tag;
      const c = contrastText(it.fill); if (c) tt.style.fill = c;
    } else {
      const r = el(g, "rect", { x, y: (H - SQ) / 2, width: SQ, height: SQ, rx: 3 }, "svgtree-box");
      if (it.fill) { r.style.fill = it.fill; r.style.stroke = it.fill; }
    }
    const t = el(g, "text", { x: x + sw + GAP, y: H / 2, "dominant-baseline": "central" }, "svgtree-legend-text");
    t.textContent = it.text;
    x += sw + GAP + textWidth(it.text, 13) + SEP;
  }
  const W = x - SEP + MARGIN;
  svg.setAttribute("xmlns", NS);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", W);
  svg.setAttribute("height", H);
  svg.setAttribute("class", "svgtree-legend");
  return svg;
}

// ---- HR watch -------------------------------------------------------------
// Stable fingerprint of a person note: parsed properties (minus the HR flag) + body.
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") return Object.keys(v).sort().reduce((o, k) => (o[k] = stable(v[k]), o), {});
  return v;
}
function hashStr(t) { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

const DEFAULT_SETTINGS = { hrEnabled: true, hrFolder: "10_Public", hrKey: "agreed_with_hr", snaps: {} };

class IndentToSvgSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this; containerEl.empty();
    const st = this.plugin.settings;
    new Setting(containerEl).setName("HR watch")
      .setDesc("Any change to a person note (properties, text or file name) sets the HR property to false. Tick it again by hand once shared with HR.")
      .addToggle(t => t.setValue(st.hrEnabled).onChange(async v => { st.hrEnabled = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Watched folder").setDesc("Person notes (type: person) in this folder and its sub-folders.")
      .addText(t => t.setValue(st.hrFolder).onChange(async v => { st.hrFolder = v.replace(/^\/+|\/+$/g, ""); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("HR property").setDesc("Checkbox property used for the flag.")
      .addText(t => t.setValue(st.hrKey).onChange(async v => { st.hrKey = v.trim() || "agreed_with_hr"; await this.plugin.saveSettings(); }));
  }
}

// ---- Export HTML ----------------------------------------------------------
const EXPORT_CSS = `
body { margin: 16px; background: #fff; color: #222; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; }
header { display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; margin-bottom: 8px; }
header h1 { font-size: 20px; margin: 0; } header .meta { color: #777; font-size: 13px; }
header button { margin-left: auto; font: inherit; font-size: 13px; padding: 4px 10px; cursor: pointer; }
.svgtree-wrap { overflow: auto; }
.svgtree-wrap svg { display: block; margin: 0 auto; max-width: none; }
body.fit .svgtree-wrap svg:not(.svgtree-legend) { width: 100%; height: auto; }
.svgtree-wrap svg.svgtree-legend { margin: 0 0 10px 0; }
.svgtree-box { fill: #f3f3f3; stroke: #8a8a8a; stroke-width: 1.5; }
.svgtree-root .svgtree-box { fill: #1f2d5c; stroke: #1f2d5c; }
.svgtree-root text { fill: #fff; }
.svgtree-sub .svgtree-box { stroke: #4a6fc7; stroke-width: 2; }
.svgtree-wrap text { fill: #222; font-family: sans-serif; font-size: 14px; }
.svgtree-wrap text.svgtree-subtitle { font-size: 11px; opacity: .85; }
.svgtree-wrap text.svgtree-legend-text { font-size: 13px; }
.svgtree-wrap text.svgtree-stat-text { font-size: 13px; font-weight: 700; }
.svgtree-line { stroke: #8a8a8a; stroke-width: 1.5; fill: none; }
.svgtree-tag { fill: #888; }
.svgtree-wrap text.svgtree-tag-text { font-size: 10px; font-weight: 700; fill: #fff; }
.svgtree-incoming .svgtree-box { stroke-dasharray: 5 3; stroke-width: 2; }
.svgtree-leaving { opacity: .55; }
a .svgtree-box:hover { filter: brightness(1.1); stroke-width: 2.5; }
@media print { header button { display: none; } }
`;
const escHtml = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

module.exports = class IndentToSvgPlugin extends Plugin {
  // Build the tree(s) of a pbstree source (shared by the view and the export)
  buildTrees(source) {
    const { roots, opts } = parse(source);
    opts.hrKey = (this.settings && this.settings.hrKey) || "agreed_with_hr";
    const trees = opts.source ? [buildFromVault(this.app, opts)] : roots;
    applyLevelColors(trees, opts.levelColors);
    return { trees, opts };
  }

  async exportHtml(source, sourcePath) {
    try {
      const { trees, opts } = this.buildTrees(source);
      if (!trees.length) { new Notice("pbstree: nothing to export"); return; }
      const wrap = document.createElement("div");
      wrap.className = "svgtree-wrap";
      if (opts.legend === true || (opts.legend === null && opts.source)) wrap.appendChild(renderLegend(opts.palette));
      if ((opts.stats === true || (opts.stats === null && opts.source)) && trees[0] && trees[0].stats) wrap.appendChild(renderStats(trees[0].stats, opts.palette));
      trees.forEach(r => wrap.appendChild(render(r, () => {})));
      // boxes become links that open the note in Obsidian
      const vault = encodeURIComponent(this.app.vault.getName());
      wrap.querySelectorAll("g[data-link]").forEach(g => {
        const a = document.createElementNS(NS, "a");
        a.setAttribute("href", `obsidian://open?vault=${vault}&file=${encodeURIComponent(g.getAttribute("data-link"))}`);
        g.parentNode.insertBefore(a, g); a.appendChild(g);
      });
      // canvas cards give an empty sourcePath: use the file that is open (the canvas)
      if (!sourcePath) { const af = this.app.workspace.getActiveFile(); sourcePath = af ? af.path : ""; }
      const base = sourcePath.split("/").pop().replace(/\.(md|canvas)$/, "") || "OrgChart";
      const folder = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
      const title = trees[0] ? trees[0].text : base;
      const now = new Date();
      const stamp = now.toLocaleDateString("fr-FR") + " " + now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title><style>${EXPORT_CSS}</style></head>
<body><header><h1>${escHtml(title)}</h1><span class="meta">Exported ${escHtml(stamp)} from Obsidian · click a box to open the note in Obsidian</span>
<button onclick="document.body.classList.toggle('fit')">Fit to width / actual size</button></header>
${wrap.outerHTML}
</body></html>`;
      const out = (folder ? folder + "/" : "") + base + ".html";
      await this.app.vault.adapter.write(out, html);
      new Notice(`Org chart exported: ${out}`);
      if (typeof this.app.openWithDefaultApp === "function") this.app.openWithDefaultApp(out);
    } catch (err) {
      new Notice("pbstree export failed: " + err.message);
    }
  }

  async exportActive() {
    const file = this.app.workspace.getActiveFile();
    if (!file) { new Notice("Open a note or canvas containing a pbstree block"); return; }
    const raw = await this.app.vault.cachedRead(file);
    let text = raw;
    if (file.extension === "canvas") { try { text = JSON.parse(raw).nodes.map(n => n.text || "").join("\n\n"); } catch (e) {} }
    const m = text.match(/```pbstree[^\n]*\n([\s\S]*?)```/);
    if (!m) { new Notice("No pbstree block in this file"); return; }
    return this.exportHtml(m[1], file.path);
  }

  async saveSettings() { await this.saveData(this.settings); }
  saveSoon() { clearTimeout(this._saveT); this._saveT = setTimeout(() => this.saveSettings(), 1000); }

  watched(file) {
    const st = this.settings;
    if (!st.hrEnabled || !(file instanceof TFile) || file.extension !== "md") return false;
    if (st.hrFolder && !(file.path === st.hrFolder || file.path.startsWith(st.hrFolder + "/"))) return false;
    const fm = (this.app.metadataCache.getFileCache(file) || {}).frontmatter;
    return !!fm && str(fm.type).toLowerCase() === "person";
  }

  async fingerprint(file) {
    const cache = this.app.metadataCache.getFileCache(file) || {};
    const fm = { ...(cache.frontmatter || {}) };
    delete fm[this.settings.hrKey]; delete fm.position;
    const data = await this.app.vault.cachedRead(file);
    const end = cache.frontmatterPosition ? cache.frontmatterPosition.end.offset : 0;
    return hashStr(JSON.stringify(stable(fm)) + "\u0000" + data.slice(end).trim());
  }

  async unflag(file, why) {
    const key = this.settings.hrKey;
    const fm = (this.app.metadataCache.getFileCache(file) || {}).frontmatter || {};
    if (fm[key] === false) return;
    if (!isTrue(fm[key]) && key in fm) return;          // already not agreed
    await this.app.fileManager.processFrontMatter(file, f => { f[key] = false; });
    new Notice(`${file.basename}: ${why} → not agreed with HR`);
  }

  async check(file, renamedFrom) {
    if (!this.watched(file)) return;
    const snaps = this.settings.snaps;
    const prev = renamedFrom ? snaps[renamedFrom] : snaps[file.path];
    const mt = file.stat ? file.stat.mtime : 0;
    if (!renamedFrom && prev && typeof prev === "object" && prev.m === mt) return; // unchanged since last check
    const h = await this.fingerprint(file);
    const old = prev && typeof prev === "object" ? prev.h : prev;
    if (renamedFrom) delete snaps[renamedFrom];
    const changedSnap = !prev || old !== h || typeof prev !== "object" || prev.m !== mt || renamedFrom;
    snaps[file.path] = { h, m: mt };
    if (changedSnap) this.saveSoon();
    if (renamedFrom) {
      const oldBase = renamedFrom.split("/").pop().replace(/\.md$/, "");
      if (oldBase !== file.basename) return this.unflag(file, "renamed");
      // same name, other folder: a move to another team counts, a renamed team folder does not
      const oldParent = renamedFrom.slice(0, renamedFrom.lastIndexOf("/"));
      if (this.app.vault.getAbstractFileByPath(oldParent)) return this.unflag(file, "moved to another team");
      return;
    }
    if (old && old !== h) return this.unflag(file, "changed");
  }

  async startupScan() {
    // detects edits made while Obsidian was closed (or by another tool)
    const dir = this.settings.hrFolder;
    const files = this.app.vault.getMarkdownFiles().filter(f => !dir || f.path.startsWith(dir + "/"));
    for (let i = 0; i < files.length; i++) {
      await this.check(files[i]);
      if (i % 20 === 19) await new Promise(r => setTimeout(r, 0)); // keep the UI responsive
    }
  }

  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS); // usable before data is loaded
    this.addCommand({ id: "export-html", name: "Export org chart as HTML", callback: () => this.exportActive() });
    this.live = new Set(); // blocs @source affichés : { source, el, ctx, folder }
    this.registerMarkdownCodeBlockProcessor("pbstree", (source, container, mdCtx) => {
      const entry = { source, el: container, ctx: mdCtx, folder: null };
      this.draw(entry);
      if (entry.folder) this.live.add(entry);
    });
    const touch = path => {
      if (!path) return;
      for (const e of [...this.live]) {
        if (!e.el.isConnected) { this.live.delete(e); continue; }
        if (path === e.folder || path.startsWith(e.folder + "/")) this.schedule(e);
      }
    };
    this.registerEvent(this.app.metadataCache.on("changed", f => touch(f.path)));
    this.registerEvent(this.app.vault.on("delete", f => touch(f.path)));
    this.registerEvent(this.app.vault.on("create", f => touch(f.path)));
    this.registerEvent(this.app.vault.on("rename", (f, old) => { touch(f.path); touch(old); }));
    this.registerEvent(this.app.workspace.on("layout-change", () => {
      for (const e of [...this.live]) if (e.dirty) this.schedule(e);
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      for (const e of [...this.live]) if (e.dirty) this.schedule(e);
    }));

    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.snaps = this.settings.snaps || {};
    this.addSettingTab(new IndentToSvgSettings(this.app, this));
    this._chk = {};
    this.registerEvent(this.app.metadataCache.on("changed", f => {
      if (!this.watched(f)) return;
      clearTimeout(this._chk[f.path]);
      this._chk[f.path] = setTimeout(() => { delete this._chk[f.path]; this.check(f); }, 1500);
    }));
    this.registerEvent(this.app.vault.on("rename", (f, old) => { if (f instanceof TFile) setTimeout(() => this.check(f, old), 300); }));
    this.registerEvent(this.app.vault.on("delete", f => { if (this.settings.snaps[f.path]) { delete this.settings.snaps[f.path]; this.saveSoon(); } }));
    this.app.workspace.onLayoutReady(() => {
      if (this.app.metadataCache.resolved) this.startupScan();
      else { const r = this.app.metadataCache.on("resolved", () => { this.app.metadataCache.offref(r); this.startupScan(); }); this.registerEvent(r); }
    });
  }

  schedule(e) {
    clearTimeout(e.timer);
    e.timer = setTimeout(() => {
      if (!e.el.isConnected) { this.live.delete(e); return; }
      if (!e.el.offsetParent) { e.dirty = true; return; } // view not visible: redraw when it is shown
      e.dirty = false; this.draw(e);
    }, 1200);
  }

  draw(e) {
    const container = e.el;
    container.empty();
    const onLink = (target, evt) => this.app.workspace.openLinkText(target, e.ctx.sourcePath, Keymap.isModEvent(evt));
    const bar = container.createDiv({ cls: "svgtree-toolbar" });
    const btn = bar.createEl("button", { text: "Export HTML", cls: "svgtree-export-btn" });
    btn.addEventListener("click", ev => {
      ev.stopPropagation();
      // always use the plugin instance that is loaded now (an open view may still hold an older one)
      const cur = (this.app.plugins && this.app.plugins.plugins["indent-to-svg"]) || this;
      cur.exportHtml(e.source, e.ctx.sourcePath);
    });
    const wrap = container.createDiv({ cls: "svgtree-wrap" });
    try {
      const { opts } = parse(e.source);
      if (opts.source) {
        e.folder = opts.source;
        if (!this.app.metadataCache.resolved && !e.waiting) {
          e.waiting = true; // metadata cache not ready yet at Obsidian start-up
          if (!this._waitRef) {
            this._waitRef = this.app.metadataCache.on("resolved", () => {
              this.app.metadataCache.offref(this._waitRef); this._waitRef = null;
              for (const x of [...this.live]) if (x.waiting) { x.waiting = false; this.draw(x); }
            });
            this.registerEvent(this._waitRef);
          }
        }
      }
      const { trees } = this.buildTrees(e.source);
      if (!trees.length) { wrap.createDiv({ cls: "svgtree-error", text: "Liste vide." }); return; }
      if (opts.legend === true || (opts.legend === null && opts.source)) wrap.appendChild(renderLegend(opts.palette));
      if ((opts.stats === true || (opts.stats === null && opts.source)) && trees[0] && trees[0].stats) wrap.appendChild(renderStats(trees[0].stats, opts.palette));
      trees.forEach(r => wrap.appendChild(render(r, onLink)));
    } catch (err) {
      wrap.createDiv({ cls: "svgtree-error", text: "pbstree : " + err.message });
    }
  }

  onunload() {
    // remove the trees drawn by this instance so no stale button/handler survives a plugin update
    for (const k in (this._chk || {})) clearTimeout(this._chk[k]);
    for (const e of this.live) { clearTimeout(e.timer); if (e.el && e.el.isConnected) { e.el.empty(); e.el.createDiv({ cls: "svgtree-error", text: "pbstree reloaded – reopen this view." }); } }
    this.live.clear();
  }
};
