/* Salary dashboard – private plugin
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
      const folder = f.parent && f.parent.path !== (HR_DIR || "/") ? f.parent.name : "";
      // contract, status, role and start date come from the public person note
      const pf = this.app.vault.getAbstractFileByPath(`${PEOPLE_DIR}/${folder}/${note}.md`);
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
      const ec = num(fm.experience_coeff), resp = num(fm.responsibility_coeff);
      this._files = this._files || new Map(); this._files.set(note, f);
      out.push({
        name: status === "open" ? `Open: ${job || note.replace(/^TBH - /, "")}` : note, note,
        team: TEAM[folder] || folder.replace(/^\d+[-\d]*_/, "").replace(/_/g, " ") || "—", folder, job,
        contract, status, exp: num(fm.experience_years),
        fixe: num(fm.salary_fixe), bonus: num(fm.bonus),
        senSrc, start, sen: years(start), ec, resp, respRole: str(fm.responsibility_role),
        sc: ec && resp ? Math.round(ec * resp * 1e4) / 1e4 : null, lastRaise: iso(fm.last_raise_date),
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
      + `**Trend** = average total pay (**fixe + bonus**) for the same salary coeff (experience coeff × responsibility coeff), regression on CDI + CDD in post or arriving (interns and open positions excluded): `
      + `trend = ${e(b.a)} + ${e(b.b)} × salary coeff. Raises are added to the fixe and rounded to 100 €; raise % is vs the current fixe. *Capped 10 %* = raise to 100 % of trend limited to 10 % of the current fixe, with the resulting % of trend.\n\n`
      + `## Summary\n\n| Goal | People | Total raise (fixe / year) | % of payroll |\n|---|---|---|---|\n`
      + [["95 % of trend", b.n95, b.s95], ["100 % of trend", b.n100, b.s100]].map(([g, n, s]) => `| ${g} | ${n} | **${e(s)}** | ${pct(s)} |`).join("\n")
      + `\n| 100 % of trend, raise capped at 10 % | ${below.length} (${nCapped} capped) | **${e(sCap)}** | ${pct(sCap)} |`
      + `\n\nPayroll (fixe + bonus) of the ${b.rows.length} people in the model: ${e(payroll)}.\n\n`
      + `## People below the trend (${below.length})\n\n`
      + `| Person | Team | Role | Salary coeff | Fixe | Bonus | Fixe + bonus | Trend | % of trend | Raise → 95 % | Raise → 100 % | Raise → 100 % capped 10 % | → % of trend |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`
      + below.map(x => `| ${link(x.d)} | ${x.d.team} | ${x.d.respRole || "—"} | ${x.d.sc.toFixed(2)} | ${e(x.d.fixe)} | ${x.d.bonus ? e(x.d.bonus) : "—"} | ${e(x.tot)} | ${e(x.ref)} | ${Math.round(100 * x.pct)} % | ${raise(x.r95, x.d)} | ${raise(x.r100, x.d)} | ${raise(capped(x), x.d)}${capped(x) < x.r100 ? " ⚠" : ""} | ${Math.round(100 * (x.tot + capped(x)) / x.ref)} % |`).join("\n")
      + `\n| **Total** | | | | | | | | | **${e(b.s95)}** | **${e(b.s100)}** | **${e(sCap)}** | |\n`;
    const above = b.rows.filter(x => x.r100 === 0);
    md += `\n## At or above the trend (${above.length})\n\n| Person | Team | Fixe | Bonus | Fixe + bonus | Trend | % of trend |\n|---|---|---|---|---|---|---|\n`
      + above.sort((x, y) => y.pct - x.pct).map(x => `| ${link(x.d)} | ${x.d.team} | ${e(x.d.fixe)} | ${x.d.bonus ? e(x.d.bonus) : "—"} | ${e(x.tot)} | ${e(x.ref)} | ${Math.round(100 * x.pct)} % |`).join("\n") + "\n";
    const missing = data.filter(d => d.status !== "open" && d.contract !== "Intern" && (d.fixe == null || !d.sc));
    if (missing.length) md += `\n## Not in the model (${missing.length})\nMissing salary, experience coeff or responsibility coeff: ${missing.map(link).join(", ")}.\n`;
    return md;
  }

  // writes trend / % of trend / raises into each private note so that the index tables (Bases) can show them
  async writeRaises(data, b) {
    const val = new Map(b.rows.map(x => [x.d.note, {
      trend_salary: Math.round(x.ref / 100) * 100, pct_of_trend: Math.round(100 * x.pct), raise_to_95: x.r95, raise_to_100: x.r100 }]));
    const KEYS = ["trend_salary", "pct_of_trend", "raise_to_95", "raise_to_100"], OLD = ["raise_to_90"];
    let n = 0;
    for (const d of data) {
      const f = this._files && this._files.get(d.note); if (!f) continue;
      const v = val.get(d.note) || null, fm = this.fm(f);
      const same = KEYS.every(key => v ? fm[key] === v[key] : (fm[key] === undefined || fm[key] === null || fm[key] === ""));
      if (same && OLD.every(key => !(key in fm))) continue;
      await this.app.fileManager.processFrontMatter(f, x => { for (const key of KEYS) { if (v) x[key] = v[key]; else delete x[key]; } for (const key of OLD) delete x[key]; });
      n++;
    }
    return n;
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
      new Notice(`Salary dashboard + Salary.md generated (${data.length} people, ${n} notes updated).\nCost to 95 % of trend: ${k(b.s95)} (${b.n95})\nCost to 100 % of trend: ${k(b.s100)} (${b.n100})`, 8000);
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
      s.createSpan({ text: "Cost to 95 % of trend: " }); s.createEl("b", { text: k(b.s95) }); s.createSpan({ text: ` (${b.n95} people) · to 100 %: ` });
      s.createEl("b", { text: k(b.s100) }); s.createSpan({ text: ` (${b.n100})` });
      box.createDiv({ text: `${data.length} private notes${this.lastGen ? " · last generated " + this.lastGen : ""}`, attr: { style: "font-size:12px;color:var(--text-muted)" } });
    }
  }
};
