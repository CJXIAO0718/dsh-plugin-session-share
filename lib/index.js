import { renderSessionHtml } from "./render.js";
import { buildShareBundle } from "./snapshot.js";
import { createRedactor } from "./redact.js";

export const name = "session-share-html";
export const inject = ["commands", "connection"];

const ROUTE_PATH = "/api/session.shareHtml";
const INDEX_ROUTE_PATH = "/api/session.shareIndex";
const SNAPSHOT_ROUTE_PATH = "/api/session.shareJson";
const PUBLISH_ROUTE_PATH = "/api/session.publishHost";
const PROBE_ROUTE_PATH = "/api/session.probeHost";
const SETTINGS_ROUTE_PATH = "/api/session.shareSettings";
const TOOL_NAME = "share_conversation_html";
const MODE_PREVIEW = "preview";
const MODE_DOWNLOAD = "download";
const MODE_PUBLISH = "publish";
const SHARE_MODES = [MODE_PREVIEW, MODE_DOWNLOAD, MODE_PUBLISH];
const DEFAULT_COMMAND_MODE = MODE_PREVIEW;
const SHARE_COMMAND_HINT = "preview | download | publish";
const SETTINGS_DIRECTORY = "session-share";
const SETTINGS_FILE = "settings.json";
const MIN_TOKEN_LENGTH = 8;
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PICK_ID_PATTERN = /^m\d+$/u;
const MAX_PICK_IDS = 500;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const HOST_TIMEOUT_MS = 20000;
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

async function readJsonBody(request) {
	try {
		if (typeof request.json === "function") {
			const value = await request.json();
			return value !== null && typeof value === "object" ? value : null;
		}
		const text = await request.text();
		const value = JSON.parse(text);
		return value !== null && typeof value === "object" ? value : null;
	} catch {
		return null;
	}
}

/**
 * Decide the scheme for a host typed without one. Loopback and private addresses are served
 * over plain HTTP far more often than over TLS, so guess http for them.
 * @param raw - host part without scheme, port or path.
 * @returns "http" or "https".
 */
function bareHostScheme(raw) {
	const host = String(raw ?? "").toLowerCase().replace(/^\[/u, "").replace(/\]$/u, "");
	if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "::1" || host === "0.0.0.0") return "http";
	const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host);
	if (octets === null) return "https";
	const first = Number(octets[1]);
	const second = Number(octets[2]);
	if (first === 0 || first === 10 || first === 127) return "http";
	if (first === 192 && second === 168) return "http";
	if (first === 172 && second >= 16 && second <= 31) return "http";
	return "https";
}

function normalizeHost(raw) {
	const value = String(raw ?? "").trim();
	if (value.length === 0) return null;
	let url;
	try {
		const bare = value.split("/")[0].split("?")[0].replace(/:\d+$/u, "");
		url = new URL(/^[a-z][a-z0-9+.-]*:\/\//iu.test(value) ? value : bareHostScheme(bare) + "://" + value);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return null;
	if (url.username.length > 0 || url.password.length > 0) return null;
	const path = url.pathname.replace(/\/+$/, "");
	return url.origin + (path === "/" ? "" : path);
}

function normalizePickArray(value) {
	if (!Array.isArray(value)) return void 0;
	const picked = [];
	for (const item of value) {
		if (typeof item === "string" && PICK_ID_PATTERN.test(item)) picked.push(item);
	}
	return picked.slice(0, MAX_PICK_IDS);
}

async function fetchWithTimeout(url, init) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), HOST_TIMEOUT_MS);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

async function publishToHost(ctx, request, config) {
	const body = await readJsonBody(request);
	if (body === null) {
		return jsonResponse({ ok: false, error: { code: "invalid_json", message: "invalid JSON body" } }, 400);
	}
	const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
	if (!SESSION_ID_PATTERN.test(sessionId)) {
		return jsonResponse({ ok: false, error: { code: "invalid_session", message: "invalid sessionId" } }, 400);
	}
	const host = normalizeHost(body.host);
	if (host === null) {
		return jsonResponse({ ok: false, error: { code: "invalid_host", message: "invalid host address" } }, 400);
	}
	const token = typeof body.token === "string" ? body.token.trim() : "";
	if (token.length < MIN_TOKEN_LENGTH) {
		return jsonResponse({ ok: false, error: { code: "invalid_token", message: "a host token is required" } }, 400);
	}
	const pick = normalizePickArray(body.pick);
	const built = await buildPublishPayload(ctx, sessionId, config, pick, request.signal);
	if (built.error !== void 0) {
		const { code, message, status } = built.error;
		return jsonResponse({ ok: false, error: { code, message } }, status);
	}
	const result = await sendBundleToHost(host, token, built.payload);
	if (result.ok === true) {
		return jsonResponse({ ok: true, share: result.share, warnings: result.warnings, bytes: built.bytes }, 201);
	}
	if (result.status === 0) {
		reportWarn(ctx, "publish to host failed: " + result.error.message);
		return jsonResponse({ ok: false, error: result.error }, 502);
	}
	reportWarn(ctx, "host rejected publish: " + String(result.status));
	return jsonResponse({ ok: false, status: result.status, error: result.error }, 502);
}

