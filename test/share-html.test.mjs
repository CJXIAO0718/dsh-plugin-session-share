import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.join(here, "..", "lib", "client.js");
const source = readFileSync(clientPath, "utf8");
const packageJson = JSON.parse(readFileSync(path.join(here, "..", "package.json"), "utf8"));
const packageName = packageJson.name;
const checks = [];
function ok(name, fn) {
	fn();
	checks.push(name);
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
/** Copy a value produced inside the vm realm into this realm so deep equality compares content. */
const host = (value) => Array.from(value);
/** First direct child carrying one plugin class, or null. */
const byClass = (node, className) => {
	if (node === undefined || node === null || node.children === undefined || node.children === null) return null;
	for (const child of node.children) if (child.className === className) return child;
	return null;
};
/** Split one mounted preview layer into mask, panel, toolbar, body and the two toolbar buttons. */
const previewParts = (env) => {
	const overlay = env.body.children[0];
	const panel = byClass(overlay, "_shareHtml_previewPanel");
	const bar = byClass(panel, "_shareHtml_previewBar");
	const actions = byClass(bar, "_shareHtml_previewActions");
	const body = byClass(panel, "_shareHtml_previewBody");
	return { overlay, panel, bar, actions, title: byClass(bar, "_shareHtml_previewTitle"), body, frame: byClass(body, "_shareHtml_frame"), close: byClass(actions, "_shareHtml_close"), download: byClass(actions, "_shareHtml_download") };
};
/** One button inside a preview panel's toolbar action group. */
const toolbarButton = (panel, className) => byClass(byClass(byClass(panel, "_shareHtml_previewBar"), "_shareHtml_previewActions"), className);
/** Children of one element produced by the createElement stub, always as an array. */
const childrenOf = (node) => {
	const kids = node.props === undefined || node.props === null ? undefined : node.props.children;
	if (kids === undefined || kids === null) return [];
	return Array.isArray(kids) ? kids : [kids];
};

//#region stubs
/** One minimal DOM node: enough surface for the share action to mount, measure and tear down. */
function makeNode(tagName, owner) {
	const node = {
		tagName: String(tagName).toUpperCase(),
		dataset: {},
		style: {},
		attributes: {},
		children: [],
		parentNode: null,
		className: "",
		textContent: "",
		listeners: [],
		offsetWidth: owner === undefined ? 0 : owner.sizes.width,
		offsetHeight: owner === undefined ? 0 : owner.sizes.height,
		setAttribute(name, value) { node.attributes[name] = String(value); },
		getAttribute(name) { return Object.prototype.hasOwnProperty.call(node.attributes, name) ? node.attributes[name] : null; },
		removeAttribute(name) { delete node.attributes[name]; },
		appendChild(child) { child.parentNode = node; node.children.push(child); return child; },
		removeChild(child) {
			const at = node.children.indexOf(child);
			if (at >= 0) node.children.splice(at, 1);
			child.parentNode = null;
			return child;
		},
		remove() { if (node.parentNode !== null && node.parentNode !== undefined) node.parentNode.removeChild(node); },
		addEventListener(type, fn) { node.listeners.push({ type, fn }); },
		removeEventListener(type, fn) {
			const at = node.listeners.findIndex((entry) => entry.type === type && entry.fn === fn);
			if (at >= 0) node.listeners.splice(at, 1);
		},
		contains(other) { return other === node || node.children.some((child) => child.contains(other)); },
		focus() { node.focused = (node.focused === undefined ? 0 : node.focused) + 1; if (owner !== undefined) owner.activeElement = node; },
		click() { node.clicked = (node.clicked === undefined ? 0 : node.clicked) + 1; if (owner !== undefined) owner.anchors.push(node); },
		getBoundingClientRect() { return owner === undefined ? { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } : { ...owner.rect }; }
	};
	return node;
}
function makeDocument() {
	const head = [];
	const anchors = [];
	const listeners = [];
	const doc = {
		rect: { top: 40, bottom: 64, left: 900, right: 928, width: 28, height: 24 },
		sizes: { width: 190, height: 64 },
		activeElement: null,
		anchors,
		listeners,
		createElement(tagName) { return makeNode(tagName, doc); },
		addEventListener(type, fn) { listeners.push({ type, fn }); },
		removeEventListener(type, fn) {
			const at = listeners.findIndex((entry) => entry.type === type && entry.fn === fn);
			if (at >= 0) listeners.splice(at, 1);
		},
		querySelector(selector) {
			const match = /data-plugin-css="([^"]+)"/.exec(selector);
			return match !== null && head.some((node) => node.dataset.pluginCss === match[1]) ? { selector } : null;
		}
	};
	doc.head = makeNode("head", doc);
	doc.head.appendChild = (child) => { child.parentNode = doc.head; head.push(child); return child; };
	doc.body = makeNode("body", doc);
	doc.documentElement = makeNode("html", doc);
	return { doc, head, anchors, listeners };
}
function makeWindow() {
	const opened = [];
	const loaded = [];
	const listeners = [];
	const win = {
		__ModuleLoader__: { load(definition) { loaded.push(definition); } },
		innerWidth: 1024,
		open(...args) { opened.push(args); return null; },
		addEventListener(type, fn) { listeners.push({ type, fn }); },
		removeEventListener(type, fn) {
			const at = listeners.findIndex((entry) => entry.type === type && entry.fn === fn);
			if (at >= 0) listeners.splice(at, 1);
		}
	};
	return { win, loaded, opened, listeners };
}
/** Blob and object-URL stubs; object URLs are deterministic so assertions can name them. */
function makePlatform() {
	const blobs = [];
	const objectUrls = [];
	const revoked = [];
	const BlobStub = function Blob(parts, options) {
		this.parts = Array.from(parts);
		this.type = options === undefined || options === null ? undefined : options.type;
		blobs.push({ parts: this.parts, type: this.type });
	};
	const URLStub = {
		createObjectURL(blob) {
			const id = "blob:share-" + (objectUrls.length + 1);
			objectUrls.push({ id, blob });
			return id;
		},
		revokeObjectURL(id) { revoked.push(id); }
	};
	return { Blob: BlobStub, URL: URLStub, blobs, objectUrls, revoked };
}
/** Console capture: the component's diagnostics land here instead of stdout. */
function makeConsole() {
	const info = [];
	const warn = [];
	const sink = {
		info(message, detail) { info.push({ message, detail }); },
		warn(message, detail) { warn.push({ message, detail }); },
		log() {},
		error() {}
	};
	return { sink, info, warn };
}
const jsxRuntime = {
	jsx: (type, props) => ({ type, props: props === undefined ? {} : props }),
	jsxs: (type, props) => ({ type, props: props === undefined ? {} : props }),
	Fragment: Symbol("Fragment")
};
/** Effects queue in render order, cleanups run before the next effect exactly as react does. */
function createHookRuntime(doc) {
	const cells = [];
	const depSlots = [];
	let cursor = 0;
	let queue = [];
	const elementFor = (tree) => doc === undefined ? null : doc.createElement(typeof tree.type === "string" ? tree.type : "div");
	function attachRefs(tree) {
		if (tree === null || tree === undefined || typeof tree !== "object") return;
		if (Array.isArray(tree)) { for (const child of tree) attachRefs(child); return; }
		const props = tree.props === undefined || tree.props === null ? {} : tree.props;
		const ref = props.ref;
		if (ref !== undefined && ref !== null && typeof ref === "object" && (ref.current === null || ref.current === undefined)) ref.current = elementFor(tree);
		attachRefs(props.children);
	}
	const react = {
		createElement(type, props, ...children) {
			const next = { ...(props === undefined || props === null ? {} : props) };
			if (children.length > 0) next.children = children.length === 1 ? children[0] : children;
			return { type, props: next };
		},
		useState(initial) {
			const index = cursor++;
			cells[index] = cells[index] || { value: typeof initial === "function" ? initial() : initial };
			return [cells[index].value, (next) => { cells[index].value = typeof next === "function" ? next(cells[index].value) : next; }];
		},
		useRef(initial) {
			const index = cursor++;
			cells[index] = cells[index] || { value: { current: initial } };
			return cells[index].value;
		},
		useCallback(fn) {
			cursor += 1;
			return fn;
		},
		useEffect(fn, deps) {
			const index = cursor++;
			const previous = depSlots[index];
			const changed = previous === undefined || !Array.isArray(deps) || deps.length !== previous.deps.length || deps.some((dep, at) => dep !== previous.deps[at]);
			if (!changed) return;
			depSlots[index] = { deps: Array.isArray(deps) ? [...deps] : [], cleanup: previous === undefined ? null : previous.cleanup };
			queue.push({ index, fn });
		}
	};
	let component = null;
	function runCleanup(slot) {
		if (slot === undefined || slot === null || typeof slot.cleanup !== "function") return;
		const cleanup = slot.cleanup;
		slot.cleanup = null;
		cleanup();
	}
	return {
		react,
		setComponent(next) { component = next; },
		render(props) {
			cursor = 0;
			const collected = [];
			queue = collected;
			const built = component(props);
			attachRefs(built);
			for (const entry of collected) {
				const slot = depSlots[entry.index];
				runCleanup(slot);
				const cleanup = entry.fn();
				if (slot !== undefined) slot.cleanup = typeof cleanup === "function" ? cleanup : null;
			}
			return built;
		},
		unmount() {
			for (const slot of depSlots) runCleanup(slot);
		}
	};
}
/** One distinct stub per icon export name, so a probe hit is identifiable by identity. */
function iconStubs(names) {
	const stubs = {};
	for (const name of names) stubs[name] = function StubIcon() { return null; };
	return stubs;
}
/** Primitives stub map: the icon exports a host build may ship. */
function primitivesFor({ icons = true, names = [] } = {}) {
	const primitives = icons ? iconStubs(["IconShareOutlineRegular", "IconDownloadOutlineRegular", "IconEyeOutlineRegular"]) : {};
	Object.assign(primitives, iconStubs(names));
	return primitives;
}
/** Load lib/client.js into a fresh classic-script context; returns the captured module definition. */
function loadModule({ icons = true } = {}) {
	const { doc, head, anchors, listeners } = makeDocument();
	const { win, loaded, opened } = makeWindow();
	const platform = makePlatform();
	const capture = makeConsole();
	const context = vm.createContext({ window: win, document: doc, console: capture.sink, setTimeout, Blob: platform.Blob, URL: platform.URL });
	vm.runInContext(source, context, { filename: "client.js" });
	const hooks = createHookRuntime(doc);
	const primitives = primitivesFor({ icons });
	const required = [];
	const requireStub = (specifier) => {
		required.push(specifier);
		if (specifier === "react") return hooks.react;
		if (specifier === "react/jsx-runtime") return jsxRuntime;
		if (specifier === "@deepseek-ai/dsh-client-ui-primitives") return primitives;
		throw new Error("unexpected require: " + specifier);
	};
	return {
		definition: loaded[0],
		requireStub,
		primitives,
		hooks,
		head,
		anchors,
		opened,
		doc,
		body: doc.body,
		docListeners: listeners,
		platform,
		required,
		info: capture.info,
		warn: capture.warn
	};
}
//#endregion

// A. module shell
const shell = loadModule();
ok("A1 module id equals the package.json name", () => assert.equal(shell.definition.id, packageName));
ok("A1b module id is not the slot contribution id", () => {
	assert.notEqual(shell.definition.id, "share-html");
	assert.equal(shell.definition.id, packageName);
});
ok("A2 typeof captured.factory === function", () => assert.equal(typeof shell.definition.factory, "function"));

// B. export surface
const mod = shell.definition.factory(shell.requireStub);
ok("B1 exports.inject lists slots+locale", () => assert.deepEqual([...mod.inject].sort(), ["locale", "slots"]));
ok("B2 typeof exports.apply === function", () => assert.equal(typeof mod.apply, "function"));
ok("B3 only allowlisted modules required", () => assert.deepEqual([...new Set(shell.required)].sort(), ["@deepseek-ai/dsh-client-ui-primitives", "react", "react/jsx-runtime"]));

