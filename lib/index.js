import { renderSessionHtml } from "./render.js";
import { createRedactor } from "./redact.js";

export const name = "session-share-html";
export const inject = ["commands", "connection"];

const ROUTE_PATH = "/api/session.shareHtml";
const INDEX_ROUTE_PATH = "/api/session.shareIndex";
const TOOL_NAME = "share_conversation_html";
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PICK_ID_PATTERN = /^m\d+$/u;
const MAX_PICK_IDS = 500;
const NOT_FOUND = "not-found";
const UNAVAILABLE = "unavailable";
const PLAIN_HEADERS = {
	"content-type": "text/plain; charset=utf-8",
	"cache-control": "no-store",
	"x-content-type-options": "nosniff"
};
const JSON_HEADERS = {
	"content-type": "application/json; charset=utf-8",
	"cache-control": "no-store",
	"x-content-type-options": "nosniff"
};

function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}

function reportWarn(ctx, message) {
	try {
		ctx.logger?.warn?.("[session-share-html] " + message);
	} catch {}
}

function shareError(kind) {
	const error = new Error("session share " + kind);
	error.shareKind = kind;
	return error;
}

function optionalService(ctx, serviceName) {
	try {
		return typeof ctx.get === "function" ? ctx.get(serviceName) ?? void 0 : void 0;
	} catch {
		return void 0;
	}
}

function toDisposer(value) {
	if (typeof value === "function") return value;
	if (value !== null && typeof value === "object" && typeof value[Symbol.dispose] === "function") {
		return () => value[Symbol.dispose]();
	}
	return () => {};
}

function withEffect(ctx, label, run) {
	try {
		ctx.effect(() => {
			try {
				return toDisposer(run());
			} catch (error) {
				reportWarn(ctx, label + " registration failed: " + messageOf(error));
				return () => {};
			}
		}, "session-share-html: " + label);
	} catch (error) {
		reportWarn(ctx, label + " effect failed: " + messageOf(error));
	}
}

function isNotFoundError(error) {
	if (error === null || typeof error !== "object") return false;
	return error.code === "SESSION_QUERY_SESSION_NOT_FOUND" || error.name === "SessionPersistenceNotFoundError" || error.shareKind === NOT_FOUND;
}

function safeSessionId(sessionId) {
	return sessionId.replace(/[^A-Za-z0-9._-]/gu, "_");
}

/** Returns the validated session id, or the 400 response the caller must return instead. */
function sessionIdParam(url) {
	const sessionId = url.searchParams.get("sessionId");
	if (sessionId === null || sessionId.trim().length === 0) return { response: plainResponse("missing sessionId query parameter", 400) };
	if (!SESSION_ID_PATTERN.test(sessionId)) return { response: plainResponse("invalid sessionId query parameter", 400) };
	return { sessionId };
}

/**
 * Parses the comma separated pick ids. Absent param returns undefined (the whole
 * conversation); a present but unusable param returns [] so the renderer can show its
 * "nothing selected" page rather than silently falling back to everything.
 */
function parsePick(ctx, raw) {
	if (raw === null) return void 0;
	const picked = [];
	for (const item of raw.split(",")) if (PICK_ID_PATTERN.test(item)) picked.push(item);
	if (picked.length > MAX_PICK_IDS) {
		reportWarn(ctx, "pick truncated from " + picked.length + " to " + MAX_PICK_IDS + " ids");
		picked.length = MAX_PICK_IDS;
	}
	return picked;
}

function sessionTitle(loaded, config) {
	const events = Array.isArray(loaded?.events) ? loaded.events : [];
	let title = "";
	for (const event of events) {
		const candidate = event?.type === "session/title" ? event.data?.title : void 0;
		if (typeof candidate === "string" && candidate.trim().length > 0) title = candidate.trim();
	}
	if (title.length === 0 && typeof loaded?.session?.title === "string") title = loaded.session.title.trim();
	if (title.length === 0) return "";
	return createRedactor({ enabled: config?.redact !== false }).text(title);
}