/** Builds the native snapshot payload this plugin publishes to a MARGIN host. */
async function buildPublishPayload(ctx, sessionId, config, pick, signal) {
	const load = await loadForShare(ctx, sessionId, signal);
	if (load.response !== void 0) {
		const status = typeof load.response.status === "number" ? load.response.status : 500;
		const code = status === 404 ? "session_not_found" : "session_unavailable";
		return { error: { code, message: "cannot read this session", status } };
	}
	let bundle;
	try {
		bundle = buildShareBundle({
			session: load.loaded.session,
			events: load.loaded.events ?? [],
			options: renderOptions(load.loaded, config ?? {}, pick)
		});
	} catch (error) {
		reportWarn(ctx, "publish bundle failed: " + messageOf(error));
		return { error: { code: "invalid_snapshot", message: "failed to build the native snapshot", status: 500 } };
	}
	const payload = JSON.stringify(bundle);
	const bytes = Buffer.byteLength(payload, "utf8");
	if (bytes > MAX_SNAPSHOT_BYTES) {
		return { error: { code: "payload_too_large", message: "this snapshot exceeds 8 MiB", status: 413 } };
	}
	return { payload, bytes };
}

/** Posts one snapshot payload to a MARGIN host; never throws. */
async function sendBundleToHost(host, token, payload) {
	try {
		const upstream = await fetchWithTimeout(host + "/api/v1/shares", {
			method: "POST",
			headers: {
				"content-type": "application/vnd.dsh.session-share+json",
				accept: "application/json",
				authorization: "Bearer " + token
			},
			body: payload
		});
		const text = await upstream.text();
		let parsed = null;
		try {
			parsed = text.length === 0 ? null : JSON.parse(text);
		} catch {}
		if (upstream.ok === true) {
			return {
				ok: true,
				share: parsed !== null && typeof parsed.share === "object" ? parsed.share : null,
				warnings: Array.isArray(parsed?.warnings) ? parsed.warnings : []
			};
		}
		const error = parsed !== null && typeof parsed.error === "object" && parsed.error !== null
			? parsed.error
			: { code: "host_error", message: "host rejected the publish" };
		return { ok: false, status: upstream.status, error };
	} catch (error) {
		return { ok: false, status: 0, error: { code: "host_unreachable", message: messageOf(error) } };
	}
}

/** The public address of a freshly published share, when the host returns one. */
function shareAddress(share) {
	if (share === null || typeof share !== "object") return null;
	for (const key of ["url", "href", "link", "publicUrl", "webUrl"]) {
		const value = share[key];
		if (typeof value === "string" && value.length > 0) return value;
	}
	return null;
}

function shareHomeDirectory() {
	try {
		const configured = typeof process === "undefined" ? void 0 : process.env?.DSH_HOME;
		return typeof configured === "string" && configured.trim().length > 0 ? configured.trim() : null;
	} catch {
		return null;
	}
}

async function shareSettingsPath() {
	const { homedir } = await import("node:os");
	const { join } = await import("node:path");
	const home = shareHomeDirectory() ?? join(homedir(), ".dsh");
	return join(home, SETTINGS_DIRECTORY, SETTINGS_FILE);
}

function normalizeShareMode(value) {
	return typeof value === "string" && SHARE_MODES.includes(value) ? value : DEFAULT_COMMAND_MODE;
}