// C. apply() registration
const registrations = [];
const locales = [];
const ctx = {
	effect(fn) { fn(); return () => {}; },
	locale: { register(namespace, dictionaries) { locales.push({ namespace, dictionaries }); return () => {}; } },
	slots: {
		inject(slotName, fn) { registrations.push({ slotName }); fn(); return () => {}; },
		register(definition, component) { registrations[registrations.length - 1].definition = definition; registrations[registrations.length - 1].component = component; return () => {}; }
	}
};
mod.apply(ctx);
const slot = registrations.find((entry) => entry.definition !== undefined);
ok("C1 slot name is conversation.session.header.utilities", () => assert.equal(slot.slotName, "conversation.session.header.utilities"));
ok("C2 inject name matches register name", () => assert.equal(slot.definition.name, "conversation.session.header.utilities"));
ok("C3 contribution id is share-html", () => assert.equal(slot.definition.id, "share-html"));
ok("C4 order is 5", () => assert.equal(slot.definition.order, 5));
ok("C5 locale namespace is sessionShareHtml", () => assert.equal(slot.definition.locale, "sessionShareHtml"));
ok("C6 register ran inside slots.inject", () => assert.equal(registrations.length, 1));
ok("C7 component is a function", () => assert.equal(typeof slot.component, "function"));
ok("C8 inject returns hooks object", () => assert.equal(typeof slot.definition.inject().hooks, "object"));
const dictionaries = locales[0];
ok("C9 locale.register called once with sessionShareHtml", () => { assert.equal(locales.length, 1); assert.equal(dictionaries.namespace, "sessionShareHtml"); });
const zhKeys = Object.keys(dictionaries.dictionaries.zh).sort();
const enKeys = Object.keys(dictionaries.dictionaries.en).sort();
ok("C10 zh/en key sets identical and non-empty", () => { assert.deepEqual(zhKeys, enKeys); assert.ok(zhKeys.length >= 4); });
ok("C11 required keys present", () => assert.deepEqual(zhKeys, ["action.label", "error.failed", "menu.connect", "menu.download", "menu.pick", "menu.preview", "menu.publishHost", "picker.assistant", "picker.cancel", "picker.close", "picker.context", "picker.empty", "picker.generate", "picker.loadFailed", "picker.loading", "picker.noneSelected", "picker.publish", "picker.selectAll", "picker.selectNone", "picker.selected", "picker.title", "picker.tools", "picker.you", "preview.close", "preview.download", "preview.title", "publish.close", "publish.copied", "publish.copy", "publish.copyFailed", "publish.failed", "publish.open", "publish.rateLimited", "publish.sub", "publish.title", "publish.tooLarge", "publish.unauthorized", "publish.unreachable", "settings.cancel", "settings.close", "settings.defaultMode", "settings.defaultModeHint", "settings.host", "settings.hostHint", "settings.hostRequired", "settings.intro", "settings.invalidHost", "settings.missing", "settings.modeDownload", "settings.modePreview", "settings.modePublish", "settings.reachable", "settings.save", "settings.saveFailed", "settings.saved", "settings.savedButUnreachable", "settings.saving", "settings.testing", "settings.title", "settings.token", "settings.tokenHint", "settings.tokenRequired", "settings.tokenStored"]));
ok("C12 zh values are Simplified Chinese, en are not", () => { assert.equal(dictionaries.dictionaries.zh["menu.download"], "下载 HTML"); assert.equal(dictionaries.dictionaries.en["menu.download"], "Download HTML"); });

// D. component behaviour: one native trigger plus a body-level menu
const t = (key) => dictionaries.dictionaries.zh[key];
const fetchResults = [];
const fetchCalls = [];
const fetchStub = (url, init) => { fetchCalls.push({ url, init }); const result = fetchResults.length > 0 ? fetchResults.shift() : { ok: true, status: 200 }; return Promise.resolve(result); };
/** Queue one HEAD answer plus the GET answer the preview layer reads. */
function queuePreview(html) {
	fetchResults.push({ ok: true, status: 200 }, { ok: true, status: 200, text: () => Promise.resolve(html) });
}
// the component closes over global fetch of its own realm, so reload with this stub on the context
function loadWith(fetchImpl, { icons = true, names = [], platform = makePlatform() } = {}) {
	const { doc, head, anchors, listeners } = makeDocument();
	const { win, loaded, opened, listeners: winListeners } = makeWindow();
	const capture = makeConsole();
	const context = vm.createContext({ window: win, document: doc, console: capture.sink, setTimeout, fetch: fetchImpl, Blob: platform.Blob, URL: platform.URL });
	vm.runInContext(source, context, { filename: "client.js" });
	const hooks = createHookRuntime(doc);
	const primitives = primitivesFor({ icons, names });
	const requireStub = (specifier) => {
		if (specifier === "react") return hooks.react;
		if (specifier === "react/jsx-runtime") return jsxRuntime;
		if (specifier === "@deepseek-ai/dsh-client-ui-primitives") return primitives;
		throw new Error("unexpected require: " + specifier);
	};
	return {
		definition: loaded[0],
		requireStub,
		primitives,
		hooks,
		head,
		anchors,
		opened,
		doc,
		body: doc.body,
		docListeners: listeners,
		winListeners,
		platform,
		info: capture.info,
		warn: capture.warn
	};
}
const live = loadWith(fetchStub);
const liveMod = live.definition.factory(live.requireStub);
liveMod.apply(ctx);
const component = registrations[registrations.length - 1].component;
assert.equal(typeof component, "function");
live.hooks.setComponent(component);
const props = { sessionId: "sess-1", t };
const triggerOf = (tree) => childrenOf(tree)[0];
const menuNodeOf = (env) => env.body.children.length === 0 ? null : env.body.children[0].children[0];
const entriesOf = (env) => {
	const menu = menuNodeOf(env);
	return menu === null ? [] : menu.children;
};
const clickTrigger = (env, tree, renderProps) => {
	triggerOf(tree).props.onClick();
	return env.hooks.render(renderProps === undefined ? props : renderProps);
};
const clickEntry = (env, index) => {
	const entry = entriesOf(env)[index];
	entry.listeners.filter((item) => item.type === "click")[0].fn({ target: entry });
};
const ensureMenu = (env, tree, renderProps) => {
	if (env.body.children.length > 0) return tree;
	return clickTrigger(env, tree, renderProps);
};
let tree = live.hooks.render(props);
ok("D1 render returns the fixed-size wrapper with nothing mounted yet", () => {
	assert.equal(tree.type, "div");
	assert.equal(tree.props.className, "_shareHtml_fallback");
	assert.deepEqual(host(childrenOf(tree).map((node) => node.type)), ["button"]);
	assert.equal(live.body.children.length, 0);
});
ok("D2 the trigger is a native button carrying the menu semantics", () => {
	const trigger = triggerOf(tree);
	assert.equal(trigger.type, "button");
	assert.equal(trigger.props.type, "button");
	assert.equal(trigger.props.className, "_shareHtml_trigger");
	assert.equal(typeof trigger.props.onClick, "function");
	assert.equal(trigger.props["aria-label"], t("action.label"));
	assert.equal(trigger.props["aria-haspopup"], "menu");
	assert.equal(trigger.props["aria-expanded"], false);
});
tree = clickTrigger(live, tree);
ok("D5 trigger click opens the menu", () => {
	assert.equal(live.body.children.length, 1);
	assert.equal(triggerOf(tree).props["aria-expanded"], true);
});
ok("D3 five items in preview/download/pick/publish/connect order, enabled", () => {
	const entries = entriesOf(live);
	assert.deepEqual(host(entries.map((entry) => entry.getAttribute("role"))), ["menuitem", "menuitem", "menuitem", "menuitem", "menuitem"]);
	assert.deepEqual(host(entries.map((entry) => entry.textContent)), [t("menu.preview"), t("menu.download"), t("menu.pick"), t("menu.publishHost"), t("menu.connect")]);
	assert.deepEqual(host(entries.map((entry) => entry.getAttribute("disabled"))), [null, null, null, null, null]);
});
ok("D4 menu is viewport-anchored under the trigger and visible", () => {
	const menu = menuNodeOf(live);
	assert.equal(menu.style.position, "fixed");
	assert.equal(menu.style.top, "70px");
	assert.equal(menu.style.right, "96px");
	assert.equal(menu.style.display, "flex");
	assert.equal(triggerOf(tree).props["aria-expanded"], true);
	assert.equal(live.body.children[0].className, "_shareHtml_portal");
});
tree = clickTrigger(live, tree);
ok("D5b a second trigger click closes the menu again", () => {
	assert.equal(live.body.children.length, 0);
	assert.equal(triggerOf(tree).props["aria-expanded"], false);
});
tree = clickTrigger(live, tree);
fetchCalls.length = 0;
live.platform.objectUrls.length = 0;
queuePreview("<html><body>shared</body></html>");
clickEntry(live, 0);
const busyTree = live.hooks.render(props);
ok("D6 busy disables every item while previewing", () => assert.deepEqual(host(entriesOf(live).map((entry) => entry.getAttribute("disabled"))), ["disabled", "disabled", "disabled", "disabled", "disabled"]));
assert.equal(typeof busyTree, "object");
await flush();
await flush();
tree = live.hooks.render(props);
ok("D7 preview pre-checks HEAD without download param", () => {
	assert.equal(fetchCalls.length, 2);
	assert.equal(fetchCalls[0].url, "api/session.shareHtml?sessionId=sess-1");
	assert.equal(fetchCalls[0].init.method, "HEAD");
	assert.equal(Object.keys(fetchCalls[0].init).join(","), "method");
});
ok("D8 preview fetches the document and mounts the in-app layer", () => {
	assert.equal(fetchCalls[1].url, "api/session.shareHtml?sessionId=sess-1");
	assert.equal(fetchCalls[1].init, undefined);
	assert.equal(live.platform.objectUrls.length, 1);
	assert.deepEqual(host(live.platform.blobs[0].parts), ["<html><body>shared</body></html>"]);
	assert.equal(live.platform.blobs[0].type, "text/html");
	assert.equal(live.body.children.length, 1);
	assert.equal(live.body.children[0].className, "_shareHtml_overlay");
});
const dOverlay = live.body.children[0];
const dClose = toolbarButton(byClass(dOverlay, "_shareHtml_previewPanel"), "_shareHtml_close");
dClose.listeners.filter((entry) => entry.type === "click")[0].fn({ target: dClose });
ok("D8b closing the layer revokes the blob URL and clears the document", () => {
	assert.deepEqual(host(live.platform.revoked), ["blob:share-1"]);
	assert.equal(live.body.children.length, 0);
	assert.equal(live.docListeners.length, 0);
});
fetchCalls.length = 0;
live.anchors.length = 0;
tree = ensureMenu(live, tree);
clickEntry(live, 1);
await flush();
await flush();
tree = live.hooks.render(props);
ok("D9 download URL carries download=1", () => {
	assert.equal(fetchCalls.length, 1);
	assert.equal(fetchCalls[0].url, "api/session.shareHtml?sessionId=sess-1&download=1");
	assert.equal(fetchCalls[0].init.method, "HEAD");
});
ok("D10 download clicks an anchor with the session filename", () => {
	assert.equal(live.anchors.length, 1);
	assert.equal(live.anchors[0].tagName, "A");
	assert.equal(live.anchors[0].href, "api/session.shareHtml?sessionId=sess-1&download=1");
	assert.equal(live.anchors[0].download, "dsh-session-sess-1.html");
	assert.equal(live.anchors[0].clicked, 1);
});
ok("D11 no token header and no custom auth", () => { assert.deepEqual(Object.keys(fetchCalls[0].init), ["method"]); });

