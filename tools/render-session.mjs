#!/usr/bin/env node
// dsh-plugin-session-share 离线渲染入口：把 DSH 会话日志渲染成单文件 HTML。
// 零外部依赖；唯一依赖是 ../lib/render.js（动态 import，用 pathToFileURL 保证 Windows 路径可用）。
// 用法：node tools/render-session.mjs --log <session.v4.jsonl.zstd|.jsonl> --out <out.html> [--reasoning omit|count|full] [--pick m12,m13] [--no-redact] [--title "..."]
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RENDER_PATH = path.resolve(HERE, "..", "lib", "render.js");

const REASONING_MODES = ["omit", "count", "full"];

const USAGE = [
  "用法: node tools/render-session.mjs --log <session.v4.jsonl.zstd|.jsonl> --out <out.html> [--reasoning omit|count|full] [--pick m12,m13] [--no-redact] [--title \"<标题>\"]",
  "  --log        会话日志（多帧 zstd 拼接的 session.v4.jsonl.zstd，或未压缩的 .jsonl）",
  "  --out        输出 HTML 文件路径",
  "  --reasoning  思考过程：omit（默认，不显示）| count（只显示「思考 N 段 · 已省略」）| full（全文展开）",
  "  --pick       只分享选中的对话条目：--pick m12,m13（id = m + 该消息的事件 seq，稳定且与位置无关；不传=全部）",
  "  --no-redact  关闭脱敏（默认开启）",
  "  --title      覆盖标题",
].join("\n");

// 条目 id：'m' + 该条消息的事件 seq（稳定、与位置无关）。
const PICK_PATTERN = /^m\d+(,m\d+)*$/;

function isZstdMagicAt(buf, i) {
  return buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd;
}

// DSH 的 session.v4.jsonl.zstd 是多个 zstd 帧顺序拼接；逐帧解压。
// 帧边界用魔数 28 b5 2f fd 定位；若压缩数据里偶然出现魔数，就向更远的候选边界重试。
export function decompressZstdFrames(buf) {
  if (buf.length < 4 || !isZstdMagicAt(buf, 0)) return null;
  if (typeof zlib.zstdDecompressSync !== "function") {
    throw new Error("当前 Node " + process.version + " 没有内置 zstd 解压（需要 >=22.15）：请升级 Node，或先用工具把日志解成 .jsonl 再渲染");
  }
  const offsets = [];
  for (let i = 0; i + 4 <= buf.length; i += 1) {
    if (isZstdMagicAt(buf, i)) offsets.push(i);
  }
  const chunks = [];
  let frame = 0;
  while (frame < offsets.length) {
    let ok = false;
    for (let next = frame + 1; next <= offsets.length; next += 1) {
      const end = next < offsets.length ? offsets[next] : buf.length;
      try {
        chunks.push(zlib.zstdDecompressSync(buf.subarray(offsets[frame], end)).toString("utf8"));
        frame = next;
        ok = true;
        break;
      } catch {
        // 候选边界不成立，继续向更远处试
      }
    }
    if (!ok) throw new Error("zstd 解压失败：第 " + (frame + 1) + " 个帧（偏移 " + offsets[frame] + "）无法解析");
  }
  return chunks.join("");
}

export function loadEvents(logPath) {
  const buf = fs.readFileSync(logPath);
  let text = decompressZstdFrames(buf);
  if (text === null) {
    if (/\.zst[d]?$/i.test(logPath)) {
      throw new Error("文件不是 zstd 数据（缺少 28 b5 2f fd 魔数）：" + logPath);
    }
    text = buf.toString("utf8");
  }
  const events = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      const preview = line.length > 120 ? line.slice(0, 120) + "…" : line;
      throw new Error("第 " + (i + 1) + " 行不是合法 JSON：" + preview);
    }
  }
  return { events, compressed: text !== buf.toString("utf8") };
}

