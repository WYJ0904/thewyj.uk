import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { workspaceRouteMeta, syncWorkspaceShell } from "../js/core/design-system.js";

const ROOT = path.resolve(import.meta.dirname, "..");

function createFakeDoc() {
  const createEl = (tag) => {
    const attrs = new Map();
    const children = [];
    const el = {
      tagName: tag.toUpperCase(),
      hidden: false,
      textContent: "",
      children,
      append(...nodes) {
        for (const n of nodes) children.push(n);
      },
      setAttribute(k, v) {
        attrs.set(k, String(v));
      },
      getAttribute(k) {
        return attrs.has(k) ? attrs.get(k) : null;
      },
      removeAttribute(k) {
        attrs.delete(k);
      },
      remove() {
        const idx = list.children.indexOf(el);
        if (idx >= 0) list.children.splice(idx, 1);
      },
      get lastElementChild() {
        return children.at(-1) || null;
      },
      querySelector(sel) {
        return sel === "ol" ? list : null;
      },
    };
    return el;
  };

  const li0 = {
    tagName: "LI",
    textContent: "Aeris",
    attrs: new Map(),
    setAttribute(k, v) { this.attrs.set(k, String(v)); },
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; },
    removeAttribute(k) { this.attrs.delete(k); },
    remove() {
      const idx = list.children.indexOf(this);
      if (idx >= 0) list.children.splice(idx, 1);
    },
  };
  const list = {
    tagName: "OL",
    children: [li0],
    append(...nodes) {
      for (const n of nodes) this.children.push(n);
    },
    get lastElementChild() {
      return this.children.at(-1) || null;
    },
  };
  const nav = {
    id: "workspaceBreadcrumb",
    hidden: true,
    querySelector(sel) {
      return sel === "ol" ? list : null;
    },
  };
  return {
    body: { dataset: {} },
    createElement(tag) {
      const el = createEl(tag);
      el.remove = () => {
        const idx = list.children.indexOf(el);
        if (idx >= 0) list.children.splice(idx, 1);
      };
      return el;
    },
    getElementById(id) {
      return id === "workspaceBreadcrumb" ? nav : null;
    },
    _nav: nav,
    _list: list,
    _li0: li0,
  };
}

test("workspaceRouteMeta maps all authenticated workspace and module routes accurately", () => {
  assert.equal(workspaceRouteMeta("/", { authenticated: false }), null);
  assert.equal(workspaceRouteMeta("/admin", { authenticated: false }), null);
  assert.equal(workspaceRouteMeta("/unknown", { authenticated: true }), null);
  assert.equal(workspaceRouteMeta("/login", { authenticated: true }), null);

  assert.deepEqual(workspaceRouteMeta("/", { authenticated: true }), { id: "home", trail: ["个人工作台"] });
  assert.deepEqual(workspaceRouteMeta("/select/", { authenticated: true }), { id: "home", trail: ["个人工作台"] });
  assert.deepEqual(workspaceRouteMeta("/language", { authenticated: true }), { id: "language", trail: ["语言学习"] });
  assert.deepEqual(workspaceRouteMeta("/language/english", { authenticated: true }), { id: "language", trail: ["语言学习", "英语"] });
  assert.deepEqual(workspaceRouteMeta("/language/japanese", { authenticated: true }), { id: "language", trail: ["语言学习", "日语"] });
  assert.deepEqual(workspaceRouteMeta("/tools", { authenticated: true }), { id: "tools", trail: ["工具箱"] });
  assert.deepEqual(workspaceRouteMeta("/tools/workflows", { authenticated: true }), { id: "tools", trail: ["工具箱", "工作流"] });
  assert.deepEqual(workspaceRouteMeta("/tools/json-format", { authenticated: true }), { id: "tools", trail: ["工具箱", "工具"] });
  assert.deepEqual(workspaceRouteMeta("/tools/json-format", { authenticated: true, toolTitle: "JSON 格式化" }), { id: "tools", trail: ["工具箱", "JSON 格式化"] });
  assert.deepEqual(workspaceRouteMeta("/finance", { authenticated: true }), { id: "finance", trail: ["财务账本"] });
  assert.deepEqual(workspaceRouteMeta("/transfer", { authenticated: true }), { id: "transfer", trail: ["文件传输"] });
  assert.deepEqual(workspaceRouteMeta("/account", { authenticated: true }), { id: "account", trail: ["账户与安全"] });
  assert.deepEqual(workspaceRouteMeta("/recharge", { authenticated: true }), { id: "recharge", trail: ["会员与充值"] });
  assert.deepEqual(workspaceRouteMeta("/admin", { authenticated: true }), { id: "admin", trail: ["管理后台"] });
  assert.deepEqual(workspaceRouteMeta("/admin", { authenticated: true, adminSection: "功能发布" }), { id: "admin", trail: ["管理后台", "功能发布"] });
});