tree = ensureMenu(live, tree);
live.anchors.length = 0;
fetchResults.length = 0;
fetchResults.push({ ok: false, status: 500 });
clickEntry(live, 0);
await flush();
await flush();
tree = live.hooks.render(props);
ok("D12 failure shows locale error plus HTTP status inside the menu", () => {
	const entries = entriesOf(live);
	assert.equal(entries.length, 6);
	const notice = entries[5];
	assert.equal(notice.className, "_shareHtml_error");
	assert.equal(notice.getAttribute("role"), "status");
	assert.equal(notice.textContent, t("error.failed") + " (HTTP 500)");
});
ok("D13 failure keeps every action enabled again", () => assert.deepEqual(host(entriesOf(live).slice(0, 5).map((entry) => entry.getAttribute("disabled"))), [null, null, null, null, null]));
ok("D13b a failed preview degrades to a direct download", () => {
	assert.equal(live.anchors.length, 1);
	assert.equal(live.anchors[0].tagName, "A");
	assert.equal(live.anchors[0].href, "api/session.shareHtml?sessionId=sess-1&download=1");
	assert.equal(live.anchors[0].download, "dsh-session-sess-1.html");
	assert.equal(live.anchors[0].clicked, 1);
});
live.hooks.setComponent(component);
let thrown = null;
let resetTree = null;
try { live.hooks.render({ ...props, sessionId: "sess-2" }); } catch (error) { thrown = error; }
resetTree = live.hooks.render({ ...props, sessionId: "sess-2" });
ok("D14 sessionId change clears the failure state", () => {
	assert.equal(thrown, null);
	assert.deepEqual(host(entriesOf(live).map((entry) => entry.textContent)), [t("menu.preview"), t("menu.download"), t("menu.pick"), t("menu.publishHost"), t("menu.connect")]);
	assert.equal(triggerOf(resetTree).props["aria-expanded"], true);
});
ok("D15 no dialog and no alert used", () => { assert.equal(/alert\(/.test(source), false); });

// E. a host build that exports no primitives at all
const degraded = loadModule({ icons: false });
const degradedMod = degraded.definition.factory(degraded.requireStub);
degradedMod.apply(ctx);
degraded.hooks.setComponent(registrations[registrations.length - 1].component);
let degradedTree = null;
let degradedError = null;
try { degradedTree = degraded.hooks.render(props); } catch (error) { degradedError = error; }
ok("E1 missing primitives exports still build the native trigger without throwing", () => {
	assert.equal(degradedError, null);
	assert.equal(degradedTree.type, "div");
	assert.equal(childrenOf(degradedTree)[0].type, "button");
});
ok("E2 fallback trigger is a real button with the locale label", () => {
	const trigger = childrenOf(degradedTree)[0];
	assert.equal(trigger.type, "button");
	assert.equal(trigger.props["aria-label"], t("action.label"));
});
childrenOf(degradedTree)[0].props.onClick();
degradedTree = degraded.hooks.render(props);
ok("E3 fallback menu exposes the five locale actions", () => {
	const container = degraded.body.children[0];
	assert.equal(container.className, "_shareHtml_portal");
	const menuNode = container.children[0];
	assert.equal(menuNode.getAttribute("role"), "menu");
	assert.deepEqual(host(menuNode.children.map((entry) => entry.textContent)), [t("menu.preview"), t("menu.download"), t("menu.pick"), t("menu.publishHost"), t("menu.connect")]);
});

// F. stylesheet injection contract
ok("F1 one style tag injected with data-plugin-css=share-html", () => {
	assert.equal(shell.head.length, 1);
	assert.equal(shell.head[0].tagName, "STYLE");
	assert.equal(shell.head[0].dataset.pluginCss, "share-html");
	assert.ok(shell.head[0].textContent.length > 100);
});
ok("F2 reloading into the same document does not duplicate the stylesheet", () => {
	const { doc, head } = makeDocument();
	const { win, loaded } = makeWindow();
	const shared = vm.createContext({ window: win, document: doc, console, setTimeout });
	vm.runInContext(source, shared, { filename: "client.js" });
	vm.runInContext(source, shared, { filename: "client.js" });
	const requireStub = (specifier) => {
		if (specifier === "react") return { createElement: () => null };
		if (specifier === "react/jsx-runtime") return jsxRuntime;
		if (specifier === "@deepseek-ai/dsh-client-ui-primitives") return {};
		throw new Error("unexpected require: " + specifier);
	};
	assert.equal(typeof loaded[1].factory, "function");
	loaded[0].factory(requireStub);
	assert.equal(head.length, 1);
	loaded[1].factory(requireStub);
	assert.equal(head.length, 1);
});

// G. source hygiene
ok("G1 no import/export statements", () => { assert.equal(/^\s*(import|export)\s/m.test(source), false); });
ok("G2 no <script src", () => assert.equal(/<script\s+src/i.test(source), false));
ok("G3 no http(s) URL", () => assert.equal(/https?:\/\//i.test(source), false));
ok("G4 classic window.__ModuleLoader__.load shell", () => assert.ok(source.startsWith("window.__ModuleLoader__.load({")));
ok("G5 single module load call", () => assert.equal(source.split("__ModuleLoader__.load(").length, 2));
ok("G6 module id literal appears once, matching the single load call", () => {
	const loadCalls = source.split("__ModuleLoader__.load(").length - 1;
	const idLiterals = source.split('id: "' + packageName + '"').length - 1;
	assert.equal(loadCalls, 1);
	assert.equal(idLiterals, loadCalls);
});
ok("G7 the load line itself carries the package name", () => {
	const lines = source.split("\n");
	assert.equal(lines[0].trim(), "window.__ModuleLoader__.load({");
	assert.equal(lines[1].trim(), 'id: "' + packageName + '",');
});
ok("G8 window.open is never referenced", () => assert.equal(source.split("window.open").length - 1, 0));

// H. trigger icon carries share semantics, never a second ellipsis
/** Mount the component against a chosen primitives stub set and render it once. */
function renderWithBundle({ icons = true, names = [] } = {}) {
	const bundle = loadWith(fetchStub, { icons, names });
	const bundleMod = bundle.definition.factory(bundle.requireStub);
	bundleMod.apply(ctx);
	const mounted = registrations[registrations.length - 1].component;
	bundle.hooks.setComponent(mounted);
	return { bundle, tree: bundle.hooks.render(props) };
}
ok("H1 client.js no longer references an ellipsis icon export", () => { assert.equal(source.includes("IconEllipsis"), false); });
const shareIconTree = renderWithBundle({});
ok("H2 trigger renders the share icon this host build exports", () => {
	const triggerGlyph = triggerOf(shareIconTree.tree).props.children;
	assert.equal(triggerGlyph.type, shareIconTree.bundle.primitives.IconShareOutlineRegular);
});
const inlineGlyphTree = renderWithBundle({ icons: false });
const glyph = triggerOf(inlineGlyphTree.tree).props.children;
ok("H3 missing share icon renders the inline 24x24 stroked share glyph", () => {
	assert.equal(glyph.type, "svg");
	assert.equal(glyph.props.viewBox, "0 0 24 24");
	assert.equal(glyph.props.fill, "none");
	assert.equal(glyph.props.stroke, "currentColor");
	assert.equal(glyph.props.strokeWidth, "1.8");
	assert.deepEqual(host(glyph.props.children.map((child) => child.type)), ["circle", "circle", "circle", "path"]);
});
ok("H4 inline glyph is neither an ellipsis nor a text node", () => {
	assert.equal(typeof glyph, "object");
	assert.equal(glyph.props.children.some((child) => typeof child === "string"), false);
	assert.equal(source.includes("…"), false);
});
const probeTree = renderWithBundle({ icons: false, names: ["IconUploadOutlineRegular", "IconSendOutlineRegular"] });
ok("H5 probe list honours declaration order (send before upload)", () => {
	assert.equal(triggerOf(probeTree.tree).props.children.type, probeTree.bundle.primitives.IconSendOutlineRegular);
});
ok("H6 degraded trigger (no Menu/Button, no icons) also renders the inline svg", () => {
	const trigger = childrenOf(degradedTree)[0];
	assert.equal(trigger.type, "button");
	assert.equal(trigger.props.children.type, "svg");
});

// I. stylesheet: theme-following colour, strictly scoped selectors
const cssText = shell.head[0].textContent;
/** Split one stylesheet into selector/declaration pairs. */
function rulesOf(text) {
	const rules = [];
	const pattern = /([^{}]+)\{([^{}]*)\}/g;
	let match = pattern.exec(text);
	while (match !== null) {
		const declarations = match[2].split(";").map((declaration) => declaration.trim()).filter((declaration) => declaration.length > 0);
		rules.push({ selector: match[1].trim(), declarations });
		match = pattern.exec(text);
	}
	return rules;
}
const cssRules = rulesOf(cssText);
const cssSelectors = cssRules.map((rule) => rule.selector);
const cssDeclarations = cssRules.flatMap((rule) => rule.declarations);
const themeSafe = /^(transparent|inherit|currentColor|none|Canvas)$|^(var\(|color-mix\()/;
ok("I1 every background declaration derives from the theme", () => {
	const backgrounds = cssDeclarations.filter((declaration) => /^background(-color)?\s*:/i.test(declaration));
	assert.ok(backgrounds.length >= 3);
	const offending = backgrounds.filter((declaration) => !themeSafe.test(declaration.replace(/^background(-color)?\s*:/i, "").trim()));
	assert.deepEqual(host(offending), []);
});
ok("I2 no colour declaration carries a literal hex/rgb/hsl value", () => {
	const colourDeclarations = cssDeclarations.filter((declaration) => /^(background(-color)?|color|border|box-shadow)\s*:/i.test(declaration));
	const offending = colourDeclarations.filter((declaration) => /#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(/.test(declaration));
	assert.deepEqual(host(offending), []);
});
ok("I3 every injected selector carries the plugin class prefix", () => {
	assert.ok(cssSelectors.length >= 10);
	assert.deepEqual(host(cssSelectors.filter((selector) => !selector.startsWith("._shareHtml_"))), []);
});
ok("I4 no global class or bare element selector", () => {
	assert.deepEqual(host(cssSelectors.filter((selector) => /(^|[\s,>+~])\.(menu|item|button|trigger|error|container)\b/.test(selector))), []);
	assert.deepEqual(host(cssSelectors.filter((selector) => /^[a-zA-Z*]/.test(selector))), []);
});
ok("I5 selectors are ._shareHtml_* roots plus descendant svg parts only", () => {
	const parts = [];
	for (const selector of cssSelectors) for (const part of selector.split(/[\s>+~]+/)) if (part.length > 0 && !part.startsWith("._shareHtml_")) parts.push(part);
	assert.deepEqual(host([...new Set(parts)]), ["svg"]);
});
ok("I6 the trigger keeps colour and background theme-derived, with no rule for a dropped host Button", () => {
	const trigger = cssRules.filter((rule) => rule.selector === "._shareHtml_trigger")[0];
	assert.ok(trigger !== undefined);
	assert.deepEqual(host(trigger.declarations.filter((declaration) => /^(color|background(-color)?)\s*:/i.test(declaration))), ["background:transparent", "color:inherit"]);
	assert.deepEqual(host(cssRules.filter((rule) => rule.selector === "._shareHtml_moreButton")), []);
});

// J. the menu leaves the header row: body-level mount, viewport anchoring, teardown
const menuEnv = loadWith(fetchStub, { icons: false });
const menuMod = menuEnv.definition.factory(menuEnv.requireStub);
menuMod.apply(ctx);
menuEnv.hooks.setComponent(registrations[registrations.length - 1].component);
let menuTree = menuEnv.hooks.render(props);
ok("J1 closed menu renders the fixed-size trigger and nothing else", () => {
	assert.equal(menuTree.type, "div");
	assert.equal(menuTree.props.className, "_shareHtml_fallback");
	assert.deepEqual(host(childrenOf(menuTree).map((node) => node.type)), ["button"]);
	assert.equal(menuEnv.body.children.length, 0);
});
childrenOf(menuTree)[0].props.onClick();
menuTree = menuEnv.hooks.render(props);
ok("J2 open menu appends exactly one portal container to document.body", () => {
	assert.equal(menuEnv.body.children.length, 1);
	const container = menuEnv.body.children[0];
	assert.equal(container.className, "_shareHtml_portal");
	assert.equal(container.getAttribute("data-share-html-portal"), "");
	assert.equal(container.children.length, 1);
	const menuNode = container.children[0];
	assert.equal(menuNode.className, "_shareHtml_menu");
	assert.equal(menuNode.getAttribute("role"), "menu");
	assert.deepEqual(host(menuNode.children.map((item) => item.textContent)), [t("menu.preview"), t("menu.download"), t("menu.pick"), t("menu.publishHost"), t("menu.connect")]);
});
ok("J3 the menu is anchored under the trigger and right aligned", () => {
	const menuNode = menuEnv.body.children[0].children[0];
	assert.equal(menuNode.style.top, "70px");
	assert.equal(menuNode.style.right, "96px");
});
ok("J4 the wrapper subtree holds the trigger only, never the menu", () => {
	const kids = childrenOf(menuTree);
	assert.equal(kids.length, 1);
	assert.equal(kids[0].type, "button");
	assert.equal(kids[0].props.className, "_shareHtml_trigger");
	assert.equal(kids[0].props["aria-expanded"], true);
	const container = menuEnv.body.children[0];
	assert.equal(container.children[0].parentNode, container);
	assert.equal(menuEnv.body.contains(container.children[0]), true);
});
ok("J5 open state listens for scroll, resize, outside click and Escape", () => {
	assert.deepEqual(host(menuEnv.winListeners.map((entry) => entry.type)), ["scroll", "resize"]);
	assert.deepEqual(host(menuEnv.docListeners.map((entry) => entry.type)), ["click", "keydown"]);
});
const menuKeyDown = menuEnv.docListeners.filter((entry) => entry.type === "keydown")[0];
menuKeyDown.fn({ key: "Escape" });
menuTree = menuEnv.hooks.render(props);
ok("J6 Escape closes the menu and drops the body container", () => {
	assert.equal(menuEnv.body.children.length, 0);
	assert.deepEqual(host(childrenOf(menuTree).map((node) => node.type)), ["button"]);
	assert.equal(menuEnv.winListeners.length, 0);
	assert.equal(menuEnv.docListeners.length, 0);
});
childrenOf(menuTree)[0].props.onClick();
menuTree = menuEnv.hooks.render(props);
ok("J7 reopening recreates the body container", () => assert.equal(menuEnv.body.children.length, 1));
const menuPointer = menuEnv.docListeners.filter((entry) => entry.type === "click")[0];
menuPointer.fn({ target: menuEnv.body.children[0].children[0] });
menuTree = menuEnv.hooks.render(props);
ok("J8 a click inside the menu does not close it", () => {
	assert.equal(menuEnv.body.children.length, 1);
	assert.equal(menuEnv.docListeners.length, 2);
});
menuPointer.fn({ target: menuEnv.body });
menuTree = menuEnv.hooks.render(props);
ok("J9 a click outside the menu closes it and drops the body container", () => {
	assert.equal(menuEnv.body.children.length, 0);
	assert.equal(menuEnv.docListeners.length, 0);
});
childrenOf(menuTree)[0].props.onClick();
menuTree = menuEnv.hooks.render(props);
ok("J10 scroll re-anchors the mounted menu to the moved trigger", () => {
	menuEnv.doc.rect.bottom = 200;
	menuEnv.doc.rect.right = 500;
	menuEnv.winListeners.filter((entry) => entry.type === "scroll")[0].fn();
	const menuNode = menuEnv.body.children[0].children[0];
	assert.equal(menuNode.style.top, "206px");
	assert.equal(menuNode.style.right, "524px");
});
fetchCalls.length = 0;
menuEnv.anchors.length = 0;
fetchResults.length = 0;
fetchResults.push({ ok: false, status: 500 });
const menuPreviewItem = menuEnv.body.children[0].children[0].children[0];
menuPreviewItem.listeners.filter((entry) => entry.type === "click")[0].fn({ target: menuPreviewItem });
await flush();
await flush();
menuTree = menuEnv.hooks.render(props);
ok("J11 a failed preview keeps the menu open and reports inside it", () => {
	const container = menuEnv.body.children[0];
	assert.equal(container.className, "_shareHtml_portal");
	const menuNode = container.children[0];
	assert.equal(menuNode.children.length, 6);
	const notice = menuNode.children[5];
	assert.equal(notice.className, "_shareHtml_error");
	assert.equal(notice.getAttribute("role"), "status");
	assert.equal(notice.textContent, t("error.failed") + " (HTTP 500)");
	assert.equal(menuEnv.anchors.length, 1);
	assert.equal(menuEnv.anchors[0].href, "api/session.shareHtml?sessionId=sess-1&download=1");
});
menuEnv.hooks.unmount();
ok("J12 unmounting drops the body container and every listener", () => {
	assert.equal(menuEnv.body.children.length, 0);
	assert.equal(menuEnv.docListeners.length, 0);
	assert.equal(menuEnv.winListeners.length, 0);
	assert.equal(menuEnv.opened.length, 0);
});

// K. the injected stylesheet keeps the menu out of the header flow
ok("K1 the menu rule is out of flow and stacked above the app", () => {
	const menuRule = cssRules.filter((rule) => rule.selector === "._shareHtml_menu")[0];
	assert.ok(menuRule !== undefined);
	assert.ok(menuRule.declarations.includes("position:fixed"));
	assert.ok(menuRule.declarations.some((declaration) => /^z-index:2\d{9}$/.test(declaration)));
});
ok("K2 both mount hosts are fixed, collapsed and stacked above the app", () => {
	const portalRule = cssRules.filter((rule) => rule.selector === "._shareHtml_portal")[0];
	assert.ok(portalRule !== undefined);
	assert.ok(portalRule.declarations.includes("position:fixed"));
	assert.ok(portalRule.declarations.includes("width:0"));
	assert.ok(portalRule.declarations.includes("height:0"));
	assert.ok(portalRule.declarations.some((declaration) => /^z-index:2\d{9}$/.test(declaration)));
});
ok("K3 the fallback wrapper is a fixed box, not a growing column", () => {
	const wrapper = cssRules.filter((rule) => rule.selector === "._shareHtml_fallback")[0];
	assert.ok(wrapper !== undefined);
	assert.ok(wrapper.declarations.includes("position:relative"));
	assert.ok(wrapper.declarations.includes("width:28px"));
	assert.ok(wrapper.declarations.includes("height:24px"));
	assert.ok(wrapper.declarations.includes("flex:none"));
	assert.equal(wrapper.declarations.some((declaration) => /^flex-direction:column/.test(declaration)), false);
	assert.equal(wrapper.declarations.some((declaration) => /^gap:/.test(declaration)), false);
});
ok("K4 the trigger keeps a fixed 28x24 box", () => {
	const trigger = cssRules.filter((rule) => rule.selector === "._shareHtml_trigger")[0];
	assert.ok(trigger.declarations.includes("width:28px"));
	assert.ok(trigger.declarations.includes("height:24px"));
	assert.ok(trigger.declarations.includes("flex:none"));
	assert.deepEqual(host(cssRules.filter((rule) => rule.selector === "._shareHtml_moreButton")), []);
});
ok("K5 the preview layer covers the viewport above the menu", () => {
	const overlay = cssRules.filter((rule) => rule.selector === "._shareHtml_overlay")[0];
	assert.ok(overlay !== undefined);
	assert.ok(overlay.declarations.includes("position:fixed"));
	assert.ok(overlay.declarations.includes("inset:0"));
	const zIndex = overlay.declarations.filter((declaration) => declaration.startsWith("z-index:"))[0];
	assert.equal(zIndex, "z-index:2147483001");
});

// L. in-app preview layer lifecycle
const previewPlatform = makePlatform();
const previewEnv = loadWith(fetchStub, { platform: previewPlatform });
const previewMod = previewEnv.definition.factory(previewEnv.requireStub);
previewMod.apply(ctx);
previewEnv.hooks.setComponent(registrations[registrations.length - 1].component);
const previewProps = { sessionId: "sess-p", t };
let pTree = previewEnv.hooks.render(previewProps);
/** Queue a readable HEAD plus a document body the layer can mount. */
const queueUnreadable = () => {
	fetchResults.push({ ok: true, status: 200 }, { ok: true, status: 200, text: () => Promise.reject(new Error("boom")) });
};
/** Open the menu, pick preview and settle the request chain. @returns the overlay, or null. */
const openPreview = async (html) => {
	pTree = ensureMenu(previewEnv, pTree, previewProps);
	fetchCalls.length = 0;
	fetchResults.length = 0;
	queuePreview(html);
	clickEntry(previewEnv, 0);
	pTree = previewEnv.hooks.render(previewProps);
	await flush();
	await flush();
	pTree = previewEnv.hooks.render(previewProps);
	return previewEnv.body.children.length === 0 ? null : previewEnv.body.children[0];
};
const opener = previewEnv.doc.createElement("button");
previewEnv.doc.activeElement = opener;
pTree = previewEnv.hooks.render(previewProps);
const triggerNode = triggerOf(pTree).props.ref.current;
const layer = await openPreview("<html><body>layered</body></html>");
ok("L1 preview validates with HEAD then reads the document with a plain GET", () => {
	assert.equal(fetchCalls.length, 2);
	assert.equal(fetchCalls[0].init.method, "HEAD");
	assert.equal(fetchCalls[0].url, "api/session.shareHtml?sessionId=sess-p");
	assert.equal(fetchCalls[1].url, "api/session.shareHtml?sessionId=sess-p");
	assert.equal(fetchCalls[1].init, undefined);
	assert.equal(previewPlatform.blobs.length, 1);
	assert.deepEqual(host(previewPlatform.blobs[0].parts), ["<html><body>layered</body></html>"]);
	assert.equal(previewPlatform.blobs[0].type, "text/html");
});
ok("L2 the layer mounts on document.body as a full-viewport overlay", () => {
	assert.notEqual(layer, null);
	assert.equal(previewEnv.body.children.length, 1);
	assert.equal(layer.className, "_shareHtml_overlay");
	assert.equal(layer.getAttribute("role"), "dialog");
	assert.equal(layer.getAttribute("aria-modal"), "true");
	assert.equal(layer.children.length, 1);
	assert.equal(previewEnv.body.children[0].className, "_shareHtml_overlay");
	const panel = layer.children[0];
	assert.equal(panel.className, "_shareHtml_previewPanel");
	assert.equal(byClass(panel, "_shareHtml_previewBar").className, "_shareHtml_previewBar");
	assert.equal(byClass(byClass(panel, "_shareHtml_previewBar"), "_shareHtml_previewTitle").textContent, t("preview.title"));
	assert.equal(toolbarButton(panel, "_shareHtml_close").getAttribute("aria-label"), t("preview.close"));
});
ok("L3 the document renders inside a blob-backed iframe with a sandbox", () => {
	const frame = previewParts(previewEnv).frame;
	assert.equal(frame.tagName, "IFRAME");
	assert.equal(frame.className, "_shareHtml_frame");
	assert.equal(frame.getAttribute("sandbox"), "allow-same-origin");
	assert.deepEqual(host(previewPlatform.objectUrls.map((entry) => entry.id)), ["blob:share-1"]);
	assert.equal(frame.src, "blob:share-1");
	assert.equal(previewPlatform.objectUrls[0].blob.type, "text/html");
});
const closeButton = previewParts(previewEnv).close;
closeButton.listeners.filter((entry) => entry.type === "click")[0].fn({ target: closeButton });
ok("L4 the close button tears the layer down, revokes the URL and restores focus", () => {
	assert.equal(previewEnv.body.children.length, 0);
	assert.deepEqual(host(previewPlatform.revoked), ["blob:share-1"]);
	assert.equal(triggerNode !== null && triggerNode !== undefined, true);
	assert.equal(triggerNode.focused, 1);
	assert.equal(opener.focused, undefined);
	assert.equal(previewEnv.docListeners.length, 0);
});
const escLayer = await openPreview("<html><body>escape</body></html>");
ok("L5 a second preview mounts a fresh layer", () => {
	assert.equal(previewEnv.body.children.length, 1);
	assert.equal(previewParts(previewEnv).frame.src, "blob:share-2");
	assert.deepEqual(host(previewPlatform.objectUrls.map((entry) => entry.id)), ["blob:share-1", "blob:share-2"]);
});
previewEnv.docListeners.filter((entry) => entry.type === "keydown")[0].fn({ key: "Escape" });
ok("L6 Escape closes the layer and revokes its blob URL", () => {
	assert.equal(previewEnv.body.children.length, 0);
	assert.deepEqual(host(previewPlatform.revoked), ["blob:share-1", "blob:share-2"]);
	assert.equal(previewEnv.docListeners.length, 0);
});
const maskLayer = await openPreview("<html><body>mask</body></html>");
maskLayer.listeners.filter((entry) => entry.type === "click")[0].fn({ target: maskLayer });
ok("L7 a click on the mask closes the layer", () => {
	assert.equal(previewEnv.body.children.length, 0);
	assert.deepEqual(host(previewPlatform.revoked), ["blob:share-1", "blob:share-2", "blob:share-3"]);
});
previewEnv.anchors.length = 0;
pTree = ensureMenu(previewEnv, pTree, previewProps);
fetchCalls.length = 0;
fetchResults.length = 0;
queueUnreadable();
clickEntry(previewEnv, 0);
await flush();
await flush();
pTree = previewEnv.hooks.render(previewProps);
ok("L8 an unreadable document reports the error and degrades to a download", () => {
	const entries = entriesOf(previewEnv);
	assert.equal(entries.length, 6);
	const notice = entries[5];
	assert.equal(notice.className, "_shareHtml_error");
	assert.equal(notice.textContent.startsWith(t("error.failed") + " ("), true);
	assert.equal(notice.textContent.includes("boom"), true);
	assert.equal(previewEnv.anchors.length, 1);
	assert.equal(previewEnv.anchors[0].href, "api/session.shareHtml?sessionId=sess-p&download=1");
	assert.equal(previewEnv.anchors[0].download, "dsh-session-sess-p.html");
	assert.equal(previewEnv.anchors[0].clicked, 1);
	assert.equal(previewEnv.body.children[0].className, "_shareHtml_portal");
});
const barePlatform = makePlatform();
barePlatform.URL = {};
const bareEnv = loadWith(fetchStub, { platform: barePlatform });
const bareMod = bareEnv.definition.factory(bareEnv.requireStub);
bareMod.apply(ctx);
bareEnv.hooks.setComponent(registrations[registrations.length - 1].component);
let bareTree = bareEnv.hooks.render({ sessionId: "sess-b", t });
bareTree = ensureMenu(bareEnv, bareTree, { sessionId: "sess-b", t });
fetchCalls.length = 0;
fetchResults.length = 0;
clickEntry(bareEnv, 0);
await flush();
await flush();
bareTree = bareEnv.hooks.render({ sessionId: "sess-b", t });
ok("L9 a missing object-URL API reports the error and degrades to a download", () => {
	const entries = entriesOf(bareEnv);
	const notice = entries[entries.length - 1];
	assert.equal(notice.className, "_shareHtml_error");
	assert.equal(notice.textContent, t("error.failed") + " (createObjectURL)");
	assert.equal(fetchCalls.length, 1);
	assert.equal(fetchCalls[0].init.method, "HEAD");
	assert.equal(bareEnv.anchors.length, 1);
	assert.equal(bareEnv.anchors[0].href, "api/session.shareHtml?sessionId=sess-b&download=1");
	assert.equal(bareEnv.anchors[0].clicked, 1);
	assert.equal(bareEnv.body.children.length, 1);
	assert.equal(bareEnv.body.children[0].className, "_shareHtml_portal");
});
ok("L10 the preview path never opens a browser window", () => {
	assert.equal(previewEnv.opened.length, 0);
	assert.equal(live.opened.length, 0);
	assert.equal(bareEnv.opened.length, 0);
});

// M. diagnostics and the fixed-host fallback
ok("M1 a click and the mount emit at least two console.info lines", () => {
	const env = loadWith(fetchStub);
	const envMod = env.definition.factory(env.requireStub);
	envMod.apply(ctx);
	env.hooks.setComponent(registrations[registrations.length - 1].component);
	let envTree = env.hooks.render(props);
	assert.equal(env.info.length, 0);
	triggerOf(envTree).props.onClick();
	envTree = env.hooks.render(props);
	const lines = env.info.map((entry) => entry.message);
	assert.ok(lines.length >= 2);
	assert.ok(lines.some((line) => line.indexOf("[share-html] trigger click") === 0));
	assert.ok(lines.some((line) => line.indexOf("[share-html] mount decision") === 0));
	assert.ok(lines.some((line) => line.indexOf("[share-html] menu mounted") === 0));
});
ok("M2 the mount decision and mount line report the facts needed to debug", () => {
	const decision = previewEnv.info.filter((entry) => entry.message === "[share-html] mount decision")[0];
	assert.ok(decision !== undefined);
	assert.equal(decision.detail.canPortal, true);
	assert.equal(decision.detail.hasBody, true);
	assert.equal(decision.detail.hasRoot, true);
	const mounted = previewEnv.info.filter((entry) => entry.message === "[share-html] menu mounted")[0];
	assert.ok(mounted !== undefined);
	assert.equal(mounted.detail.host, "_shareHtml_portal");
	assert.equal(mounted.detail.top, "70px");
	assert.equal(mounted.detail.right, "96px");
	assert.equal(mounted.detail.width, 190);
	assert.equal(mounted.detail.height, 64);
	assert.equal(mounted.detail.entries, 5);
});
ok("M3 a zero-size menu warns that the stylesheet may be missing", () => {
	const zeroEnv = loadWith(fetchStub);
	zeroEnv.doc.sizes.width = 0;
	zeroEnv.doc.sizes.height = 0;
	const zeroMod = zeroEnv.definition.factory(zeroEnv.requireStub);
	zeroMod.apply(ctx);
	zeroEnv.hooks.setComponent(registrations[registrations.length - 1].component);
	let zeroTree = zeroEnv.hooks.render(props);
	zeroTree = clickTrigger(zeroEnv, zeroTree);
	assert.equal(zeroEnv.warn.length >= 1, true);
	assert.equal(zeroEnv.warn[0].message.indexOf("[share-html] menu measured zero size"), 0);
	assert.equal(zeroEnv.body.children.length, 1);
});
ok("M4 without document.body the menu renders position:fixed outside the wrapper", () => {
	const noBody = loadWith(fetchStub);
	delete noBody.doc.body;
	const noBodyMod = noBody.definition.factory(noBody.requireStub);
	noBodyMod.apply(ctx);
	noBody.hooks.setComponent(registrations[registrations.length - 1].component);
	let noBodyTree = noBody.hooks.render(props);
	assert.equal(noBody.doc.documentElement.children.length, 0);
	noBodyTree = clickTrigger(noBody, noBodyTree);
	const container = noBody.doc.documentElement.children[0];
	assert.equal(container.className, "_shareHtml_fixed");
	const menu = container.children[0];
	assert.equal(menu.className, "_shareHtml_menu");
	assert.equal(menu.style.position, "fixed");
	assert.equal(menu.style.top, "70px");
	assert.equal(menu.style.right, "96px");
	assert.deepEqual(host(childrenOf(noBodyTree).map((node) => node.type)), ["button"]);
	const decision = noBody.info.filter((entry) => entry.message === "[share-html] mount decision")[0];
	assert.equal(decision.detail.canPortal, false);
	assert.equal(decision.detail.hasBody, false);
	assert.equal(decision.detail.hasRoot, true);
});
ok("M5 a refused appendChild falls back to the document root", () => {
	const refused = loadWith(fetchStub);
	refused.doc.body.appendChild = () => { throw new Error("append refused"); };
	const refusedMod = refused.definition.factory(refused.requireStub);
	refusedMod.apply(ctx);
	refused.hooks.setComponent(registrations[registrations.length - 1].component);
	let refusedTree = refused.hooks.render(props);
	refusedTree = clickTrigger(refused, refusedTree);
	assert.equal(refused.doc.body.children.length, 0);
	assert.equal(refused.doc.documentElement.children.length, 1);
	assert.equal(refused.doc.documentElement.children[0].className, "_shareHtml_fixed");
	assert.equal(refused.info.some((entry) => entry.message.indexOf("[share-html] append refused") === 0), true);
	assert.equal(refusedTree.type, "div");
});
ok("M6 no host Menu branch is left and the trigger carries our own onClick", () => {
	assert.equal(source.includes("hostMenu"), false);
	assert.equal(source.includes("jsx(Menu"), false);
	assert.equal(source.includes("jsx(Button"), false);
	assert.equal(source.includes("createPortal"), false);
	assert.ok(/jsx\("button",\s*\{[\s\S]{0,400}?onClick:/.test(source));
	const trigger = triggerOf(live.hooks.render(props));
	assert.equal(trigger.type, "button");
	assert.equal(typeof trigger.props.onClick, "function");
});

ok("M7 a slot without a session id logs the skip instead of fetching", () => {
	const noId = loadWith(fetchStub);
	const noIdMod = noId.definition.factory(noId.requireStub);
	noIdMod.apply(ctx);
	noId.hooks.setComponent(registrations[registrations.length - 1].component);
	const noIdProps = { t };
	let noIdTree = noId.hooks.render(noIdProps);
	noIdTree = ensureMenu(noId, noIdTree, noIdProps);
	fetchCalls.length = 0;
	clickEntry(noId, 0);
	noIdTree = noId.hooks.render(noIdProps);
	assert.equal(fetchCalls.length, 0);
	assert.equal(noId.anchors.length, 0);
	assert.equal(noId.info.some((entry) => entry.message.indexOf("[share-html] run skipped") === 0), true);
	assert.equal(noIdTree.type, "div");
});

// N. per-message picker: index fetch, whole-row selection, preview hand-off
/** One index entry shaped like the v1 contract. */
const entryOf = (id, kind, label, time) => ({ id, kind, turn: 1, seq: Number(id.slice(1)), time, label, chars: label.length, tools: 0, context: 0 });
/** Queue one successful index answer. */
const queueIndex = (entries) => {
	fetchResults.push({ ok: true, status: 200, json: () => Promise.resolve({ sessionId: "sess-1", title: "sample", total: entries.length, entries }) });
};
/** Let the picker's promise chain settle, then re-render so effects clean up. */
const settle = async (env, renderProps) => {
	await flush();
	await flush();
	await flush();
	return env.hooks.render(renderProps);
};
/** Split the mounted picker layer into its parts. */
const pickParts = (env) => {
	const overlay = env.body.children[0];
	const panel = byClass(overlay, "_shareHtml_pickerPanel");
	const head = byClass(panel, "_shareHtml_pickerHead");
	return {
		overlay,
		panel,
		head,
		close: byClass(head, "_shareHtml_pickerClose"),
		tools: byClass(panel, "_shareHtml_pickerTools"),
		list: byClass(panel, "_shareHtml_pickerList"),
		notice: byClass(panel, "_shareHtml_pickerStatus"),
		hint: byClass(panel, "_shareHtml_pickerHint"),
		footer: byClass(panel, "_shareHtml_pickerFooter")
	};
};
const fire = (node, type, event) => node.listeners.filter((entry) => entry.type === type)[0].fn(event);
const rowClick = (row) => fire(row, "click", { target: row, stopPropagation() {} });
const buttonClick = (node) => fire(node, "click", { target: node, stopPropagation() {} });
const keyEvent = (key) => ({ key, preventDefault() {}, stopPropagation() {} });
/** Mount a fresh picker-capable environment and open the menu. */
const openPickerEnv = () => {
	const env = loadWith(fetchStub);
	const envMod = env.definition.factory(env.requireStub);
	envMod.apply(ctx);
	env.hooks.setComponent(registrations[registrations.length - 1].component);
	const envProps = { sessionId: "sess-1", t };
	let envTree = env.hooks.render(envProps);
	envTree = ensureMenu(env, envTree, envProps);
	return { env, envProps, tree: envTree };
};

const pickerWave = openPickerEnv();
const pickEnv = pickerWave.env;
const pickProps = pickerWave.envProps;
fetchCalls.length = 0;
fetchResults.length = 0;
queueIndex([entryOf("m12", "user", "第一条提问"), entryOf("m13", "assistant", "第一条回答"), { id: "m15", kind: "user", turn: 2, seq: 15, time: 1700000000000, label: "第二条提问", chars: 6, tools: 3, context: 2 }]);
buttonClick(entriesOf(pickEnv)[2]);
let pickTree = pickEnv.hooks.render(pickProps);
ok("N1 the third menu item closes the menu and fetches the index route", () => {
	assert.equal(fetchCalls.length, 1);
	assert.equal(fetchCalls[0].url, "api/session.shareIndex?sessionId=sess-1");
	assert.equal(fetchCalls[0].init, undefined);
	assert.equal(pickEnv.body.children.length, 1);
	assert.equal(pickEnv.body.children[0].className, "_shareHtml_picker");
	assert.equal(pickEnv.body.children[0].getAttribute("role"), "dialog");
	assert.equal(pickEnv.body.children[0].getAttribute("aria-modal"), "true");
});
pickTree = await settle(pickEnv, pickProps);
const parts = pickParts(pickEnv);
ok("N2 the picker lists exactly the entries the index returned", () => {
	assert.equal(parts.list.children.length, 3);
	const rows = parts.list.children;
	assert.deepEqual(host(rows.map((row) => row.getAttribute("role"))), ["checkbox", "checkbox", "checkbox"]);
	assert.deepEqual(host(rows.map((row) => row.getAttribute("tabindex"))), ["0", "0", "0"]);
	assert.deepEqual(host(rows.map((row) => row.children[0].tagName)), ["INPUT", "INPUT", "INPUT"]);
	assert.deepEqual(host(rows.map((row) => row.children[0].getAttribute("type"))), ["checkbox", "checkbox", "checkbox"]);
	assert.deepEqual(host(rows.map((row) => row.children[1].className)), ["_shareHtml_pickerBody", "_shareHtml_pickerBody", "_shareHtml_pickerBody"]);
	assert.deepEqual(host(rows.map((row) => row.getAttribute("aria-checked"))), ["false", "false", "false"]);
	assert.equal(parts.notice.textContent, "");
});
ok("N2b every row is role pill + one-line excerpt over a muted meta line", () => {
	const rows = parts.list.children;
	const lines = rows.map((row) => row.children[1].children[0]);
	const metas = rows.map((row) => row.children[1].children[1]);
	assert.deepEqual(host(lines.map((line) => line.className)), ["_shareHtml_pickerLine", "_shareHtml_pickerLine", "_shareHtml_pickerLine"]);
	assert.deepEqual(host(lines.map((line) => line.children[0].className)), ["_shareHtml_pickerWhoUser", "_shareHtml_pickerWhoAssistant", "_shareHtml_pickerWhoUser"]);
	assert.deepEqual(host(lines.map((line) => line.children[0].children[1].textContent)), [t("picker.you"), t("picker.assistant"), t("picker.you")]);
	assert.deepEqual(host(lines.map((line) => line.children[1].className)), ["_shareHtml_pickerLabel", "_shareHtml_pickerLabel", "_shareHtml_pickerLabel"]);
	assert.deepEqual(host(lines.map((line) => line.children[1].textContent)), ["第一条提问", "第一条回答", "第二条提问"]);
	assert.deepEqual(host(metas.map((meta) => meta.className)), ["_shareHtml_pickerMeta", "_shareHtml_pickerMeta", "_shareHtml_pickerMeta"]);
	assert.equal(metas[0].textContent, "");
	assert.equal(metas[0].children.length, 0);
	assert.ok(/^\d{2}:\d{2} · 工具 3 · 上下文 2$/.test(metas[2].textContent));
});
ok("N3 an empty selection disables generate and prompts for one", () => {
	assert.equal(parts.tools.children[2].textContent, "已选 0 条");
	assert.equal(parts.hint.textContent, t("picker.noneSelected"));
	assert.equal(parts.footer.children[0].getAttribute("disabled"), "disabled");
	assert.equal(parts.footer.children[0].textContent, t("picker.generate"));
});
rowClick(parts.list.children[0]);
ok("N4 clicking a whole row toggles its checkbox and the counter", () => {
	const row = parts.list.children[0];
	assert.equal(row.getAttribute("aria-checked"), "true");
	assert.equal(row.children[0].checked, true);
	assert.equal(parts.tools.children[2].textContent, "已选 1 条");
	assert.equal(parts.hint.textContent, "");
	assert.equal(parts.footer.children[0].getAttribute("disabled"), null);
});
fire(parts.list.children[2], "keydown", keyEvent(" "));
ok("N5 Space on a focused row toggles it too", () => {
	assert.equal(parts.list.children[2].getAttribute("aria-checked"), "true");
	assert.equal(parts.list.children[2].children[0].checked, true);
	assert.equal(parts.tools.children[2].textContent, "已选 2 条");
});
buttonClick(parts.tools.children[0]);
ok("N6 select all marks every row", () => {
	assert.deepEqual(host(parts.list.children.map((row) => row.getAttribute("aria-checked"))), ["true", "true", "true"]);
	assert.equal(parts.tools.children[2].textContent, "已选 3 条");
});
buttonClick(parts.tools.children[1]);
ok("N6b select none clears every row and disables generate again", () => {
	assert.deepEqual(host(parts.list.children.map((row) => row.getAttribute("aria-checked"))), ["false", "false", "false"]);
	assert.deepEqual(host(parts.list.children.map((row) => row.children[0].checked)), [false, false, false]);
	assert.equal(parts.tools.children[2].textContent, "已选 0 条");
	assert.equal(parts.footer.children[0].getAttribute("disabled"), "disabled");
});
buttonClick(parts.list.children[0]);
buttonClick(parts.list.children[2]);
fetchCalls.length = 0;
fetchResults.length = 0;
pickEnv.anchors.length = 0;
queuePreview("<html><body>picked</body></html>");
buttonClick(parts.footer.children[0]);
pickTree = pickEnv.hooks.render(pickProps);
await flush();
ok("N7 generate asks the render route for exactly the picked ids in list order", () => {
	assert.equal(fetchCalls.length, 2);
	assert.equal(fetchCalls[0].url, "api/session.shareHtml?sessionId=sess-1&pick=m12,m15");
	assert.equal(fetchCalls[0].init.method, "HEAD");
	assert.equal(fetchCalls[1].url, "api/session.shareHtml?sessionId=sess-1&pick=m12,m15");
	assert.equal(fetchCalls[1].init, undefined);
	assert.equal(pickEnv.body.children[0].className, "_shareHtml_picker");
});
pickTree = await settle(pickEnv, pickProps);
const pickLayer = pickEnv.body.children[0];
ok("N8 the generated document reuses the existing preview layer", () => {
	const preview = previewParts(pickEnv);
	assert.equal(pickEnv.body.children.length, 1);
	assert.equal(pickLayer.className, "_shareHtml_overlay");
	assert.equal(preview.frame.tagName, "IFRAME");
	assert.equal(preview.frame.src, "blob:share-1");
	assert.equal(pickEnv.platform.blobs[0].type, "text/html");
	assert.deepEqual(host(pickEnv.platform.blobs[0].parts), ["<html><body>picked</body></html>"]);
	assert.equal(preview.download.textContent, t("preview.download"));
	assert.equal(preview.close.getAttribute("aria-label"), t("preview.close"));
});
buttonClick(previewParts(pickEnv).download);
ok("N9 the layer download button hands the picked document to the browser", () => {
	assert.equal(pickEnv.anchors.length, 1);
	assert.equal(pickEnv.anchors[0].tagName, "A");
	assert.equal(pickEnv.anchors[0].href, "api/session.shareHtml?sessionId=sess-1&pick=m12,m15&download=1");
	assert.equal(pickEnv.anchors[0].download, "dsh-session-sess-1.html");
	assert.equal(pickEnv.anchors[0].clicked, 1);
});
ok("N10 the picker logs its open and generate steps", () => {
	const opened = pickEnv.info.filter((entry) => entry.message === "[share-html] picker open")[0];
	assert.ok(opened !== undefined);
	assert.equal(opened.detail.entries, 3);
	const generated = pickEnv.info.filter((entry) => entry.message === "[share-html] picker generate")[0];
	assert.ok(generated !== undefined);
	assert.equal(generated.detail.picked, 2);
});
buttonClick(previewParts(pickEnv).close);
ok("N11 closing the layer leaves no overlay behind", () => {
	assert.equal(pickEnv.body.children.length, 0);
	assert.equal(pickEnv.docListeners.length, 0);
});
const cancelWave = openPickerEnv();
fetchCalls.length = 0;
fetchResults.length = 0;
queueIndex([entryOf("m7", "user", "只有一条")]);
buttonClick(entriesOf(cancelWave.env)[2]);
pickTree = cancelWave.env.hooks.render(cancelWave.envProps);
pickTree = await settle(cancelWave.env, cancelWave.envProps);
buttonClick(pickParts(cancelWave.env).footer.children.filter((button) => button.textContent === t("picker.cancel"))[0]);
pickTree = cancelWave.env.hooks.render(cancelWave.envProps);
ok("N12 cancel drops the picker layer without touching the document", () => {
	assert.equal(cancelWave.env.body.children.length, 0);
	assert.equal(fetchCalls.length, 1);
	assert.equal(cancelWave.env.anchors.length, 0);
});
const escWave = openPickerEnv();
fetchCalls.length = 0;
fetchResults.length = 0;
queueIndex([entryOf("m7", "user", "只有一条")]);
buttonClick(entriesOf(escWave.env)[2]);
pickTree = escWave.env.hooks.render(escWave.envProps);
pickTree = await settle(escWave.env, escWave.envProps);
escWave.env.docListeners.filter((entry) => entry.type === "keydown")[0].fn(keyEvent("Escape"));
pickTree = escWave.env.hooks.render(escWave.envProps);
ok("N13 Escape closes the picker and drops its listener", () => {
	assert.equal(escWave.env.body.children.length, 0);
	assert.equal(escWave.env.docListeners.length, 0);
	assert.equal(triggerOf(pickTree).props["aria-expanded"], false);
});
const failWave = openPickerEnv();
fetchCalls.length = 0;
fetchResults.length = 0;
fetchResults.push({ ok: false, status: 500 });
buttonClick(entriesOf(failWave.env)[2]);
pickTree = failWave.env.hooks.render(failWave.envProps);
pickTree = await settle(failWave.env, failWave.envProps);
const failParts = pickParts(failWave.env);
ok("N14 a failed index reports inside the layer and keeps generate disabled", () => {
	assert.equal(failParts.notice.getAttribute("role"), "status");
	assert.equal(failParts.notice.textContent, t("picker.loadFailed") + " (HTTP 500)");
	assert.equal(failParts.list.children.length, 0);
	assert.equal(failParts.footer.children[0].getAttribute("disabled"), "disabled");
	assert.equal(failWave.env.body.children.length, 1);
});
const emptyWave = openPickerEnv();
fetchCalls.length = 0;
fetchResults.length = 0;
queueIndex([]);
buttonClick(entriesOf(emptyWave.env)[2]);
pickTree = emptyWave.env.hooks.render(emptyWave.envProps);
pickTree = await settle(emptyWave.env, emptyWave.envProps);
const emptyParts = pickParts(emptyWave.env);
ok("N15 an empty index shows the empty state and keeps generate disabled", () => {
	assert.equal(emptyParts.notice.textContent, t("picker.empty"));
	assert.equal(emptyParts.list.children.length, 0);
	assert.equal(emptyParts.tools.children[2].textContent, "已选 0 条");
	assert.equal(emptyParts.footer.children[0].getAttribute("disabled"), "disabled");
	assert.equal(emptyWave.env.anchors.length, 0);
});
ok("N16 the picker stylesheet is fixed, viewport-stacked and scrolls its list", () => {
	const pickerRule = cssRules.filter((rule) => rule.selector === "._shareHtml_picker")[0];
	assert.ok(pickerRule !== undefined);
	assert.ok(pickerRule.declarations.includes("position:fixed"));
	assert.ok(pickerRule.declarations.includes("inset:0"));
	assert.ok(pickerRule.declarations.includes("z-index:2147483001"));
	const listRule = cssRules.filter((rule) => rule.selector === "._shareHtml_pickerList")[0];
	assert.ok(listRule.declarations.includes("max-height:60vh"));
	assert.ok(listRule.declarations.includes("overflow:auto"));
	assert.ok(cssRules.some((rule) => rule.selector === "._shareHtml_download"));
});
ok("N17 the picker adds no host primitive, no portal helper and no window.open", () => {
	assert.equal(source.includes("createPortal"), false);
	assert.equal(source.includes("window.open"), false);
	assert.equal(source.includes("jsx(Menu"), false);
	assert.equal(source.includes("api/session.shareIndex"), true);
	assert.equal(fetchCalls.every((call) => typeof call.url === "string" && call.url.startsWith("api/session.share")), true);
});

// P. the reported visual defects: buttons off the window controls, opaque panel, readable rows
const ruleFor = (selector) => cssRules.filter((rule) => rule.selector === selector)[0];
const declarationOf = (rule, property) => (rule === undefined ? undefined : rule.declarations.filter((declaration) => declaration.startsWith(property + ":"))[0]);
const pixelsOf = (declaration) => (declaration === undefined ? -1 : Number((/(\d+)px/.exec(declaration) || [null, "-1"])[1]));
/** The --dsw-alias-* names this DSH build actually defines; a fallback form is only allowed on those. */
const REAL_ALIASES = ["label-primary", "label-primary-inverted", "label-tertiary", "state-error-primary", "state-error-secondary", "state-success-primary", "state-success-secondary", "state-warn-primary", "state-warn-secondary", "state-business-primary"];
const opaqueBackground = new RegExp("^background:(Canvas|var\\(--dsw-alias-(" + REAL_ALIASES.join("|") + "),Canvas\\))$");
const panelText = "color:var(--dsw-alias-label-primary,CanvasText)";
ok("P1 the preview panel is opaque and anchors its own buttons", () => {
	const panel = ruleFor("._shareHtml_previewPanel");
	assert.ok(panel !== undefined);
	assert.ok(panel.declarations.includes("position:relative"));
	assert.ok(opaqueBackground.test(declarationOf(panel, "background")));
	assert.equal(/color-mix\(in srgb,currentColor \d+%/.test(declarationOf(panel, "background")), false);
	assert.equal(declarationOf(panel, "color"), panelText);
});
ok("P2 the picker panel is opaque, wide and generously padded", () => {
	const panel = ruleFor("._shareHtml_pickerPanel");
	assert.ok(panel !== undefined);
	assert.ok(panel.declarations.includes("position:relative"));
	assert.ok(opaqueBackground.test(declarationOf(panel, "background")));
	assert.equal(/color-mix\(in srgb,currentColor \d+%/.test(declarationOf(panel, "background")), false);
	assert.equal(declarationOf(panel, "color"), panelText);
	assert.equal(declarationOf(panel, "width"), "width:min(720px,92vw)");
	const padding = pixelsOf(declarationOf(panel, "padding"));
	assert.ok(padding >= 18 && padding <= 24, "panel padding must be 18-24px, got " + padding);
	assert.ok(panel.declarations.includes("border-radius:12px"));
	assert.equal(panel.declarations.filter((declaration) => /^border:1px /.test(declaration)).length, 1);
	assert.equal(declarationOf(panel, "gap"), "gap:12px");
});
ok("P3 both masks keep the panel at least 40px away from every viewport edge", () => {
	for (const selector of ["._shareHtml_overlay", "._shareHtml_picker"]) {
		const rule = ruleFor(selector);
		assert.ok(rule !== undefined, selector + " missing");
		assert.ok(rule.declarations.includes("position:fixed"));
		assert.ok(rule.declarations.includes("inset:0"));
		assert.ok(rule.declarations.includes("z-index:2147483001"));
		assert.equal(declarationOf(rule, "padding"), "padding:48px 40px");
	}
});
ok("P4 both panels carry a 48px toolbar with side padding, a hairline and an in-flow button group", () => {
	const previewBar = ruleFor("._shareHtml_previewBar");
	const pickerBar = ruleFor("._shareHtml_pickerHead");
	for (const pair of [["previewBar", previewBar], ["pickerHead", pickerBar]]) {
		const name = pair[0];
		const bar = pair[1];
		assert.ok(bar !== undefined, name + " missing");
		assert.equal(declarationOf(bar, "height"), "height:48px", name + " height");
		assert.equal(declarationOf(bar, "display"), "display:flex", name + " display");
		assert.ok(/^padding:0 /.test(declarationOf(bar, "padding") || ""), name + " must pad horizontally only");
		assert.ok(/^border-bottom:1px /.test(declarationOf(bar, "border-bottom")), name + " hairline");
		assert.ok(bar.declarations.includes("align-items:center"), name + " centring");
	}
	assert.equal(declarationOf(previewBar, "padding"), "padding:0 16px");
	assert.equal(declarationOf(previewBar, "gap"), "gap:8px");
	assert.equal(declarationOf(pickerBar, "padding"), "padding:0 20px");
	const actions = ruleFor("._shareHtml_previewActions");
	assert.ok(actions !== undefined);
	assert.equal(declarationOf(actions, "margin-left"), "margin-left:auto");
	assert.equal(declarationOf(actions, "gap"), "gap:8px");
});
ok("P4b no toolbar button is absolutely positioned and all three share one visual spec", () => {
	assert.equal(cssText.includes("position:absolute"), false);
	assert.equal(/(^|;)(top|right):\d+px/.test(cssText), false, "no px corner offsets anywhere in the stylesheet");
	for (const selector of ["._shareHtml_close", "._shareHtml_download", "._shareHtml_pickerClose"]) {
		const rule = ruleFor(selector);
		assert.ok(rule !== undefined, selector + " missing");
		assert.equal(rule.declarations.some((declaration) => /^position:/.test(declaration)), false, selector + " must stay in flow");
		assert.equal(declarationOf(rule, "top"), undefined, selector + " must carry no top offset");
		assert.equal(declarationOf(rule, "right"), undefined, selector + " must carry no right offset");
		assert.equal(declarationOf(rule, "height"), "height:32px", selector + " height");
		assert.equal(declarationOf(rule, "border-radius"), "border-radius:8px", selector + " radius");
		assert.equal(declarationOf(rule, "border"), "border:1px solid color-mix(in srgb,CanvasText 18%,transparent)", selector + " border");
		assert.ok(rule.declarations.includes("background:transparent"), selector + " resting background");
		assert.ok(rule.declarations.includes("color:inherit"), selector + " colour");
		assert.ok(rule.declarations.includes("display:inline-flex") && rule.declarations.includes("align-items:center") && rule.declarations.includes("justify-content:center"), selector + " centres its label");
		assert.equal(declarationOf(ruleFor(selector + ":hover"), "background"), "background:color-mix(in srgb,CanvasText 10%,transparent)", selector + " hover");
		const focus = ruleFor(selector + ":focus-visible");
		assert.ok(focus !== undefined && /^outline:2px solid color-mix\(in srgb,CanvasText \d+%/.test(declarationOf(focus, "outline")), selector + " focus ring");
	}
	const close = ruleFor("._shareHtml_close");
	assert.equal(declarationOf(close, "width"), "width:32px");
	assert.equal(declarationOf(close, "font-size"), "font-size:18px");
	assert.equal(declarationOf(ruleFor("._shareHtml_pickerClose"), "width"), "width:32px");
	assert.equal(declarationOf(ruleFor("._shareHtml_download"), "padding"), "padding:0 12px");
	assert.equal(declarationOf(ruleFor("._shareHtml_download"), "width"), undefined);
});
ok("P4c the iframe still fills the body row under the toolbar", () => {
	const body = ruleFor("._shareHtml_previewBody");
	assert.ok(body !== undefined);
	assert.ok(body.declarations.includes("flex:1"));
	assert.ok(body.declarations.includes("min-height:0"));
	const frame = ruleFor("._shareHtml_frame");
	assert.ok(frame.declarations.includes("flex:1"));
	assert.ok(frame.declarations.includes("min-height:0"));
	assert.ok(frame.declarations.includes("height:100%"));
	assert.equal(frame.declarations.some((declaration) => /^(height:\d+px|max-height:)/.test(declaration)), false, "frame must not carry a fixed height");
	assert.ok(ruleFor("._shareHtml_previewPanel").declarations.includes("flex-direction:column"));
	assert.ok(ruleFor("._shareHtml_previewPanel").declarations.includes("position:relative"));
	assert.ok(ruleFor("._shareHtml_pickerPanel").declarations.includes("position:relative"));
});
ok("P5 picker rows carry padding, a hairline separator, radius and visible hover/focus", () => {
	const row = ruleFor("._shareHtml_pickerRow");
	assert.ok(row !== undefined);
	assert.equal(declarationOf(row, "padding"), "padding:10px 12px");
	assert.ok(/^border-bottom:1px /.test(declarationOf(row, "border-bottom")));
	assert.ok(row.declarations.includes("border-radius:8px"));
	const hover = ruleFor("._shareHtml_pickerRow:hover");
	assert.ok(hover !== undefined && /^background:color-mix\(in srgb,CanvasText \d+%/.test(declarationOf(hover, "background")));
	const focus = ruleFor("._shareHtml_pickerRow:focus-visible");
	assert.ok(focus !== undefined && declarationOf(focus, "outline") !== undefined);
	assert.ok(ruleFor("._shareHtml_pickerRow[aria-checked=\"true\"]") !== undefined);
});
ok("P6 the excerpt stays one line and the meta line is muted and smaller", () => {
	const label = ruleFor("._shareHtml_pickerLabel");
	assert.ok(label !== undefined);
	assert.ok(label.declarations.includes("overflow:hidden"));
	assert.ok(label.declarations.includes("text-overflow:ellipsis"));
	assert.ok(label.declarations.includes("white-space:nowrap"));
	assert.equal(declarationOf(label, "font-size"), "font-size:14px");
	assert.equal(declarationOf(label, "line-height"), "line-height:1.5");
	const meta = ruleFor("._shareHtml_pickerMeta");
	assert.ok(meta !== undefined);
	assert.equal(declarationOf(meta, "font-size"), "font-size:12px");
	assert.equal(declarationOf(meta, "color"), "color:color-mix(in srgb,currentColor 62%,transparent)");
	assert.ok(meta.declarations.includes("text-overflow:ellipsis"));
	assert.ok(ruleFor("._shareHtml_pickerLine") !== undefined);
	assert.ok(ruleFor("._shareHtml_pickerWhoUser") !== undefined);
	assert.ok(ruleFor("._shareHtml_pickerWhoAssistant") !== undefined);
});
ok("P7 the footer actions are right aligned, spaced from the content and visibly disabled", () => {
	const footer = ruleFor("._shareHtml_pickerFooter");
	assert.ok(footer !== undefined);
	assert.ok(footer.declarations.includes("justify-content:flex-end"));
	assert.ok(pixelsOf(declarationOf(footer, "padding-top")) >= 12);
	assert.ok(/^border-top:1px /.test(declarationOf(footer, "border-top")));
	const primary = ruleFor("._shareHtml_primary");
	assert.ok(/^background:color-mix\(in srgb,CanvasText \d+%/.test(declarationOf(primary, "background")));
	assert.ok(primary.declarations.includes("font-weight:600"));
	const disabled = declarationOf(ruleFor("._shareHtml_primary:disabled"), "opacity");
	assert.ok(Number((disabled || "opacity:1").split(":")[1]) <= 0.5);
});
ok("P7b only theme variables this DSH build really defines are referenced", () => {
	const referenced = [...new Set((cssText.match(/--dsw-alias-[a-z-]+/g) || []).map((name) => name.replace("--dsw-alias-", "")))];
	assert.deepEqual(host(referenced.sort()), ["label-primary", "state-business-primary", "state-error-primary"]);
	const offenders = referenced.filter((name) => !REAL_ALIASES.includes(name));
	assert.deepEqual(host(offenders), []);
	// Every alias the file names anywhere - not just in the stylesheet - must exist in this DSH build.
	const namedInSource = [...new Set((source.match(/--dsw-alias-[a-z-]+/g) || []).map((name) => name.replace("--dsw-alias-", "")))];
	assert.deepEqual(host(namedInSource.filter((name) => !REAL_ALIASES.includes(name))), []);
	assert.deepEqual(host(namedInSource.sort()), ["label-primary", "state-business-primary", "state-error-primary"]);
	assert.equal(declarationOf(ruleFor("._shareHtml_pickerStatus"), "color"), "color:var(--dsw-alias-state-error-primary,CanvasText)");
	assert.equal(declarationOf(ruleFor("._shareHtml_error"), "color"), "color:var(--dsw-alias-state-error-primary,CanvasText)");
	assert.equal(declarationOf(ruleFor("._shareHtml_frame"), "background"), "background:Canvas");
});
const mockCssOf = (text) => {
	const match = /\n<style data-mock-css="share-html">([\s\S]*?)<\/style>/.exec(text);
	return match === null ? null : match[1];
};
const pickerMock = readFileSync(path.join(here, "out", "picker-mock.html"), "utf8");
const previewMock = readFileSync(path.join(here, "out", "preview-mock.html"), "utf8");
ok("P8 both mock pages carry the injected stylesheet byte for byte", () => {
	assert.equal(mockCssOf(pickerMock), cssText);
	assert.equal(mockCssOf(previewMock), cssText);
	for (const page of [pickerMock, previewMock]) {
		const named = [...new Set((page.match(/--dsw-alias-[a-z-]+/g) || []).map((name) => name.replace("--dsw-alias-", "")))];
		assert.deepEqual(host(named.filter((name) => !REAL_ALIASES.includes(name))), []);
	}
	assert.ok(pickerMock.includes("var(--dsw-alias-label-primary, CanvasText)"));
	assert.ok(pickerMock.includes("background:Canvas"));
});
ok("P9 the picker mock shows 12 rows, long excerpts, meta lines and both button states", () => {
	const mainList = pickerMock.slice(pickerMock.indexOf('class="_shareHtml_pickerList"'), pickerMock.indexOf('class="_shareHtml_pickerStatus"'));
	assert.equal((mainList.match(/class="_shareHtml_pickerRow"/g) || []).length, 12);
	assert.ok(pickerMock.includes("工具 4 · 上下文 2"));
	assert.ok(pickerMock.includes("14:29 · 工具 4 · 上下文 2"));
	assert.ok(pickerMock.includes('class="_shareHtml_primary" disabled'));
	assert.ok(pickerMock.includes("已选 0 条"));
	assert.ok(pickerMock.includes("已选 4 条"));
	assert.ok(pickerMock.includes("窗口控制区"));
	assert.ok(pickerMock.includes("48px"));
	assert.ok(pickerMock.includes("40px"));
	assert.ok(pickerMock.includes('class="_shareHtml_pickerClose"'));
});
ok("P10 the preview mock shows the panel toolbar, both buttons and the control-area warning", () => {
	assert.ok(previewMock.includes('class="_shareHtml_previewPanel"'));
	assert.ok(previewMock.includes('class="_shareHtml_previewBar"'));
	assert.ok(previewMock.includes('class="_shareHtml_previewTitle"'));
	assert.ok(previewMock.includes('class="_shareHtml_download"'));
	assert.ok(previewMock.includes('class="_shareHtml_close"'));
	assert.ok(previewMock.includes("窗口控制区"));
	assert.ok(previewMock.includes("48px（mask 上内边距）"));
});

// Q. the three close paths still work after the panel restructure
const closeEnv = loadWith(fetchStub);
const closeMod = closeEnv.definition.factory(closeEnv.requireStub);
closeMod.apply(ctx);
closeEnv.hooks.setComponent(registrations[registrations.length - 1].component);
const closeProps = { sessionId: "sess-x", t };
let closeTree = closeEnv.hooks.render(closeProps);
/** Open the menu, preview the document and return the mounted layer parts. */
const openLayer = async () => {
	closeTree = ensureMenu(closeEnv, closeTree, closeProps);
	fetchCalls.length = 0;
	fetchResults.length = 0;
	queuePreview("<html><body>close-path</body></html>");
	clickEntry(closeEnv, 0);
	closeTree = closeEnv.hooks.render(closeProps);
	await flush();
	await flush();
	closeTree = closeEnv.hooks.render(closeProps);
	return previewParts(closeEnv);
};
let closeParts = await openLayer();
buttonClick(closeParts.close);
ok("Q1 the panel close button still closes and revokes the blob", () => {
	assert.equal(closeEnv.body.children.length, 0);
	assert.deepEqual(host(closeEnv.platform.revoked), ["blob:share-1"]);
});
closeParts = await openLayer();
fire(closeParts.overlay, "click", { target: closeParts.overlay });
ok("Q2 clicking the mask still closes and revokes the blob", () => {
	assert.equal(closeEnv.body.children.length, 0);
	assert.deepEqual(host(closeEnv.platform.revoked), ["blob:share-1", "blob:share-2"]);
});
closeParts = await openLayer();
closeEnv.docListeners.filter((entry) => entry.type === "keydown")[0].fn(keyEvent("Escape"));
ok("Q3 Escape still closes and revokes the blob", () => {
	assert.equal(closeEnv.body.children.length, 0);
	assert.deepEqual(host(closeEnv.platform.revoked), ["blob:share-1", "blob:share-2", "blob:share-3"]);
});
	closeParts = await openLayer();
ok("Q3b the toolbar holds title plus one action group, and the iframe keeps its own body row", () => {
	assert.equal(closeParts.bar.children.length, 2);
	assert.equal(closeParts.bar.children[0].className, "_shareHtml_previewTitle");
	assert.equal(closeParts.bar.children[1].className, "_shareHtml_previewActions");
	assert.deepEqual(host(closeParts.actions.children.map((node) => node.className)), ["_shareHtml_download", "_shareHtml_close"]);
	assert.deepEqual(host(closeParts.panel.children.map((node) => node.className)), ["_shareHtml_previewBar", "_shareHtml_previewBody"]);
	assert.equal(closeParts.body.children.length, 1);
	assert.equal(closeParts.body.children[0].tagName, "IFRAME");
	assert.equal(closeParts.panel.contains(closeParts.frame), true);
	assert.equal(closeParts.actions.contains(closeParts.close), true);
});
buttonClick(closeParts.close);
ok("Q3c the three close paths all end with the same revocation", () => {
	assert.equal(closeEnv.body.children.length, 0);
	assert.deepEqual(host(closeEnv.platform.revoked), ["blob:share-1", "blob:share-2", "blob:share-3", "blob:share-4"]);
	assert.equal(closeEnv.docListeners.length, 0);
});
const pickCloseWave = openPickerEnv();
fetchCalls.length = 0;
fetchResults.length = 0;
queueIndex([entryOf("m7", "user", "只有一条")]);
buttonClick(entriesOf(pickCloseWave.env)[2]);
closeTree = pickCloseWave.env.hooks.render(pickCloseWave.envProps);
closeTree = await settle(pickCloseWave.env, pickCloseWave.envProps);
ok("Q4 the picker panel exposes a labelled close button inside the panel", () => {
	const quietParts = pickParts(pickCloseWave.env);
	assert.ok(quietParts.close !== null);
	assert.equal(quietParts.close.getAttribute("aria-label"), t("picker.close"));
	assert.equal(quietParts.close.textContent, "×");
	assert.equal(quietParts.close.className, "_shareHtml_pickerClose");
});
buttonClick(pickParts(pickCloseWave.env).close);
closeTree = pickCloseWave.env.hooks.render(pickCloseWave.envProps);
ok("Q5 the picker close button drops the layer", () => {
	assert.equal(pickCloseWave.env.body.children.length, 0);
	assert.equal(pickCloseWave.env.docListeners.length, 0);
});
const pickMaskWave = openPickerEnv();
fetchCalls.length = 0;
fetchResults.length = 0;
queueIndex([entryOf("m7", "user", "只有一条")]);
buttonClick(entriesOf(pickMaskWave.env)[2]);
closeTree = pickMaskWave.env.hooks.render(pickMaskWave.envProps);
closeTree = await settle(pickMaskWave.env, pickMaskWave.envProps);
fire(pickParts(pickMaskWave.env).overlay, "click", { target: pickParts(pickMaskWave.env).overlay });
closeTree = pickMaskWave.env.hooks.render(pickMaskWave.envProps);
ok("Q6 clicking the picker mask drops the layer", () => {
	assert.equal(pickMaskWave.env.body.children.length, 0);
	assert.equal(pickMaskWave.env.docListeners.length, 0);
});

// R. the two speakers must be told apart without reading the label
const ACCENT_ALIAS = "var(--dsw-alias-state-business-primary,CanvasText)";
/** WCAG relative luminance of one sRGB triple. */
const luminanceOf = (rgb) => {
	const channel = (value) => {
		const scaled = value / 255;
		return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
};
/** WCAG contrast ratio between two sRGB triples. */
const contrastOf = (a, b) => {
	const high = Math.max(luminanceOf(a), luminanceOf(b));
	const low = Math.min(luminanceOf(a), luminanceOf(b));
	return (high + 0.05) / (low + 0.05);
};
/** color-mix(in srgb, a weight%, b) on gamma-encoded channels, as browsers do it. */
const mixOf = (a, b, weight) => a.map((value, index) => Math.round(value * weight + b[index] * (1 - weight)));
ok("R1 the two speakers are two different identities, not one badge with two words", () => {
	const user = ruleFor("._shareHtml_pickerWhoUser");
	const assistant = ruleFor("._shareHtml_pickerWhoAssistant");
	assert.ok(user !== undefined && assistant !== undefined);
	assert.ok(/^background:color-mix\(in srgb,var\(--dsw-alias-state-business-primary,CanvasText\) \d+%,CanvasText\)$/.test(declarationOf(user, "background")));
	assert.equal(declarationOf(user, "border"), undefined);
	assert.equal(declarationOf(user, "font-weight"), "font-weight:600");
	assert.equal(declarationOf(user, "color"), "color:Canvas");
	assert.equal(declarationOf(assistant, "background"), "background:transparent");
	assert.ok(/^border:1px solid color-mix\(in srgb,CanvasText \d+%/.test(declarationOf(assistant, "border")));
	assert.equal(declarationOf(assistant, "font-weight"), "font-weight:400");
	assert.ok(/^color:color-mix\(in srgb,CanvasText \d+%/.test(declarationOf(assistant, "color")));
	const diamond = ruleFor("._shareHtml_pickerMarkUser");
	const round = ruleFor("._shareHtml_pickerMarkAssistant");
	assert.equal(declarationOf(diamond, "border-radius"), "border-radius:2px");
	assert.equal(declarationOf(diamond, "transform"), "transform:rotate(45deg)");
	assert.equal(declarationOf(diamond, "background"), "background:Canvas");
	assert.equal(declarationOf(round, "border-radius"), "border-radius:50%");
	assert.ok(/^background:var\(--dsw-alias-state-business-primary,CanvasText\)$/.test(declarationOf(round, "background")));
	assert.ok(/^box-shadow:0 0 0 2px color-mix/.test(declarationOf(round, "box-shadow")));
	assert.equal(declarationOf(ruleFor("._shareHtml_pickerWhoUser"), "min-width"), "min-width:52px");
	assert.equal(declarationOf(ruleFor("._shareHtml_pickerWhoAssistant"), "min-width"), "min-width:52px");
});
const roleWave = openPickerEnv();
fetchCalls.length = 0;
fetchResults.length = 0;
queueIndex([entryOf("m21", "user", "连续的第一条提问"), entryOf("m22", "user", "连续的第二条提问"), entryOf("m23", "assistant", "助手的回答，足够长以至于必须被截断以便检查省略号是否生效，这一行不应该换行堆叠")]);
buttonClick(entriesOf(roleWave.env)[2]);
let roleTree = roleWave.env.hooks.render(roleWave.envProps);
roleTree = await settle(roleWave.env, roleWave.envProps);
const roleRows = pickParts(roleWave.env).list.children;
ok("R2 every row carries its speaker in the DOM, with the matching mark shape", () => {
	assert.deepEqual(host(roleRows.map((row) => row.getAttribute("data-kind"))), ["user", "user", "assistant"]);
	const lines = roleRows.map((row) => row.children[1].children[0]);
	const badges = lines.map((line) => line.children[0]);
	assert.deepEqual(host(badges.map((badge) => badge.className)), ["_shareHtml_pickerWhoUser", "_shareHtml_pickerWhoUser", "_shareHtml_pickerWhoAssistant"]);
	assert.deepEqual(host(badges.map((badge) => badge.children[0].className)), ["_shareHtml_pickerMarkUser", "_shareHtml_pickerMarkUser", "_shareHtml_pickerMarkAssistant"]);
	assert.deepEqual(host(badges.map((badge) => badge.children[0].tagName)), ["I", "I", "I"]);
	assert.deepEqual(host(badges.map((badge) => badge.children[1].className)), ["_shareHtml_pickerWhoName", "_shareHtml_pickerWhoName", "_shareHtml_pickerWhoName"]);
	assert.deepEqual(host(badges.map((badge) => badge.children[1].textContent)), [t("picker.you"), t("picker.you"), t("picker.assistant")]);
	assert.deepEqual(host(lines.map((line) => line.children[1].className)), ["_shareHtml_pickerLabel", "_shareHtml_pickerLabel", "_shareHtml_pickerLabel"]);
});
ok("R3 only the human rows carry the accent tint and the 3px bar", () => {
	const human = ruleFor('._shareHtml_pickerRow[data-kind="user"]');
	const machine = ruleFor('._shareHtml_pickerRow[data-kind="assistant"]');
	assert.ok(human !== undefined && machine !== undefined);
	assert.equal(declarationOf(human, "background"), "background:color-mix(in srgb,var(--dsw-alias-state-business-primary,CanvasText) 6%,transparent)");
	assert.equal(declarationOf(human, "box-shadow"), "box-shadow:inset 3px 0 0 color-mix(in srgb,var(--dsw-alias-state-business-primary,CanvasText) 70%,transparent)");
	assert.equal(declarationOf(machine, "background"), "background:transparent");
	assert.equal(declarationOf(machine, "box-shadow"), "box-shadow:none");
	assert.equal((cssText.match(/inset 3px/g) || []).length, 1);
	assert.equal((cssText.match(/data-kind="user"/g) || []).length, 4);
	assert.equal((cssText.match(/data-kind="assistant"/g) || []).length, 1);
});
ok("R4 hover, checked and focus all stay visible on both row kinds", () => {
	const humanHover = ruleFor('._shareHtml_pickerRow[data-kind="user"]:hover');
	const humanChecked = ruleFor('._shareHtml_pickerRow[data-kind="user"][aria-checked="true"]');
	const humanFocus = ruleFor('._shareHtml_pickerRow[data-kind="user"]:focus-visible');
	assert.ok(humanHover !== undefined && humanChecked !== undefined && humanFocus !== undefined);
	assert.equal(declarationOf(humanHover, "background"), "background:color-mix(in srgb,var(--dsw-alias-state-business-primary,CanvasText) 13%,transparent)");
	assert.equal(declarationOf(humanChecked, "background"), "background:color-mix(in srgb,var(--dsw-alias-state-business-primary,CanvasText) 21%,transparent)");
	assert.ok(declarationOf(humanFocus, "outline").includes(ACCENT_ALIAS));
	assert.equal(declarationOf(ruleFor("._shareHtml_pickerRow:hover"), "background"), "background:color-mix(in srgb,CanvasText 7%,transparent)");
	assert.equal(declarationOf(ruleFor("._shareHtml_pickerRow[aria-checked=\"true\"]"), "background"), "background:color-mix(in srgb,CanvasText 12%,transparent)");
	assert.ok(declarationOf(ruleFor("._shareHtml_pickerRow:focus-visible"), "outline").includes("CanvasText 55%"));
	const accents = [...new Set(cssRules.filter((rule) => rule.selector.includes("data-kind")).flatMap((rule) => rule.declarations.filter((declaration) => /^background:color-mix/.test(declaration))))];
	assert.equal(new Set(accents).size, 3);
});
ok("R5 the user pill keeps at least 4.5:1 against its own background in both themes", () => {
	const pillWeight = 0.76;
	const themes = [
		{ name: "light", canvasText: [0, 0, 0], canvas: [255, 255, 255], accents: [[42, 85, 200], [58, 109, 240], [124, 58, 237], [13, 148, 136]] },
		{ name: "dark", canvasText: [255, 255, 255], canvas: [0, 0, 0], accents: [[122, 162, 255], [91, 140, 255], [167, 139, 250], [45, 212, 191]] }
	];
	const measured = [];
	for (const theme of themes) {
		for (const accent of theme.accents) {
			const pill = mixOf(accent, theme.canvasText, pillWeight);
			measured.push({ theme: theme.name, accent, ratio: contrastOf(pill, theme.canvas) });
		}
		const fallbackPill = mixOf(theme.canvasText, theme.canvasText, pillWeight);
		measured.push({ theme: theme.name, accent: theme.canvasText, ratio: contrastOf(fallbackPill, theme.canvas) });
	}
	const worst = measured.reduce((low, entry) => (entry.ratio < low.ratio ? entry : low), measured[0]);
	assert.ok(worst.ratio >= 4.5, "worst user pill contrast " + worst.ratio.toFixed(2) + ":1");
	const labels = measured.map((entry) => entry.theme + " rgb(" + entry.accent.join(",") + ")=" + entry.ratio.toFixed(2));
	console.log("user pill contrast: " + labels.join(" | "));
	// the CanvasText mix is what buys the margin: the raw brand blue is only 4.54:1 on white
	const raw = contrastOf([58, 109, 240], [255, 255, 255]);
	const mixedBlue = contrastOf(mixOf([58, 109, 240], [0, 0, 0], pillWeight), [255, 255, 255]);
	assert.ok(mixedBlue > raw, "mix must raise the raw accent: " + raw.toFixed(2) + " -> " + mixedBlue.toFixed(2));
	console.log("raw brand blue on white: " + raw.toFixed(2) + ":1 -> with the CanvasText 76% mix: " + mixedBlue.toFixed(2) + ":1");
	const assistantText = [36, 36, 36];
	assert.ok(contrastOf(assistantText, [255, 255, 255]) >= 4.5);
	assert.ok(contrastOf(mixOf([255, 255, 255], [0, 0, 0], 0.86), [0, 0, 0]) >= 4.5);
	console.log("assistant label contrast: light=" + contrastOf(assistantText, [255, 255, 255]).toFixed(2) + ":1 dark=" + contrastOf(mixOf([255, 255, 255], [0, 0, 0], 0.86), [0, 0, 0]).toFixed(2) + ":1");
});

console.log("scoping: " + cssSelectors.length + " selectors, " + host(cssSelectors.filter((selector) => selector.startsWith("._shareHtml_"))).length + " carry the _shareHtml_ prefix");
console.log("theme-safe background declarations: " + cssDeclarations.filter((declaration) => /^background(-color)?\s*:/i.test(declaration)).join(" | "));
console.log(checks.length + " assertions passed");
for (const name of checks) console.log("  ok - " + name);
