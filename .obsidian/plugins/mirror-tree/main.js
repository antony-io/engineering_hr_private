/* Mirror tree – keeps the private team tree (vault root) and engineering_hr_public/10_Public in step.
 *   10_Public/<team>/<Name>.md  ↔  <team>/<Name> (private).md
 *   10_Public/<team>/           ↔  <team>/
 * Creating, renaming or moving a note / folder on one side does the same on the other side.
 * 00_Index.md keeps its name on both sides. Root private notes (Salary.md…) and non-.md files
 * (canvas, base, attachments) are never mirrored. Deletions are never mirrored.
 * Renames brought by git in the submodule (pull, checkout…) reach Obsidian as delete + create:
 * they are replayed on the private tree from `git diff -M` between the last seen commit and HEAD.
 * On startup, missing private notes are created and private-only notes are reported.
 */
const { Plugin, Notice, TFolder } = require("obsidian");

const SUBMODULE = "engineering_hr_public";
const PUBLIC_DIR = "10_Public"; // inside the submodule
const PUBLIC_ROOT = SUBMODULE + "/" + PUBLIC_DIR;
const SUFFIX = " (private)";
const SAME_NAME = new Set(["00_Index"]);
const DEBOUNCE_MS = 300;
const GIT_RECHECK_MS = 5000; // git moves HEAD after writing the files: look again once the burst is over

const split = p => { const i = p.lastIndexOf("/"); return i < 0 ? ["", p] : [p.slice(0, i), p.slice(i + 1)]; };
const join = (dir, name) => (dir ? dir + "/" + name : name);
const depth = p => p.split("/").length;
const isFolder = f => f instanceof TFolder;
// empty notes / folders, i.e. what this plugin creates and nobody has filled in yet
const isBlank = f => (isFolder(f) ? f.children.every(isBlank) : f.extension === "md" && f.stat.size === 0);

// public path → private path, null outside 10_Public
function toPrivate(path, folder) {
  if (!path.startsWith(PUBLIC_ROOT + "/")) return null;
  const rel = path.slice(PUBLIC_ROOT.length + 1);
  if (folder) return rel;
  if (!rel.endsWith(".md")) return null;
  const [dir, name] = split(rel.slice(0, -3));
  return join(dir, SAME_NAME.has(name) ? name : name + SUFFIX) + ".md";
}

// private path → public path, null for the submodule, root private notes and non-.md files
function toPublic(path, folder) {
  const top = path.split("/")[0];
  if (!top || top === SUBMODULE || top.startsWith(".")) return null;
  if (folder) return PUBLIC_ROOT + "/" + path;
  if (!path.endsWith(".md")) return null;
  const [dir, name] = split(path.slice(0, -3));
  if (!dir && !SAME_NAME.has(name)) return null;
  return PUBLIC_ROOT + "/" + join(dir, name.endsWith(SUFFIX) ? name.slice(0, -SUFFIX.length) : name) + ".md";
}

const mirror = (path, folder) => toPrivate(path, folder) ?? toPublic(path, folder);

// private note path with its " (private)" suffix restored, null when there is nothing to fix
function withSuffix(path) {
  if (!toPublic(path, false)) return null;
  const [dir, name] = split(path.slice(0, -3));
  if (SAME_NAME.has(name) || name.endsWith(SUFFIX)) return null;
  return join(dir, name + SUFFIX) + ".md";
}

// `git diff -M --name-status -z` → [{ from, to }] vault paths of the renamed files
function parseRenames(out) {
  const t = out.split("\0"), renames = [];
  for (let i = 0; i < t.length && t[i];) {
    const status = t[i];
    if (status[0] === "R" || status[0] === "C") {
      if (status[0] === "R") renames.push({ from: SUBMODULE + "/" + t[i + 1], to: SUBMODULE + "/" + t[i + 2] });
      i += 3;
    } else i += 2;
  }
  return renames;
}

// renamed folders: drop the common trailing segments ("A/sub" → "B/sub" is "A" → "B")
function folderRenames(renames) {
  const pairs = new Map();
  for (const { from, to } of renames) {
    const a = split(from)[0].split("/"), b = split(to)[0].split("/");
    while (a.length && b.length && a[a.length - 1] === b[b.length - 1]) { a.pop(); b.pop(); }
    if (a.length && b.length) pairs.set(a.join("/"), b.join("/"));
  }
  return [...pairs].sort((x, y) => depth(x[0]) - depth(y[0]));
}