function plainResponse(text, status) {
	return new Response(text, { status, headers: PLAIN_HEADERS });
}

function jsonResponse(body, status) {
	return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function shareUrl(sessionId, mode) {
	const query = new URLSearchParams({ sessionId });
	if (mode === "download") query.set("download", "1");
	return ROUTE_PATH + "?" + query.toString();
}

async function readTrace(query, sessionId, signal) {
	try {
		return await query.traceSession(sessionId, signal);
	} catch {
		return void 0;
	}
}

async function readPersistedSession(persistence, sessionId, signal) {
	const options = signal === void 0 ? {} : { signal };
	const handle = await persistence.open(sessionId, "read", options);
	try {
		const { events } = await handle.read(0, void 0, options);
		return { session: handle.header, events };
	} finally {
		try {
			await handle.close();
		} catch {}
	}
}

async function readLiveSession(sessions, sessionId) {
	const live = sessions.get(sessionId);
	if (live === void 0 || live === null) return void 0;
	const events = typeof live.snapshotEvents === "function" ? live.snapshotEvents() : [];
	return { session: live.header, events };
}

async function loadSession(ctx, sessionId, signal) {
	const query = optionalService(ctx, "sessionQuery");
	if (query !== void 0 && typeof query.readSession === "function") {
		try {
			const record = await query.readSession(sessionId);
			return { session: record?.session, events: record?.events, trace: await readTrace(query, sessionId, signal) };
		} catch (error) {
			if (isNotFoundError(error)) throw shareError(NOT_FOUND);
			reportWarn(ctx, "sessionQuery read failed: " + messageOf(error));
		}
	}
	const sessions = optionalService(ctx, "sessions");
	if (sessions !== void 0 && typeof sessions.get === "function") {
		try {
			const live = await readLiveSession(sessions, sessionId);
			if (live !== void 0) return live;
		} catch (error) {
			reportWarn(ctx, "sessions read failed: " + messageOf(error));
		}
	}
	const persistence = optionalService(ctx, "sessionPersistence");
	if (persistence !== void 0 && typeof persistence.open === "function") {
		try {
			return await readPersistedSession(persistence, sessionId, signal);
		} catch (error) {
			if (isNotFoundError(error)) throw shareError(NOT_FOUND);
			reportWarn(ctx, "sessionPersistence read failed: " + messageOf(error));
			throw shareError(UNAVAILABLE);
		}
	}
	throw shareError(UNAVAILABLE);
}

function renderOptions(loaded, config, pick) {
	const options = {};
	if (loaded.trace !== void 0) options.trace = loaded.trace;
	if (typeof config?.theme === "string") options.theme = config.theme;
	if (config?.redact === false) options.redact = false;
	const reasoning = config?.reasoning;
	if (reasoning === "omit" || reasoning === "count" || reasoning === "full") options.reasoning = reasoning;
	if (Array.isArray(pick)) options.pick = pick.slice();
	return options;
}

async function renderDocument(loaded, config, pick) {
	const rendered = await renderSessionHtml({
		session: loaded.session,
		events: loaded.events ?? [],
		options: renderOptions(loaded, config, pick)
	});
	const html = typeof rendered === "string" ? rendered : rendered?.html;
	if (typeof html !== "string" || html.length === 0) throw new Error("renderer returned no html");
	return { html, stats: typeof rendered === "string" ? void 0 : rendered.stats };
}

/** Loads the session, or returns the short-text error response the caller must return instead. */
async function loadForShare(ctx, sessionId, signal) {
	try {
		return { loaded: await loadSession(ctx, sessionId, signal) };
	} catch (error) {
		if (isNotFoundError(error)) return { response: plainResponse("session not found", 404) };
		if (error?.shareKind === UNAVAILABLE) return { response: plainResponse("session share is unavailable", 500) };
		reportWarn(ctx, "session read failed: " + messageOf(error));
		return { response: plainResponse("failed to read session", 500) };
	}
}

let indexSessionRef;

/** Resolves the renderer's indexSession lazily: a renderer without it must not break the html route. */
async function resolveIndexSession(ctx) {
	if (indexSessionRef !== void 0) return indexSessionRef;
	let module;
	try {
		module = await import("./render.js");
	} catch (error) {
		reportWarn(ctx, "renderer import failed: " + messageOf(error));
		return null;
	}
	indexSessionRef = typeof module.indexSession === "function" ? module.indexSession : null;
	if (indexSessionRef === null) reportWarn(ctx, "renderer exports no indexSession; the share index route is unavailable");
	return indexSessionRef;
}

async function shareResponse(ctx, request, config) {
	const url = new URL(request.url);
	const parsed = sessionIdParam(url);
	if (parsed.response !== void 0) return parsed.response;
	const sessionId = parsed.sessionId;
	const download = url.searchParams.get("download");
	const asAttachment = download === "1" || download === "true";
	const pick = parsePick(ctx, url.searchParams.get("pick"));
	const load = await loadForShare(ctx, sessionId, request.signal);
	if (load.response !== void 0) return load.response;
	let html;
	try {
		html = (await renderDocument(load.loaded, config, pick)).html;
	} catch (error) {
		reportWarn(ctx, "session render failed: " + messageOf(error));
		return plainResponse("failed to render session", 500);
	}
	return new Response(html, {
		status: 200,
		headers: {
			"content-type": "text/html; charset=utf-8",
			"content-disposition": (asAttachment ? "attachment" : "inline") + '; filename="dsh-session-' + safeSessionId(sessionId) + '.html"',
			"cache-control": "no-store",
			"x-content-type-options": "nosniff"
		}
	});
}

async function indexResponse(ctx, request, config) {
	const url = new URL(request.url);
	const parsed = sessionIdParam(url);
	if (parsed.response !== void 0) return parsed.response;
	const load = await loadForShare(ctx, parsed.sessionId, request.signal);
	if (load.response !== void 0) return load.response;
	const indexSession = await resolveIndexSession(ctx);
	if (indexSession === null) return plainResponse("session share is unavailable", 500);
	let indexed;
	try {
		indexed = await indexSession({ session: load.loaded.session, events: load.loaded.events ?? [], options: renderOptions(load.loaded, config) });
	} catch (error) {
		reportWarn(ctx, "session index failed: " + messageOf(error));
		return plainResponse("failed to index session", 500);
	}
	const entries = Array.isArray(indexed?.entries) ? indexed.entries : [];
	const total = typeof indexed?.total === "number" && Number.isFinite(indexed.total) ? indexed.total : entries.length;
	return jsonResponse({ sessionId: parsed.sessionId, title: sessionTitle(load.loaded, config), total, entries }, 200);
}

function parseShareMode(rawInput) {
	try {
		return String(rawInput ?? "").trim().toLowerCase().includes("download") ? "download" : "inline";
	} catch {
		return "inline";
	}
}

function invocationSessionId(invocation) {
	try {
		const sessionId = invocation?.agent?.session?.id;
		return typeof sessionId === "string" ? sessionId : void 0;
	} catch {
		return void 0;
	}
}

function registerCommand(ctx) {
	withEffect(ctx, "command", () => ctx.commands.register({
		name: "share",
		description: "Share this session as a single-file HTML page",
		handler: (invocation) => {
			const sessionId = invocationSessionId(invocation);
			if (sessionId === void 0 || !SESSION_ID_PATTERN.test(sessionId)) {
				return { kind: "error", text: "无法确定当前会话，未生成分享链接。" };
			}
			const mode = parseShareMode(invocation?.rawInput);
			const url = shareUrl(sessionId, mode);
			return {
				kind: "success",
				text: mode === "download" ? "已生成分享链接，可直接下载：" + url : "已生成分享链接，可直接打开：" + url
			};
		}
	}));
}

function routeFetch(ctx, label, build) {
	return async (request) => {
		let response;
		try {
			response = await build(request);
		} catch (error) {
			reportWarn(ctx, label + " failed: " + messageOf(error));
			response = plainResponse("failed to build session share", 500);
		}
		if (request.method !== "HEAD") return response;
		try {
			await response.body?.cancel();
		} catch {}
		return new Response(null, { status: response.status, headers: response.headers });
	};
}

function registerRoute(ctx, config) {
	withEffect(ctx, "route", () => ctx.connection.fetch.register({
		path: ROUTE_PATH,
		methods: ["GET", "HEAD"],
		requestBody: "buffered",
		fetch: routeFetch(ctx, "share response", (request) => shareResponse(ctx, request, config))
	}));
	withEffect(ctx, "route:index", () => ctx.connection.fetch.register({
		path: INDEX_ROUTE_PATH,
		methods: ["GET"],
		requestBody: "buffered",
		fetch: routeFetch(ctx, "share index response", (request) => indexResponse(ctx, request, config))
	}));
}

async function writeShareFile(ctx, args, exec, config) {
	const sessionId = typeof args?.sessionId === "string" && args.sessionId.trim().length > 0 ? args.sessionId.trim() : void 0;
	if (sessionId === void 0 || !SESSION_ID_PATTERN.test(sessionId)) throw new Error("sessionId is required: pass the current session id");
	const loaded = await loadSession(ctx, sessionId, exec?.signal);
	const { html, stats } = await renderDocument(loaded, config);
	const cwd = typeof loaded.session?.cwd === "string" && loaded.session.cwd.length > 0 ? loaded.session.cwd : void 0;
	if (cwd === void 0) throw new Error("session records no cwd to write the share file into");
	const { mkdir, writeFile } = await import("node:fs/promises");
	const { join } = await import("node:path");
	const directory = join(cwd, ".dsh-share");
	await mkdir(directory, { recursive: true });
	const target = join(directory, "session-" + safeSessionId(sessionId) + ".html");
	await writeFile(target, html, "utf8");
	return { path: target, bytes: Buffer.byteLength(html, "utf8"), stats: stats ?? {} };
}

function registerTool(ctx, config) {
	const tools = optionalService(ctx, "tools");
	if (tools === void 0 || typeof tools.register !== "function") return;
	withEffect(ctx, "tool", () => tools.register({
		name: TOOL_NAME,
		description: "Export this conversation as a single-file HTML share page and write it under .dsh-share in the session cwd.",
		parameters: {
			type: "object",
			properties: {
				sessionId: { type: "string", description: "Session id to export; there is no ambient default, so pass it explicitly." }
			},
			additionalProperties: false
		},
		output: {
			schema: {
				type: "object",
				properties: {
					path: { type: "string" },
					bytes: { type: "integer" },
					stats: { type: "object" }
				},
				required: ["path", "bytes"]
			},
			render: (_args, value) => [{ type: "text", text: "wrote " + String(value?.path) + " (" + String(value?.bytes) + " bytes)" }]
		},
		async execute(args, exec) {
			return await writeShareFile(ctx, args ?? {}, exec, config);
		}
	}));
}

export function apply(ctx, config = {}) {
	try {
		registerCommand(ctx);
	} catch (error) {
		reportWarn(ctx, "command setup failed: " + messageOf(error));
	}
	try {
		registerRoute(ctx, config ?? {});
	} catch (error) {
		reportWarn(ctx, "route setup failed: " + messageOf(error));
	}
	try {
		registerTool(ctx, config ?? {});
	} catch (error) {
		reportWarn(ctx, "tool setup failed: " + messageOf(error));
	}
}
