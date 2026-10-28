/* Salary dashboard – private plugin
 * Salary coeff = (responsibility coeff + adjustment coeff) × experience coeff.
 *   - experience_coeff is computed from experience_years with EXP_GRID (AUTO_EXPERIENCE_COEFF);
 *   - responsibility_coeff = role × level grid of the private index (set by hand);
 *   - adjustment_coeff is manual (default 0, can be negative).
 * Trend = regression of total pay on salary coeff. salary_coeff, trend_salary, % of trend and raises
 * are written into the private notes and recomputed automatically when a private note changes.
 * Reads the private HR notes <team>/<name> (private).md),
 * fills template.html (same folder as this file) and writes
 * Salary dashboard.html (+ Salary.md), then opens it in the browser.
 * Command: "Generate salary dashboard" · ribbon icon · ```salary-dashboard``` code block (button + cost indicator).
 */
const { Plugin, Notice, TFile } = require("obsidian");

// ---- paths (edit here if you move the folders)
const HR_DIR = "";
const PEOPLE_DIR = "engineering_hr_public/10_Persons";
const OUT = "Salary dashboard.html";
const OUT_MD = "Salary.md";
// experience coeff from experience years: [min years, coeff] (same grid as the private index)
const AUTO_EXPERIENCE_COEFF = true;
const EXP_GRID = [[0, 1.00], [2, 1.10], [4, 1.20], [7, 1.30], [11, 1.40], [16, 1.50]];
const expCoeff = y => { if (y == null) return null; let c = EXP_GRID[0][1]; for (const [m, v] of EXP_GRID) if (y >= m) c = v; return c; };
// the coeff properties are kept on consecutive lines in each private note, in this order
const COEFFS = ["experience_years", "experience_coeff", "responsibility_role", "responsibility_coeff", "adjustment_coeff", "salary_coeff"];
const grouped = keys => { const ks = keys.filter(x => COEFFS.includes(x)), i = keys.indexOf(ks[0]);
  return ks.every((x, j) => keys[i + j] === x) && ks.join() === COEFFS.filter(x => keys.includes(x)).join(); };
function regroup(x) {  // rebuilds the frontmatter object: coeff block where the first coeff was
  const keys = Object.keys(x), first = keys.findIndex(k => COEFFS.includes(k)); if (first < 0) return;
  const entries = keys.map(k => [k, x[k]]); for (const k of keys) delete x[k];
  entries.forEach(([k, v], i) => {
    if (i === first) for (const c of COEFFS) if (c in Object.fromEntries(entries)) x[c] = Object.fromEntries(entries)[c];
    if (!COEFFS.includes(k)) x[k] = v;
  });
}
// responsibility roles without level: "Engineer (senior)" -> "Engineer", "Team lead (mid) + architect" -> "Team lead + architect"
const cleanRole = r => r == null ? r : String(r).replace(/\s*\((junior|mid|senior|expert)\)/gi, "").replace(/\s+/g, " ").trim();
const INPUTS = ["experience_years", "experience_coeff", "responsibility_coeff", "adjustment_coeff", "salary_fixe", "bonus", "type"];
// optional display names per team folder; otherwise derived from the folder name ("02_Team_Alpha" -> "Team Alpha")
const TEAM = {
  "01_Satellite architecture": "Satellite architecture", "02_SE_Modeling_and_Simulation": "SE Modeling & Simulation",
  "03_System_Engineering_Design": "SE Design", "04_E2E_V&V": "E2E V&V", "05_Propulsion": "Propulsion",
  "06_Structure_Architecture": "Structure Architecture", "07_Mech_Thermal_CoC": "Mech & Thermal CoC",
  "08_Electrical_Power_RF": "Electrical Power RF", "09_Robotics_Mechanisms": "Robotics & Mechanisms",
};