/** The persisted /share default plus the MARGIN host and token used when the command publishes. */
async function readShareSettings() {
	let parsed = null;
	try {
		const { readFile } = await import("node:fs/promises");
		parsed = JSON.parse(await readFile(await shareSettingsPath(), "utf8"));
	} catch {
		parsed = null;
	}
	return {
		commandDefault: normalizeShareMode(parsed?.commandDefault),
		host: normalizeHost(parsed?.host) ?? "",
		token: typeof parsed?.token === "string" ? parsed.token.trim() : ""
	};
}

async function writeShareSettings(patch) {
	const current = await readShareSettings();
	const next = {
		commandDefault: patch.commandDefault === void 0 ? current.commandDefault : normalizeShareMode(patch.commandDefault),
		host: patch.host === void 0 ? current.host : normalizeHost(patch.host) ?? current.host,
		token: typeof patch.token === "string" && patch.token.trim().length > 0 ? patch.token.trim() : current.token
	};
	const { mkdir, writeFile } = await import("node:fs/promises");
	const { dirname } = await import("node:path");
	const target = await shareSettingsPath();
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, JSON.stringify(next, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
	return next;
}

function publicShareSettings(settings) {
	return {
		commandDefault: settings.commandDefault,
		host: settings.host,
		tokenSet: settings.token.length > 0,
		modes: SHARE_MODES.slice()
	};
}

/** Reads or patches the saved share defaults; the token is never returned to the client. */
async function settingsResponse(ctx, request) {
	if (request.method !== "POST") {
		try {
			return jsonResponse({ ok: true, settings: publicShareSettings(await readShareSettings()) }, 200);
		} catch (error) {
			reportWarn(ctx, "read share settings failed: " + messageOf(error));
			return jsonResponse({ ok: false, error: { code: "settings_unreadable", message: messageOf(error) } }, 500);
		}
	}
	const body = await readJsonBody(request);
	if (body === null) {
		return jsonResponse({ ok: false, error: { code: "invalid_json", message: "invalid JSON body" } }, 400);
	}
	const patch = {};
	if (body.commandDefault !== void 0) {
		if (typeof body.commandDefault !== "string" || !SHARE_MODES.includes(body.commandDefault)) {
			return jsonResponse({ ok: false, error: { code: "invalid_mode", message: "unknown share mode" } }, 400);
		}
		patch.commandDefault = body.commandDefault;
	}
	if (body.host !== void 0 && String(body.host ?? "").trim().length > 0) {
		const host = normalizeHost(body.host);
		if (host === null) {
			return jsonResponse({ ok: false, error: { code: "invalid_host", message: "invalid host address" } }, 400);
		}
		patch.host = host;
	}
	if (typeof body.token === "string" && body.token.trim().length > 0) patch.token = body.token.trim();
	try {
		return jsonResponse({ ok: true, settings: publicShareSettings(await writeShareSettings(patch)) }, 200);
	} catch (error) {
		reportWarn(ctx, "write share settings failed: " + messageOf(error));
		return jsonResponse({ ok: false, error: { code: "settings_unwritable", message: messageOf(error) } }, 500);
	}
}

async function probeHost(request) {
	const body = await readJsonBody(request);
	const host = normalizeHost(body?.host);
	if (host === null) {
		return jsonResponse({ ok: false, error: { code: "invalid_host", message: "invalid host address" } }, 400);
	}
	try {
		const upstream = await fetchWithTimeout(host, { method: "HEAD", redirect: "follow" });
		return jsonResponse({ ok: true, status: upstream.status }, 200);
	} catch (error) {
		return jsonResponse({
			ok: false,
			status: 0,
			error: { code: "host_unreachable", message: messageOf(error) }
		}, 502);
	}
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

async function snapshotResponse(ctx, request, config) {
	const url = new URL(request.url);
	const parsed = sessionIdParam(url);
	if (parsed.response !== void 0) return parsed.response;
	const pick = parsePick(ctx, url.searchParams.get("pick"));
	const load = await loadForShare(ctx, parsed.sessionId, request.signal);
	if (load.response !== void 0) return load.response;
	let bundle;
	try {
		bundle = buildShareBundle({
			session: load.loaded.session,
			events: load.loaded.events ?? [],
			options: renderOptions(load.loaded, config, pick)
		});
	} catch (error) {
		reportWarn(ctx, "native snapshot failed: " + messageOf(error));
		return plainResponse("failed to build native snapshot", 500);
	}
	return jsonResponse(bundle, 200);
}

/** Reads the mode typed after /share; undefined asks for the saved default. */
function parseShareCommand(rawInput) {
	try {
		const raw = String(rawInput ?? "").trim().toLowerCase();
		if (raw.length === 0) return void 0;
		if (raw.includes(MODE_PUBLISH)) return MODE_PUBLISH;
		if (raw.includes(MODE_DOWNLOAD)) return MODE_DOWNLOAD;
		if (raw.includes(MODE_PREVIEW) || raw.includes("inline")) return MODE_PREVIEW;
		return void 0;
	} catch {
		return void 0;
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

function registerCommand(ctx, config) {
	withEffect(ctx, "command", () => ctx.commands.register({
		name: "share",
		description: "Share this session as a single-file HTML page",
		input: { hint: SHARE_COMMAND_HINT },
		handler: async (invocation) => {
			const sessionId = invocationSessionId(invocation);
			if (sessionId === void 0 || !SESSION_ID_PATTERN.test(sessionId)) {
				return { kind: "error", text: "无法确定当前会话，未生成分享页。" };
			}
			const settings = await readShareSettings();
			const mode = parseShareCommand(invocation?.rawInput) ?? settings.commandDefault;
			if (mode === MODE_PUBLISH) return await publishFromCommand(ctx, sessionId, settings, config, invocation?.signal);
			const url = shareUrl(sessionId, mode);
			return {
				kind: "success",
				text: mode === MODE_DOWNLOAD ? "已生成本机下载地址（先下载成 .html 文件，再把文件发给别人）：" + url : "已生成本机预览地址（仅这台机器、当前已登录的浏览器可打开，发给别人打不开）：" + url
			};
		}
	}));
}

/** /share with the publish default: build the snapshot here and post it with the saved token. */
async function publishFromCommand(ctx, sessionId, settings, config, signal) {
	if (settings.host.length === 0) {
		return { kind: "error", text: "还没配置边注主机：点会话头部的「分享为 HTML」→「连接设置」，填好主机地址后再试。" };
	}
	if (settings.token.length < MIN_TOKEN_LENGTH) {
		return { kind: "error", text: "还没保存边注令牌：在「连接设置」里填好个人令牌（至少 8 位）后再试。" };
	}
	const built = await buildPublishPayload(ctx, sessionId, config, void 0, signal);
	if (built.error !== void 0) {
		return { kind: "error", text: "无法读取当前会话，未发布到边注。" };
	}
	const result = await sendBundleToHost(settings.host, settings.token, built.payload);
	if (result.ok === true) {
		const address = shareAddress(result.share);
		return { kind: "success", text: address === null ? "已发布到边注。" : "已发布到边注：" + address };
	}
	if (result.status === 0) return { kind: "error", text: "无法连接边注主机：" + result.error.message };
	if (result.status === 401 || result.status === 403) return { kind: "error", text: "边注令牌无效或没有发布权限。" };
	if (result.status === 413) return { kind: "error", text: "这次分享内容超过边注上限（8 MiB）。" };
	if (result.status === 429) return { kind: "error", text: "发布太频繁，稍后再试。" };
	return { kind: "error", text: "发布到边注失败（HTTP " + String(result.status) + "）。" };
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
	withEffect(ctx, "route:json", () => ctx.connection.fetch.register({
		path: SNAPSHOT_ROUTE_PATH,
		methods: ["GET"],
		requestBody: "buffered",
		fetch: routeFetch(ctx, "native snapshot response", (request) => snapshotResponse(ctx, request, config))
	}));
	withEffect(ctx, "route:publishHost", () => ctx.connection.fetch.register({
		path: PUBLISH_ROUTE_PATH,
		methods: ["POST"],
		requestBody: "buffered",
		fetch: routeFetch(ctx, "publish to host response", (request) => publishToHost(ctx, request, config))
	}));
	withEffect(ctx, "route:probeHost", () => ctx.connection.fetch.register({
		path: PROBE_ROUTE_PATH,
		methods: ["POST"],
		requestBody: "buffered",
		fetch: routeFetch(ctx, "probe host response", (request) => probeHost(request))
	}));
	withEffect(ctx, "route:settings", () => ctx.connection.fetch.register({
		path: SETTINGS_ROUTE_PATH,
		methods: ["GET", "POST"],
		requestBody: "buffered",
		fetch: routeFetch(ctx, "share settings response", (request) => settingsResponse(ctx, request))
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
		registerCommand(ctx, config ?? {});
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