function parseArgs(argv) {
  const out = { log: null, out: null, redact: true, title: null, reasoning: null, pick: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--log") { out.log = argv[++i]; }
    else if (arg === "--out") { out.out = argv[++i]; }
    else if (arg === "--title") { out.title = argv[++i]; }
    else if (arg === "--reasoning") {
      i += 1;
      const value = argv[i];
      out.reasoning = value === undefined ? "" : value;
    }
    else if (arg === "--pick") {
      i += 1;
      out.pick = argv[i] === undefined ? "" : argv[i];
    }
    else if (arg === "--no-redact") { out.redact = false; }
    else if (arg === "--help" || arg === "-h") { out.help = true; }
    else if (arg.startsWith("--log=")) { out.log = arg.slice(6); }
    else if (arg.startsWith("--out=")) { out.out = arg.slice(6); }
    else if (arg.startsWith("--title=")) { out.title = arg.slice(8); }
    else if (arg.startsWith("--reasoning=")) { out.reasoning = arg.slice(12); }
    else if (arg.startsWith("--pick=")) { out.pick = arg.slice(7); }
    else throw new Error("未知参数：" + arg);
  }
  return out;
}

async function loadRenderer() {
  if (!fs.existsSync(RENDER_PATH)) {
    throw new Error("找不到渲染模块：" + RENDER_PATH + "（请确认插件的 lib/render.js 已构建）");
  }
  const mod = await import(pathToFileURL(RENDER_PATH).href);
  const fn = mod.renderSessionHtml
    || (mod.default && typeof mod.default.renderSessionHtml === "function" ? mod.default.renderSessionHtml : null)
    || (typeof mod.default === "function" ? mod.default : null);
  if (typeof fn !== "function") {
    throw new Error("lib/render.js 未导出 renderSessionHtml：" + RENDER_PATH);
  }
  return fn;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE + "\n");
    return 0;
  }
  if (args.reasoning !== null && !REASONING_MODES.includes(args.reasoning)) {
    process.stderr.write("错误：--reasoning 只接受 omit | count | full，收到：" +
      (args.reasoning === "" ? "（空值）" : args.reasoning) + "\n");
    return 2;
  }
  if (args.pick !== null && !PICK_PATTERN.test(args.pick)) {
    process.stderr.write("错误：--pick 只接受逗号分隔的条目 id（形如 m12,m13，id 为 m + 事件序号），收到：" +
      (args.pick === "" ? "（空值）" : args.pick) + "\n");
    return 2;
  }
  if (!args.log) throw new Error("缺少 --log 参数\n" + USAGE);
  if (!args.out) throw new Error("缺少 --out 参数\n" + USAGE);

  const logPath = path.resolve(args.log);
  if (!fs.existsSync(logPath)) throw new Error("日志文件不存在：" + logPath);

  const started = Date.now();
  const { events, compressed } = loadEvents(logPath);
  if (events.length === 0) throw new Error("日志里没有事件：" + logPath);

  const render = await loadRenderer();
  const options = { redact: args.redact };
  if (args.title) options.title = args.title;
  // 不传就让 renderer 用自己的默认值（omit）
  if (args.reasoning !== null) options.reasoning = args.reasoning;
  // 不传 --pick = 渲染全部条目；传了就交给 renderer 只渲染命中的条目
  if (args.pick !== null) options.pick = args.pick.split(",");

  let rendered;
  try {
    // lib/render.js: renderSessionHtml({ events, options, session }) -> { html, stats }
    rendered = await render({ events, options });
  } catch (err) {
    throw new Error("渲染失败：" + (err && err.message ? err.message : String(err)));
  }
  const html = typeof rendered === "string" ? rendered : (rendered && rendered.html) || "";
  if (!html) throw new Error("渲染结果为空：" + RENDER_PATH);

  const outAbs = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, html, "utf8");

  const stats = {
    log: logPath,
    compressed: compressed === true,
    events: events.length,
    redact: args.redact,
    reasoning: args.reasoning === null ? "omit" : args.reasoning,
    title: args.title || null,
    durationMs: Date.now() - started,
    ...(rendered && typeof rendered === "object" && rendered.stats ? rendered.stats : {}),
  };
  process.stdout.write(JSON.stringify({ out: outAbs, bytes: Buffer.byteLength(html, "utf8"), stats }) + "\n");
  return 0;
}

// 只在被当作脚本入口执行时跑 CLI；被 import 复用（AI / 其他脚本）时不触发。
function isEntryPoint() {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  return path.resolve(entry).toLowerCase() === path.resolve(self).toLowerCase();
}

if (isEntryPoint()) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((err) => {
    process.stderr.write("错误：" + (err && err.message ? err.message : String(err)) + "\n");
    process.exitCode = 1;
  });
}