module.exports = class MirrorTreePlugin extends Plugin {
  async onload() {
    this.pending = [];
    this.mine = new Set(); // paths being created / renamed by the plugin itself
    this.queue = Promise.resolve();
    this.data = Object.assign({ lastHead: null }, await this.loadData());
    // registered once the vault is loaded, otherwise every existing file fires "create"
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.vault.on("create", file => this.push({ file, path: file.path })));
      this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.push({ file, path: file.path, oldPath })));
      this.run(() => this.applyGitRenames());
      this.run(() => this.syncToPrivate(false));
    });
    this.addCommand({ id: "sync-to-private", name: "Create missing private notes (from 10_Public)", callback: () => this.run(() => this.syncToPrivate(true)) });
    this.addCommand({ id: "sync-to-public", name: "Create missing public notes (from the private tree)", callback: () => this.run(() => this.syncToPublic()) });
    this.addCommand({ id: "git-renames", name: "Replay renames from the git history of 10_Public", callback: () => this.run(() => this.applyGitRenames(true)) });
  }

  onunload() { clearTimeout(this.timer); clearTimeout(this.gitTimer); }

  // a folder rename fires one event per child: batch the burst, then handle parents before children
  push(event) {
    // events of our own changes are no-ops: drop them rather than handle them late, against a newer tree
    if ([...this.mine].some(p => event.path === p || event.path.startsWith(p + "/"))) return;
    this.pending.push(event);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const batch = this.pending.splice(0).sort((a, b) => depth(a.oldPath ?? a.path) - depth(b.oldPath ?? b.path));
      this.run(async () => {
        await this.applyGitRenames(); // before the creates, so that a renamed note is not doubled by an empty one
        for (const e of batch) await (e.oldPath === undefined ? this.onCreate(e.file) : this.onRename(e.file, e.path, e.oldPath));
      });
      if (batch.some(e => e.path.startsWith(PUBLIC_ROOT + "/"))) {
        clearTimeout(this.gitTimer);
        this.gitTimer = setTimeout(() => this.run(() => this.applyGitRenames()), GIT_RECHECK_MS);
      }
    }, DEBOUNCE_MS);
  }

  run(job) {
    this.queue = this.queue.then(job).catch(err => { console.error("mirror-tree:", err); new Notice("Mirror tree: " + err.message); });
    return this.queue;
  }

  get(path) { return this.app.vault.getAbstractFileByPath(path); }

  async own(path, op) {
    this.mine.add(path);
    try { await op(); } finally { this.mine.delete(path); }
  }

  rename(file, path) { return this.own(path, () => this.app.fileManager.renameFile(file, path)); }

  async ensureFolder(path) {
    if (!path || this.get(path)) return;
    await this.ensureFolder(split(path)[0]);
    await this.own(path, () => this.app.vault.createFolder(path));
  }

  // creates the (empty) counterpart of a note / folder when it is missing; true if created
  async createMirror(path, folder) {
    const target = mirror(path, folder);
    if (!target || this.get(target)) return false;
    if (folder) await this.ensureFolder(target);
    else { await this.ensureFolder(split(target)[0]); await this.own(target, () => this.app.vault.create(target, "")); }
    return true;
  }

  async onCreate(file) {
    if (this.get(file.path) !== file) return; // deleted since
    await this.createMirror(file.path, isFolder(file));
  }

  async onRename(file, path, oldPath) {
    const folder = isFolder(file);
    const target = mirror(path, folder), oldTarget = mirror(oldPath, folder);
    const counterpart = oldTarget && this.get(oldTarget);
    if (target && !this.get(target)) {
      if (counterpart) { await this.ensureFolder(split(target)[0]); await this.rename(counterpart, target); }
      else if (this.get(path) === file) await this.createMirror(path, folder); // moved into the mirrored tree
    }
    // a private note renamed without its suffix gets it back
    const fixed = !folder && this.get(path) === file && withSuffix(path);
    if (fixed && !this.get(fixed)) await this.rename(file, fixed);
  }

  git(...args) {
    const { execFile } = require("child_process"); // desktop only: throws on mobile
    const cwd = this.app.vault.adapter.getBasePath() + "/" + SUBMODULE;
    return new Promise((resolve, reject) =>
      execFile("git", ["-C", cwd, ...args], { maxBuffer: 1 << 24 }, (err, out) => (err ? reject(err) : resolve(out))));
  }

  async applyGitRenames(manual = false) {
    let head;
    try { head = (await this.git("rev-parse", "HEAD")).trim(); }
    catch (err) { if (manual) new Notice("Mirror tree: git is not available (" + err.message + ")"); return; }
    const last = this.data.lastHead;
    if (last === head) { if (manual) new Notice("Mirror tree\nNo new commit in " + SUBMODULE + "."); return; }
    let renames = [];
    if (last) {
      try { renames = parseRenames(await this.git("diff", "-M", "--name-status", "-z", last, head, "--", PUBLIC_DIR)); }
      catch (err) { console.warn("mirror-tree: cannot diff " + last + ".." + head, err); } // last commit rebased away…
    }
    const moved = await this.replayRenames(renames);
    this.data.lastHead = head;
    await this.saveData(this.data);
    if (moved || manual) new Notice(`Mirror tree\n${moved} private note(s) / folder(s) renamed after a git update of ${PUBLIC_DIR}.`, 10000);
  }

  // frees a path for a rename: true when nothing is there, or only blank notes (sent to the trash)
  async free(path) {
    const f = this.get(path);
    if (!f) return true;
    if (!isBlank(f)) return false;
    await this.app.vault.trash(f, true);
    return true;
  }

  async replayRenames(renames) {
    let moved = 0;
    const folderMoves = [];
    const relocate = p => { for (const [a, b] of folderMoves) if (p === a || p.startsWith(a + "/")) p = b + p.slice(a.length); return p; };
    // whole folder first when the public one is gone, so that its private-only files follow
    for (const [from, to] of folderRenames(renames)) {
      const a = toPrivate(from, true), b = toPrivate(to, true);
      if (!a || !b || await this.app.vault.adapter.exists(from)) continue; // on disk: Obsidian may not have seen the deletion yet
      const src = this.get(relocate(a));
      if (!src || !isFolder(src) || src.path === b || !await this.free(b)) continue;
      const old = src.path;
      await this.ensureFolder(split(b)[0]);
      await this.rename(src, b);
      folderMoves.push([old, b]);
      moved++;
    }
    for (const { from, to } of renames) {
      const a = toPrivate(from, false), b = toPrivate(to, false);
      if (!a || !b) continue;
      const src = this.get(relocate(a));
      if (!src || isFolder(src) || src.path === b || !await this.free(b)) continue;
      await this.ensureFolder(split(b)[0]);
      await this.rename(src, b);
      moved++;
    }
    return moved;
  }

  allFiles() { return this.app.vault.getAllLoadedFiles().slice().sort((a, b) => depth(a.path) - depth(b.path)); }

  async syncToPrivate(manual) {
    let created = 0;
    for (const f of this.allFiles()) if (toPrivate(f.path, isFolder(f)) && await this.createMirror(f.path, isFolder(f))) created++;
    const orphans = this.allFiles().filter(f => { const t = toPublic(f.path, isFolder(f)); return t && !this.get(t); }).map(f => f.path);
    if (orphans.length) console.log("mirror-tree: private items without a public counterpart:\n" + orphans.join("\n"));
    const lines = [];
    if (created) lines.push(`${created} private note(s) / folder(s) created from 10_Public.`);
    if (orphans.length) lines.push(`${orphans.length} private item(s) without a public counterpart:`, ...orphans.slice(0, 10), ...(orphans.length > 10 ? ["…"] : []),
      "→ rename them, or run “Create missing public notes”.");
    if (lines.length || manual) new Notice("Mirror tree\n" + (lines.join("\n") || "Both trees are in step."), 15000);
  }

  async syncToPublic() {
    let created = 0;
    for (const f of this.allFiles()) if (toPublic(f.path, isFolder(f)) && await this.createMirror(f.path, isFolder(f))) created++;
    new Notice(`Mirror tree\n${created} public note(s) / folder(s) created.`);
  }
};
