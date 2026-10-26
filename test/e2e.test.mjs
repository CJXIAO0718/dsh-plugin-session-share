import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const here = import.meta.dirname;
const events = fs.readFileSync(path.join(here, "fixtures/session-sample.events.jsonl"), "utf8")
  .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

const headerEvents = events.filter((e) => e.type === "session");
const sessionHeader = { ...headerEvents[0], cwd: headerEvents[0]?.cwd ?? headerEvents[0]?.data?.cwd };

const mod = await import(pathToFileURL(path.join(here, "../lib/index.js")).href);
const ns = mod.default ?? mod;

const captured = { commands: [], routes: [], tools: [], warns: [] };
const ctx = {
  logger: { warn: (...a) => captured.warns.push(a.join(" ")), error: (...a) => captured.warns.push("ERR " + a.join(" ")), info() {}, debug() {} },
  effect: (fn) => { fn(); return () => {}; },
  get: (name) => {
    if (name === "sessionQuery") return { readSession: async (id) => { if (id !== sessionHeader.id) { const e = new Error("not found"); e.code = "SESSION_QUERY_SESSION_NOT_FOUND"; throw e; } return { session: sessionHeader, inheritedEventCount: 0, events }; } };
    if (name === "tools") return { register: (def) => { captured.tools.push(def); return () => {}; } };
    return undefined;
  },
  commands: { register: (def) => { captured.commands.push(def); return () => {}; } },
  connection: { fetch: { register: (def) => { captured.routes.push(def); return () => {}; } } }
};
ns.apply(ctx, {});

const results = [];
const check = (name, fn) => { try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, error: String(e.message) }); } };

check("one command registered named share", () => { assert.equal(captured.commands.length, 1); assert.equal(captured.commands[0].name, "share"); });
check("shareHtml route registered", () => { const r = captured.routes.filter((x) => x.path === "/api/session.shareHtml"); assert.equal(r.length, 1); assert.deepEqual([...r[0].methods].sort(), ["GET", "HEAD"]); });

const route = captured.routes.filter((x) => x.path === "/api/session.shareHtml")[0];
const mkReq = (q, method = "GET") => new Request("http://127.0.0.1/api/session.shareHtml" + q, { method });

const missing = await route.fetch(mkReq(""));
check("missing sessionId -> 400", () => assert.equal(missing.status, 400));

const notFound = await route.fetch(mkReq("?sessionId=nope"));
check("unknown session -> 404", () => assert.equal(notFound.status, 404));

const head = await route.fetch(mkReq("?sessionId=" + sessionHeader.id, "HEAD"));
check("HEAD -> 200 null body", () => { assert.equal(head.status, 200); assert.equal(head.body, null); });

const ok = await route.fetch(mkReq("?sessionId=" + sessionHeader.id));
const html = await ok.text();
check("GET -> 200", () => assert.equal(ok.status, 200));
check("content-type html", () => assert.match(ok.headers.get("content-type"), /text\/html; charset=utf-8/));
check("inline by default", () => assert.match(ok.headers.get("content-disposition"), /^inline; filename="dsh-session-.*\.html"$/));
check("no-store + nosniff", () => { assert.equal(ok.headers.get("cache-control"), "no-store"); assert.equal(ok.headers.get("x-content-type-options"), "nosniff"); });

const dl = await route.fetch(mkReq("?sessionId=" + sessionHeader.id + "&download=1"));
check("download=1 -> attachment", () => assert.match(dl.headers.get("content-disposition"), /^attachment;/));

check("rendered conversation text present", () => { assert.ok(html.includes("帮我给客户订单列表加一个导出 CSV 的功能")); });
const localUser = (/Users[\\/]([^\\/]+)/.exec(sessionHeader.cwd ?? "") ?? [])[1] ?? "";
check("no local username leak", () => { if (localUser === "") return; assert.equal((html.match(new RegExp(localUser, "g")) ?? []).length, 0); });
check("no external scheme", () => { assert.equal((html.match(/https?:\/\//g) ?? []).length, 0); });
check("finished html doc", () => { assert.ok(html.trimEnd().endsWith("</html>")); });

const out = path.join(here, "out/e2e-session-share.html");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html, "utf8");
const stats = { routeBytes: Buffer.byteLength(html), out };

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ results, stats, tools: captured.tools.map((t) => t.name), warns: captured.warns.length }, null, 1));
process.exit(failed.length ? 1 : 0);