const num = v => (v === "" || v == null || isNaN(+v)) ? null : +v;
const str = v => (v == null || v === "") ? null : String(v);
const pad = n => String(n).padStart(2, "0");
const iso = v => {
  if (v == null || v === "") return null;
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  const m = String(v).match(/\d{4}-\d{2}-\d{2}/); return m ? m[0] : null;
};
const years = s => { if (!s) return null; const d = new Date(s); return isNaN(d) ? null : Math.max(0, Math.round((Date.now() - d) / (365.25 * 864e5) * 100) / 100); };
const k = v => (v / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 }) + " k€";

module.exports = class SalaryDashboard extends Plugin {
  async onload() {
    this.addCommand({ id: "generate", name: "Generate salary dashboard", callback: () => this.generate(true) });
    this.addRibbonIcon("bar-chart-2", "Generate salary dashboard", () => this.generate(true));
    this.registerMarkdownCodeBlockProcessor("salary-dashboard", (src, el) => this.renderBlock(el));
    // automatic recompute: when a coeff, the experience or the pay changes in a private note
    this._sig = new Map();
    this.registerEvent(this.app.metadataCache.on("changed", f => {
      if (this._writing || !f.basename.endsWith(" (private)")) return;
      const fm = this.fm(f); if (fm.type !== "private-hr") return;
      const sig = JSON.stringify(INPUTS.map(x => fm[x] ?? null));
      if (this._sig.get(f.path) === sig) return;           // only computed fields changed
      this._sig.set(f.path, sig);
      clearTimeout(this._t); this._t = setTimeout(() => this.recompute(true), 1500);
    }));
    this.app.workspace.onLayoutReady(() => setTimeout(() => this.recompute(false), 3000));
    // self-reload: when main.js is updated on disk, reload the plugin so the new code is used without restarting Obsidian
    const me = `${this.manifest.dir}/main.js`, adapter = this.app.vault.adapter;
    try { this._mt = (await adapter.stat(me))?.mtime; } catch (e) { }
    this.registerInterval(window.setInterval(async () => {
      try {
        const mt = (await adapter.stat(me))?.mtime;
        if (mt && this._mt && mt !== this._mt) {
          this._mt = mt; const id = this.manifest.id, plugins = this.app.plugins;
          new Notice("Salary dashboard plugin updated – reloading");
          await plugins.disablePlugin(id); await plugins.enablePlugin(id);
        }
      } catch (e) { }
    }, 5000));
  }

  fm(file) { return (this.app.metadataCache.getFileCache(file) || {}).frontmatter || {}; }

  collect() {
    this._files = new Map();
    const files = this.app.vault.getMarkdownFiles().filter(f => (!HR_DIR || f.path.startsWith(HR_DIR + "/")) && f.basename.endsWith(" (private)"));
    const out = [];
    for (const f of files) {
      const fm = this.fm(f);
      if (fm.type !== "private-hr") continue;
      const note = f.basename.replace(/ \(private\)$/, "");
      const rel = f.parent && f.parent.path !== "/" ? f.parent.path : "";
      const folder = HR_DIR ? rel.replace(new RegExp("^" + HR_DIR + "/?"), "") : rel;   // e.g. 01_System_Architecture/02_SE_...
      const tname = folder.split("/").pop();
      // contract, status, role and start date come from the public person note
      const pf = this.app.vault.getAbstractFileByPath(`${PEOPLE_DIR}/${folder ? folder + "/" : ""}${note}.md`);
      const pub = pf instanceof TFile ? this.fm(pf) : {};
      const c = (str(pub.contract) || "").toLowerCase(), s = (str(pub.status) || "").toLowerCase();
      const r = (str(pub.role) || "").toLowerCase();
      const intern = /intern|apprentic|stage/.test(c) || /\bintern\b/.test(r);
      const fixed = /fixed|cdd/.test(c);
      if (!intern && !fixed && /consult|freelance/.test(c)) continue;          // not on the payroll
      const contract = intern ? "Intern" : fixed ? "CDD" : "CDI";
      const status = s === "to hire" || note.startsWith("TBH") ? "open" : s === "incoming" ? "arriving" : "active";
      const job = str(fm.job_title) || str(pub.role) || "";
      let start = iso(fm.seniority_date), senSrc = start ? "private note" : null;
      if (!start) { start = iso(pub.start_date); if (start) senSrc = "start_date (person note)"; }
      this._sig.set(f.path, JSON.stringify(INPUTS.map(x => fm[x] ?? null)));
      const exp = num(fm.experience_years);
      const ec = AUTO_EXPERIENCE_COEFF && exp != null ? expCoeff(exp) : num(fm.experience_coeff);
      const resp = num(fm.responsibility_coeff), adj = num(fm.adjustment_coeff) || 0;
      this._files = this._files || new Map(); this._files.set(note, f);
      out.push({
        name: status === "open" ? `Open: ${job || note.replace(/^TBH - /, "")}` : note, note,
        team: TEAM[tname] || tname.replace(/^\d+[-\d]*_/, "").replace(/^0[A-Z]_/, "").replace(/_/g, " ") || "—", folder, job,
        contract, status, exp,
        fixe: num(fm.salary_fixe), bonus: num(fm.bonus),
        senSrc, start, sen: years(start), ec, resp, adj, respRole: cleanRole(str(fm.responsibility_role)),
        sc: ec && resp ? Math.round((resp + adj) * ec * 1e4) / 1e4 : null, lastRaise: iso(fm.last_raise_date),
      });
    }
    return out.sort((a, b) => a.folder.localeCompare(b.folder) || a.note.localeCompare(b.note));
  }

  // same rule as the dashboard: trend = regression of total pay (fixe + bonus) on salary coeff (CDI + CDD, open positions and interns excluded)
  budget(data) {
    const pop = data.filter(d => d.status !== "open" && d.contract !== "Intern" && d.fixe != null);
    const pts = pop.filter(d => d.sc), tot = d => d.fixe + (d.bonus || 0);
    const mx = pts.reduce((s, d) => s + d.sc, 0) / pts.length, my = pts.reduce((s, d) => s + tot(d), 0) / pts.length;
    const den = pts.reduce((s, d) => s + (d.sc - mx) ** 2, 0);
    const b = den ? pts.reduce((s, d) => s + (d.sc - mx) * (tot(d) - my), 0) / den : 0, a = my - b * mx;
    const r = { s95: 0, s100: 0, n95: 0, n100: 0, a, b, rows: [] };
    const up = (ref, d, p) => Math.max(0, Math.round((p * ref - tot(d)) / 100) * 100);
    for (const d of pts) {
      const ref = a + b * d.sc, r95 = up(ref, d, .95), r100 = up(ref, d, 1);
      if (r95 > 0) { r.s95 += r95; r.n95++; } if (r100 > 0) { r.s100 += r100; r.n100++; }
      r.rows.push({ d, ref, tot: tot(d), pct: tot(d) / ref, r95, r100 });
    }
    r.rows.sort((x, y) => x.pct - y.pct);
    return r;
  }

  salaryMd(data, b, gen) {
    const e = v => Math.round(v).toLocaleString("fr-FR").replace(/\u202f|\u00a0/g, " ") + " €";
    const raise = (v, d) => v > 0 ? `+${e(v)} (+${(100 * v / d.fixe).toFixed(1)} %)` : "—";
    const link = d => `[[${d.note} (private)\\|${d.note}]]`;
    const below = b.rows.filter(x => x.r100 > 0);
    const payroll = b.rows.reduce((s, x) => s + x.tot, 0);
    const pct = v => (100 * v / payroll).toFixed(1) + " %";
    const CAP = 0.10; // max raise = 10 % of current fixe (rounded down to 100 €)
    const capped = x => Math.min(x.r100, Math.floor(CAP * x.d.fixe / 100) * 100);
    const sCap = below.reduce((s, x) => s + capped(x), 0);
    const nCapped = below.filter(x => capped(x) < x.r100).length;
    let md = `---\ntype: private-hr-report\ngenerated: ${gen}\ncssclasses:\n  - wide-page\ntags:\n  - private\n---\n`
      + `# 🔒 Salary – raises to reach the trend\n\n`
      + `> [!warning] Generated by the *Salary dashboard* plugin on ${gen} – do not edit, it is overwritten at each generation.\n\n`
      + `**Trend** = average total pay (**fixe + bonus**) for the same salary coeff ((responsibility coeff + adjustment coeff) × experience coeff), regression on CDI + CDD in post or arriving (interns and open positions excluded): `
      + `trend = ${e(b.a)} + ${e(b.b)} × salary coeff. Raises are added to the fixe and rounded to 100 €; raise % is vs the current fixe. *Capped 10 %* = raise to 100 % of trend limited to 10 % of the current fixe, with the resulting % of trend.\n\n`
      + `## Summary\n\n| Goal | People | Total raise (fixe / year) | % of payroll |\n|---|---|---|---|\n`
      + [["100 % of trend", b.n100, b.s100]].map(([g, n, s]) => `| ${g} | ${n} | **${e(s)}** | ${pct(s)} |`).join("\n")
      + `\n| 100 % of trend, raise capped at 10 % | ${below.length} (${nCapped} capped) | **${e(sCap)}** | ${pct(sCap)} |`
      + `\n\nPayroll (fixe + bonus) of the ${b.rows.length} people in the model: ${e(payroll)}.\n\n`
      + `## People below the trend (${below.length})\n\n`
      + `| Person | Team | Role | Salary coeff | Fixe | Bonus | Fixe + bonus | Trend | % of trend | Raise → 100 % | Raise → 100 % capped 10 % | → % of trend |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n`
      + below.map(x => `| ${link(x.d)} | ${x.d.team} | ${x.d.respRole || "—"} | ${x.d.sc.toFixed(2)} | ${e(x.d.fixe)} | ${x.d.bonus ? e(x.d.bonus) : "—"} | ${e(x.tot)} | ${e(x.ref)} | ${Math.round(100 * x.pct)} % | ${raise(x.r100, x.d)} | ${raise(capped(x), x.d)}${capped(x) < x.r100 ? " ⚠" : ""} | ${Math.round(100 * (x.tot + capped(x)) / x.ref)} % |`).join("\n")
      + `\n| **Total** | | | | | | | | | **${e(b.s100)}** | **${e(sCap)}** | |\n`;
    const above = b.rows.filter(x => x.r100 === 0);
    md += `\n## At or above the trend (${above.length})\n\n| Person | Team | Fixe | Bonus | Fixe + bonus | Trend | % of trend |\n|---|---|---|---|---|---|---|\n`
      + above.sort((x, y) => y.pct - x.pct).map(x => `| ${link(x.d)} | ${x.d.team} | ${e(x.d.fixe)} | ${x.d.bonus ? e(x.d.bonus) : "—"} | ${e(x.tot)} | ${e(x.ref)} | ${Math.round(100 * x.pct)} % |`).join("\n") + "\n";
    const missing = data.filter(d => d.status !== "open" && d.contract !== "Intern" && (d.fixe == null || !d.sc));
    if (missing.length) md += `\n## Not in the model (${missing.length})\nMissing salary, experience coeff or responsibility coeff: ${missing.map(link).join(", ")}.\n`;
    return md;
  }

  // writes the computed fields into each private note (read by the Bases tables):
  // experience_coeff (if automatic), salary_coeff, trend_salary, % of trend, raises; adds adjustment_coeff: 0 if missing
  async writeRaises(data, b) {
    const trend = new Map(b.rows.map(x => [x.d.note, {
      trend_salary: Math.round(x.ref / 100) * 100, pct_of_trend: Math.round(100 * x.pct), raise_to_100: x.r100 }]));
    const TKEYS = ["trend_salary", "pct_of_trend", "raise_to_100"], OLD = ["raise_to_90", "raise_to_95"];
    let n = 0;
    this._writing = true;
    try {
      for (const d of data) {
        const f = this._files && this._files.get(d.note); if (!f) continue;
        const fm = this.fm(f), t = trend.get(d.note) || null;
        const want = { salary_coeff: d.sc };
        if (AUTO_EXPERIENCE_COEFF && d.ec != null) want.experience_coeff = d.ec;
        for (const key of TKEYS) want[key] = t ? t[key] : undefined;
        const empty = v => v === undefined || v === null || v === "";
        const same = Object.entries(want).every(([key, v]) => empty(v) ? empty(fm[key]) : fm[key] === v)
          && ("adjustment_coeff" in fm) && OLD.every(key => !(key in fm)) && grouped(Object.keys(fm))
          && (fm.responsibility_role == null || fm.responsibility_role === cleanRole(fm.responsibility_role));
        if (same) continue;
        await this.app.fileManager.processFrontMatter(f, x => {
          if (!("adjustment_coeff" in x)) x.adjustment_coeff = 0;
          for (const [key, v] of Object.entries(want)) { if (empty(v)) delete x[key]; else x[key] = v; }
          for (const key of OLD) delete x[key];
          if (x.responsibility_role != null) x.responsibility_role = cleanRole(x.responsibility_role);
          regroup(x);
        });
        n++;
      }
    } finally { setTimeout(() => { this._writing = false; }, 2000); }
    return n;
  }

  // silent recompute (no browser): notes + Salary.md + dashboard file
  async recompute(notify) {
    try {
      const data = this.collect(); if (!data.length) return;
      const b = this.budget(data);
      const n = await this.writeRaises(data, b);
      if (!n) return;
      const now = new Date(), gen = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
      await this.app.vault.adapter.write(OUT_MD, this.salaryMd(data, b, gen));
      const tpl = await this.app.vault.adapter.read(`${this.manifest.dir}/template.html`);
      await this.app.vault.adapter.write(OUT, tpl.replace("__DATA__", () => JSON.stringify(data)).replace("__GEN__", () => gen));
      this.lastGen = gen;
      document.querySelectorAll(".salary-dashboard-block").forEach(el => this.renderBlock(el));
      if (notify) new Notice(`Trend salary recomputed (${n} private notes updated)`, 4000);
    } catch (e) { console.error(e); }
  }

  async generate(open) {
    try {
      const data = this.collect();
      if (!data.length) { new Notice("Salary dashboard: no private HR note found in " + (HR_DIR || "vault root")); return; }
      const tpl = await this.app.vault.adapter.read(`${this.manifest.dir}/template.html`);
      const now = new Date(), gen = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
      const html = tpl.replace("__DATA__", () => JSON.stringify(data)).replace("__GEN__", () => gen);
      await this.app.vault.adapter.write(OUT, html);
      const b = this.budget(data);
      await this.app.vault.adapter.write(OUT_MD, this.salaryMd(data, b, gen));
      const n = await this.writeRaises(data, b);
      new Notice(`Salary dashboard + Salary.md generated (${data.length} people, ${n} notes updated).\nCost to 100 % of trend: ${k(b.s100)} (${b.n100})`, 8000);
      this.lastGen = gen;
      document.querySelectorAll(".salary-dashboard-block").forEach(el => this.renderBlock(el));
      if (open && typeof this.app.openWithDefaultApp === "function") this.app.openWithDefaultApp(OUT);
    } catch (e) {
      console.error(e); new Notice("Salary dashboard: generation failed – " + e.message, 8000);
    }
  }

  renderBlock(el) {
    el.empty(); el.addClass("salary-dashboard-block");
    const box = el.createDiv({ attr: { style: "border:1px solid var(--background-modifier-border);border-radius:8px;padding:10px 12px;display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center" } });
    const btn = box.createEl("button", { text: "⟳ Generate & open salary dashboard", cls: "mod-cta" });
    btn.onclick = () => this.generate(true);
    let data = []; try { data = this.collect(); } catch (e) { }
    if (data.length) {
      const b = this.budget(data);
      const s = box.createDiv({ attr: { style: "font-size:13px" } });
      s.createSpan({ text: "Cost to 100 % of trend: " }); s.createEl("b", { text: k(b.s100) }); s.createSpan({ text: ` (${b.n100} people)` });
      box.createDiv({ text: `${data.length} private notes${this.lastGen ? " · last generated " + this.lastGen : ""}`, attr: { style: "font-size:12px;color:var(--text-muted)" } });
    }
  }
};