test("syncWorkspaceShell updates dataset, reuses li nodes, and clears cleanly when unauthenticated", () => {
  const doc = createFakeDoc();
  syncWorkspaceShell(doc, { id: "admin", trail: ["管理后台", "用户"] });
  assert.equal(doc.body.dataset.workspaceRoute, "admin");
  assert.equal(doc._nav.hidden, false);
  assert.deepEqual(doc._list.children.map((c) => c.textContent), ["Aeris", "管理后台", "用户"]);
  assert.equal(doc._list.children[0], doc._li0);
  assert.equal(doc._list.children[2].getAttribute("aria-current"), "page");
  assert.equal(doc._list.children[1].getAttribute("aria-current"), null);

  const reusedMiddle = doc._list.children[1];
  syncWorkspaceShell(doc, { id: "finance", trail: ["财务账本"] });
  assert.equal(doc.body.dataset.workspaceRoute, "finance");
  assert.equal(doc._list.children[1], reusedMiddle);
  assert.deepEqual(doc._list.children.map((c) => c.textContent), ["Aeris", "财务账本"]);
  assert.equal(doc._list.children[1].getAttribute("aria-current"), "page");

  syncWorkspaceShell(doc, null);
  assert.equal(doc.body.dataset.workspaceRoute, undefined);
  assert.equal(doc._nav.hidden, true);
  assert.deepEqual(doc._list.children.map((c) => c.textContent), ["Aeris"]);
  assert.equal(doc._list.children[0].getAttribute("aria-current"), null);
});

test("I05 CSS layer, HTML markers, and PWA shell invariants are preserved", () => {
  const spatial = fs.readFileSync(path.join(ROOT, "spatial-experience.css"), "utf8");
  const idx = spatial.indexOf("I05 Workspace Console Layer");
  assert.ok(idx >= 0, "Missing I05 Workspace Console Layer section in spatial-experience.css");
  const commentEnd = spatial.indexOf("*/", idx);
  const i05Layer = spatial.slice(commentEnd >= 0 ? commentEnd + 2 : idx).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(i05Layer.includes("!important"), false, "I05 Workspace Console Layer must have 0 !important declarations");
  assert.match(i05Layer, /html:not\(\[data-p07-ui="enabled"\]\)\s*:is\(\.workspace-breadcrumb,\s*\.admin-kpi-strip,\s*\.admin-list-head\)\s*\{\s*display:\s*none;\s*\}/s);

  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  for (const marker of [
    'id="workspaceBreadcrumb"',
    'id="adminKpiStrip"',
    'id="adminKpiUsers"',
    'id="adminKpiRecharge"',
    'id="adminKpiAudit"',
    'id="adminKpiLoginFailed"',
    'class="admin-list-head"',
    'account-settings-list',
    'v3-sidebar-group-title',
  ]) {
    assert.ok(html.includes(marker), `Missing I05 HTML marker: ${marker}`);
  }

  const swSource = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const context = {
    URL,
    Response,
    AbortController,
    crypto,
    TextEncoder,
    setTimeout,
    clearTimeout,
    caches: {},
    fetch: async () => new Response(""),
    self: { location: { origin: "https://isolated.example" }, addEventListener() {} },
  };
  vm.runInNewContext(`${swSource}\n;globalThis.__I05_SHELL={core:CORE_SHELL.length,required:REQUIRED_SHELL.length,install:INSTALL_SHELL.length};`, context);
  assert.equal(context.__I05_SHELL.core, 81);
  assert.equal(context.__I05_SHELL.required, 89);
  assert.equal(context.__I05_SHELL.install, 89);
});
