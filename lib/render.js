// lib/render.js - session event stream -> single-file self-contained HTML.
// Zero dependencies, pure ESM, no DOM and no node builtins (only ./redact.js).
// Every byte that reaches the document goes through redact -> escape -> URL-inert,
// so the output can never reference an external resource.

import { createRedactor } from './redact.js';

export const VERSION = '0.1.0';

const ARGS_LIMIT = 4000;
const RESULT_LIMIT = 12000;
const USER_TITLE_LEN = 40;

function str(value) {
  if (value == null) return '';
  return typeof value === 'string' ? value : String(value);
}

function utf8Length(text) {
  var bytes = 0;
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) { bytes += 4; i += 1; }
    else bytes += 3;
  }
  return bytes;
}

function escapeHtml(value) {
  return str(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Escape, then defuse URL schemes. The colon becomes a character reference, so the
// rendered text still reads "https://..." while the markup contains no scheme that a
// browser or a markdown preview could ever turn into a request.
function escapeText(value) {
  return escapeHtml(value).replace(/https?:\/\//gi, function (match) {
    return match.slice(0, -3) + '&#58;//';
  });
}

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

function formatTimestamp(value) {
  var date;
  if (value instanceof Date) date = value;
  else if (typeof value === 'number' && isFinite(value)) date = new Date(value);
  else if (typeof value === 'string' && value) {
    var parsed = Date.parse(value);
    date = isFinite(parsed) ? new Date(parsed) : null;
  } else date = null;
  if (!date || isNaN(date.getTime())) date = new Date();
  return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate()) +
    ' ' + pad2(date.getUTCHours()) + ':' + pad2(date.getUTCMinutes()) + ' UTC';
}

function normalizeEvents(events) {
  var items = [];
  var badLines = 0;
  function push(entry) {
    if (entry == null) { badLines += 1; return; }
    if (typeof entry === 'string') {
      var trimmed = entry.trim();
      if (!trimmed) return;
      try { entry = JSON.parse(trimmed); } catch (error) { badLines += 1; return; }
    }
    if (typeof entry !== 'object' || Array.isArray(entry)) { badLines += 1; return; }
    items.push(entry);
  }
  if (typeof events === 'string') {
    var lines = events.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      try { push(JSON.parse(lines[i])); } catch (error) { badLines += 1; }
    }
  } else if (Array.isArray(events)) {
    for (var j = 0; j < events.length; j++) push(events[j]);
  } else if (events && typeof events === 'object' && Array.isArray(events.events)) {
    for (var k = 0; k < events.events.length; k++) push(events.events[k]);
  }
  return { items: items, badLines: badLines };
}

function blocksOf(container) {
  if (!container || typeof container !== 'object') return [];
  var content = container.content;
  if (Array.isArray(content)) {
    var out = [];
    for (var i = 0; i < content.length; i++) {
      var block = content[i];
      if (block && typeof block === 'object') out.push(block);
      else if (typeof block === 'string') out.push({ type: 'text', text: block });
    }
    return out;
  }
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return [];
}

function resultTextOf(event) {
  var data = (event && event.data) || {};
  var blocks = blocksOf(data.message);
  var parts = [];
  for (var i = 0; i < blocks.length; i++) {
    if (typeof blocks[i].text === 'string') parts.push(blocks[i].text);
  }
  if (parts.length) return parts.join('\n');
  if (data.message) {
    try { return JSON.stringify(data.message, null, 2); } catch (error) { return ''; }
  }
  return '';
}

function prettyArguments(raw) {
  if (raw == null) return '';
  if (typeof raw === 'string') {
    var trimmed = raw.trim();
    if (!trimmed) return '';
    try { return JSON.stringify(JSON.parse(trimmed), null, 2); } catch (error) { return raw; }
  }
  try { return JSON.stringify(raw, null, 2); } catch (error) { return str(raw); }
}

function clip(value, limit) {
  var text = str(value);
  if (text.length <= limit) return { text: text, truncated: false };
  return { text: text.slice(0, limit), truncated: true };
}

function compact(value, limit) {
  var text = str(value).replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return text.slice(0, limit) + '…';
}

const LABEL_LEN = 80;

// Markdown markers belong to the renderer, not to a one-line excerpt: the picker shows
// plain text, so fences, emphasis, links, list bullets and headings are unwrapped before
// everything is collapsed onto a single line.
function plainMarkdown(value) {
  var text = str(value).replace(/\r\n?/g, '\n');
  text = text.replace(/^[ \t]*(?:```|~~~)[^\n]*$/gm, '');
  text = text.replace(/!\[([^\]]*)\]\([^)\n]*\)/g, '$1');
  text = text.replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, '$1');
  text = text.replace(/`{1,3}([^`\n]*)`{1,3}/g, '$1');
  text = text.replace(/\*\*([^*\n]+?)\*\*/g, '$1');
  text = text.replace(/__([^_\n]+?)__/g, '$1');
  text = text.replace(/(^|[\s(])\*([^*\n]+?)\*(?=[\s).,;:!?]|$)/g, '$1$2');
  text = text.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '');
  text = text.replace(/^[ \t]{0,3}>[ \t]?/gm, '');
  text = text.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '');
  text = text.replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, '');
  return text.replace(/\s+/g, ' ').trim();
}

// The label is what the picker shows: one line, at most LABEL_LEN characters, and never a
// character that survives from a markdown marker.
function excerptLabel(value) {
  var flat = plainMarkdown(value);
  if (flat.length <= LABEL_LEN) return flat;
  var cut = flat.slice(0, LABEL_LEN - 1);
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
  return cut + '…';
}

// The identity of a message is 'm' + its own event seq, so it never moves when messages
// are inserted, filtered or re-rendered. The position is a fallback for a stream that
// carries no seq at all.
function messageId(event, position) {
  var seq = event ? event.seq : null;
  if (typeof seq === 'number' && isFinite(seq) && seq >= 0) return 'm' + Math.floor(seq);
  if (typeof seq === 'string' && /^\d+$/.test(seq.trim())) return 'm' + Number(seq.trim());
  return 'm' + (position + 1);
}

function eventTime(event) {
  var time = event ? event.time : null;
  if (typeof time === 'number' && isFinite(time)) return time;
  if (typeof time === 'string' && time.trim() && isFinite(Number(time))) return Number(time);
  return 0;
}

// Summarise a tool result for the collapsed one-liner: skip bracket-only noise
// lines (`{`, `}`, `[`) so the preview starts with real content.
function summarize(value, limit) {
  var lines = str(value).split(/\r?\n/);
  for (var line = 0; line < lines.length; line++) {
    var candidate = lines[line].replace(/\s+/g, ' ').trim();
    if (candidate.length < 3) continue;
    if (/^[[\]{}()<>:,"'\s]*$/.test(candidate)) continue;
    return compact(candidate, limit);
  }
  return compact(value, limit);
}

function lineCount(value) {
  var text = str(value);
  if (!text) return 0;
  return text.split('\n').length;
}

// A user/message event is not always a human. DSH delivers runtime snapshots, skill and
// tool catalogs, working-context briefs and subagent relays through the very same role,
// so the event stream must be read structurally first:
//
//   1. data.source.kind is authoritative. "user" is a real human turn; every other kind
//      (runtime-context, skill-catalog, liangshen-tool-catalog, liangshen-working-context,
//      agent-message, subagent-settled, ...) is machine context.
//   2. Only when the stream carries no usable source.kind does the explicit marker list
//      below decide. It is matched as a prefix of the message head, so prose that merely
//      mentions one of these words is never misclassified.
//
// CONTEXT_MARKERS is the extension point: add a new injection shape here (keep it short
// and prefix-only) instead of scattering ad-hoc string checks through the renderer.
const CONTEXT_MARKERS = [
  '<system-reminder>',
  '<environment_context>',
  'Current runtime context',
  'Current working directory:',
  '[Working Context:',
  'Working Context:',
  'The following tools are available in this session',
  'available_tools',
  '【环境事实',
  '【项目根】',
  '【任务】',
  'sent a message:',
  'Background subagent',
];

// Returns the reason a user/message is machine context, or '' when it is a human turn.
function contextReason(data, text) {
  var source = data && typeof data === 'object' ? data.source : null;
  var kind = source && typeof source === 'object' ? compact(source.kind, 40) : '';
  // A usable source.kind decides alone: "user" is a human even if the text happens to
  // start with a marker, and anything else is context even if it reads like prose.
  if (kind) return kind === 'user' ? '' : kind;
  var head = compact(text, 160);
  for (var i = 0; i < CONTEXT_MARKERS.length; i++) {
    if (head.indexOf(CONTEXT_MARKERS[i]) === 0) return '标记 ' + CONTEXT_MARKERS[i];
  }
  return '';
}

function inlineFormat(escaped) {
  var parts = escaped.split(/(`[^`\n]+`)/g);
  var out = '';
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    if (part.length > 1 && part.charAt(0) === '`' && part.charAt(part.length - 1) === '`') {
      out += '<code class="ic">' + part.slice(1, -1) + '</code>';
    } else {
      out += part.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
    }
  }
  return out;
}

function codeBlock(code, lang) {
  var label = lang ? '<div class="clang">' + escapeText(lang) + '</div>' : '';
  return '<div class="cwrap">' + label + '<pre class="code"><code>' + escapeText(code) + '</code></pre></div>';
}

function renderMarkdown(source, redactor) {
  var src = redactor.text(str(source)).replace(/\r\n?/g, '\n');
  var lines = src.split('\n');
  var out = [];
  var i = 0;
  while (i < lines.length) {
    var line = lines[i];
    var fence = /^\s*```\s*([A-Za-z0-9_+#.-]{0,24})\s*$/.exec(line);
    if (fence) {
      var lang = fence[1] || '';
      var buffer = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { buffer.push(lines[i]); i += 1; }
      i += 1;
      out.push(codeBlock(buffer.join('\n'), lang));
      continue;
    }
    if (/^\s*$/.test(line)) { i += 1; continue; }
    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) {
      var ordered = /^\s*\d+[.)]\s+/.test(line);
      var items = [];
      while (i < lines.length && /^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ''));
        i += 1;
      }
      var tag = ordered ? 'ol' : 'ul';
      var listHtml = '';
      for (var k = 0; k < items.length; k++) listHtml += '<li>' + inlineFormat(escapeText(items[k])) + '</li>';
      out.push('<' + tag + '>' + listHtml + '</' + tag + '>');
      continue;
    }
    var para = [];
    while (
      i < lines.length && !/^\s*$/.test(lines[i]) &&
      !/^\s*```/.test(lines[i]) &&
      !/^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[i])
    ) { para.push(lines[i]); i += 1; }
    var rendered = [];
    for (var p = 0; p < para.length; p++) rendered.push(inlineFormat(escapeText(para[p])));
    out.push('<p>' + rendered.join('<br>') + '</p>');
  }
  return out.join('\n');
}

const LIGHT_VARS = [
  '--bg:#f5f7fa', '--panel:#ffffff', '--fg:#1b2028', '--muted:#5b6675', '--line:#e1e6ee',
  '--accent:#3a6df0',
  // One variable pair per speaker role, so the two identities are pure palette data.
  // The user bubble carries a real tint and a solid pill; the assistant card sits almost on
  // the page background, so the two never read as "two white boxes".
  '--user-bg:#dbe7ff', '--user-bd:#a8c3ff', '--user-fg:#111f36', '--user-dot:#a35d0c',
  '--user-pill-bg:#2a55c8', '--user-pill-fg:#ffffff',
  '--asst-bg:#fbfcfe', '--asst-bd:#e3e8f0', '--asst-fg:#1b2028', '--asst-bar:#3a6df0',
  '--asst-dot:#3a6df0', '--asst-dot-ring:#d3e0ff', '--asst-tag-bg:#d7e1f4', '--asst-tag-fg:#1f3f8f',
  '--code-bg:#f2f4f8', '--code-fg:#24292f', '--badge-bg:#edf3ff', '--badge-fg:#2b4fa8',
  '--warn-bg:#fff5e6', '--warn-fg:#8a5a00', '--shadow:0 1px 2px rgba(16,24,40,.06)',
].join(';');

const DARK_VARS = [
  '--bg:#11141a', '--panel:#181c23', '--fg:#e6eaf1', '--muted:#98a2b3', '--line:#2a3038',
  '--accent:#7aa2ff',
  '--user-bg:#1e2b47', '--user-bd:#3c5480', '--user-fg:#eaf0fb', '--user-dot:#f0b357',
  '--user-pill-bg:#5b8cff', '--user-pill-fg:#0b1220',
  '--asst-bg:#181c23', '--asst-bd:#2a3038', '--asst-fg:#e6eaf1', '--asst-bar:#7aa2ff',
  '--asst-dot:#7aa2ff', '--asst-dot-ring:#33456b', '--asst-tag-bg:#333c4d', '--asst-tag-fg:#bcd0ff',
  '--code-bg:#10141a', '--code-fg:#d8dee8', '--badge-bg:#1d2740', '--badge-fg:#a9c0ff',
  '--warn-bg:#2a2113', '--warn-fg:#f0c674', '--shadow:none',
].join(';');

const CSS = [
  ':root{' + LIGHT_VARS + ';--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Cascadia Mono","Microsoft YaHei UI",monospace}',
  ':root[data-theme="dark"]{' + DARK_VARS + '}',
  '@media (prefers-color-scheme: dark){:root[data-theme="auto"]{' + DARK_VARS + '}}',
  '*{box-sizing:border-box}',
  'html{-webkit-text-size-adjust:100%}',
  'body{margin:0;background:var(--bg);color:var(--fg);font-size:15px;line-height:1.65;overflow-wrap:anywhere;word-break:break-word;',
  'font-family:-apple-system,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",sans-serif}',
  '.wrap{max-width:880px;margin:0 auto;padding:28px 20px 56px}',
  'header.hdr{display:flex;gap:16px;align-items:flex-start;justify-content:space-between;padding:18px 20px;background:var(--panel);',
  'border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow)}',
  '.hdr-main{min-width:0;flex:1 1 auto}',
  'h1.ttl{margin:0 0 6px;font-size:20px;line-height:1.35;font-weight:650}',
  '.sub{margin:2px 0;color:var(--muted);font-size:13px}',
  '.sep{margin:0 6px;opacity:.55}',
  '.hdr-side{display:flex;gap:8px;align-items:center;flex:0 0 auto;flex-wrap:wrap}',
  '.badge{display:inline-block;padding:3px 9px;border-radius:999px;background:var(--badge-bg);color:var(--badge-fg);font-size:12px;white-space:nowrap}',
  '.badge.warn{background:var(--warn-bg);color:var(--warn-fg)}',
  'button.tbtn{font:inherit;font-size:12px;padding:5px 10px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--fg);cursor:pointer}',
  'button.tbtn:hover{border-color:var(--accent);color:var(--accent)}',
  'main.tl{margin-top:18px;display:flex;flex-direction:column;gap:14px}',
  'section.msg{padding:14px 16px;border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);min-width:0}',
  // Two speakers, two identities: side, width, background, border, corner shape, marker
  // shape and name tag all differ, so neither bubble needs its label to be recognised.
  'section.msg-user{align-self:flex-end;margin:20px 0;max-width:86%;background:var(--user-bg);color:var(--user-fg);border-color:var(--user-bd);border-radius:16px 16px 4px 16px}',
  'section.msg-assistant{position:relative;align-self:flex-start;margin-right:auto;max-width:100%;background:var(--asst-bg);color:var(--asst-fg);border-color:var(--asst-bd);border-left:3px solid var(--asst-bar);border-radius:4px 16px 16px 16px}',
  // A run of assistant cards is one continuous reply: section.turn's 12px gap keeps them
  // apart, and this hairline sits centred in that gap so two cards never fuse into a block.
  'section.msg-assistant+section.msg-assistant::before{content:"";position:absolute;left:0;right:0;top:-6px;height:1px;background:var(--line)}',
  // The identity bar is its own block above the body: a solid pill for "你", a round avatar
  // plus a plain name and a hairline for "DeepSeek". Never inline with the prose.
  '.who{font-size:12px;font-weight:600;letter-spacing:.4px;color:var(--muted);margin-bottom:6px;display:flex;align-items:center;gap:7px}',
  '.dot{width:8px;height:8px;display:inline-block;flex:0 0 auto}',
  '.msg-user .who{flex-direction:row-reverse;justify-content:flex-start;margin-bottom:10px}',
  '.msg-user .who .name{padding:2px 11px;border-radius:999px;background:var(--user-pill-bg);color:var(--user-pill-fg);font-size:11.5px;letter-spacing:.6px}',
  '.msg-user .dot{width:7px;height:7px;background:var(--user-dot);border-radius:2px;transform:rotate(45deg)}',
  '.msg-assistant .who{justify-content:flex-start;padding-bottom:8px;margin-bottom:12px;border-bottom:1px solid var(--asst-tag-bg)}',
  '.msg-assistant .who .name{color:var(--asst-tag-fg);font-size:12px;letter-spacing:.3px}',
  '.msg-assistant .dot{width:9px;height:9px;border-radius:50%;background:var(--asst-dot);box-shadow:0 0 0 2px var(--asst-dot-ring)}',
  '.md p{margin:0 0 10px}.md p:last-child{margin-bottom:0}',
  '.md ul,.md ol{margin:0 0 10px;padding-left:1.4em}',
  '.md li{margin:2px 0}',
  '.md code.ic{background:var(--code-bg);padding:1px 5px;border-radius:5px;font-size:.9em;font-family:var(--mono)}',
  '.cwrap{margin:10px 0;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--code-bg)}',
  '.clang{font-size:11px;letter-spacing:.8px;text-transform:uppercase;color:var(--muted);padding:6px 12px;border-bottom:1px solid var(--line)}',
  'pre.code{margin:0;padding:12px;overflow-x:auto;max-width:100%;font-family:var(--mono);font-size:12.5px;line-height:1.55;color:var(--code-fg);tab-size:2}',
  'pre.code code{font-family:inherit;white-space:pre}',
  'details.blk{background:var(--panel);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow);min-width:0}',
  'details.blk>summary{cursor:pointer;list-style:none;padding:10px 14px;font-size:13px;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}',
  'details.blk>summary::-webkit-details-marker{display:none}',
  'details.blk>summary::before{content:"▸";color:var(--muted);font-size:11px;line-height:1.6}',
  'details.blk[open]>summary::before{content:"▾"}',
  '.tname{font-family:var(--mono);font-weight:600;color:var(--accent)}',
  '.tmeta{color:var(--muted);font-size:12.5px;min-width:0}',
  'section.turn{display:flex;flex-direction:column;gap:12px;min-width:0}',
  'details.glue{border:0;background:transparent;box-shadow:none;min-width:0}',
  'details.glue>summary{cursor:pointer;list-style:none;display:flex;gap:6px;align-items:baseline;flex-wrap:wrap;padding:2px 0;font-size:11.5px;line-height:1.4;color:var(--muted);border-top:1px dashed var(--line)}',
  'details.glue>summary::-webkit-details-marker{display:none}',
  'details.glue>summary:hover{color:var(--accent)}',
  'details.glue>summary::before{content:"▸";font-size:9px;line-height:1.9;opacity:.75}',
  'details.glue[open]>summary::before{content:"▾"}',
  '.gname{font-weight:600}',
  '.gmeta{font-weight:400;opacity:.9}',
  'details.glue>.body{padding:4px 0 0 12px;display:flex;flex-direction:column;gap:6px}',
  'details.glue details.blk{box-shadow:none;border:1px solid var(--line);border-radius:8px;background:transparent}',
  'details.glue details.blk>summary{padding:6px 10px;font-size:11.5px;color:var(--muted)}',
  'details.glue details.blk>.body{padding:0 10px 10px}',
  'details.glue details.blk .md{font-size:12.5px}',
  'details.glue details.blk-ctx{border-style:dashed;border-color:var(--line)}',
  'details.glue details.blk-ctx>summary .tname{color:var(--muted)}',
  'details.glue details.blk-ctx pre.raw{margin:0;padding:0;font-family:inherit;font-size:11.5px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--muted)}',
  'details.blk>.body{padding:0 14px 14px}',
  '.lbl{font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);margin:10px 0 4px}',
  '.trunc{font-size:12px;color:var(--warn-fg);background:var(--warn-bg);border-radius:6px;padding:2px 8px;display:inline-block;margin-top:6px}',
  'ul.evtlist{margin:6px 0 0;padding-left:1.2em;font-size:12.5px;color:var(--muted)}',
  'ul.evtlist code{font-family:var(--mono);color:var(--fg)}',
  'p.note{margin:8px 0 0;font-size:12.5px;color:var(--muted)}',
  'p.tnote{margin:2px 0 0;font-size:11px;line-height:1.4;color:var(--muted);opacity:.72;letter-spacing:.2px}',
  'footer.ftr{margin-top:26px;padding-top:14px;border-top:1px solid var(--line);color:var(--muted);font-size:12.5px;display:flex;flex-wrap:wrap}',
  'footer.ftr b{color:var(--fg);font-weight:600}',
  '@media (max-width:640px){.wrap{padding:16px 12px 40px}header.hdr{flex-direction:column;gap:10px;padding:14px}',
  '.hdr-side{align-self:flex-start}h1.ttl{font-size:17px}section.msg{padding:12px}pre.code{font-size:12px}',
  'section.msg-user{max-width:94%}section.msg-assistant{max-width:100%}.msg-user .who,.msg-assistant .who .name{font-size:11px}}',
  '@media print{body{background:#fff;color:#000}header.hdr,section.msg,details.blk{box-shadow:none}',
  // Paper and ink: the solid pill would print as white text on an unprinted (white) fill.
  'details,details>*{display:block !important}details>summary::before{content:"—"}.msg-user .who .name{background:transparent;color:#000}',
  'pre.code{white-space:pre-wrap;word-break:break-word;overflow:visible}}',
].join('\n');

const SCRIPT = [
  '(function () {',
  '  var root = document.documentElement;',
  '  var KEY = "dsh-share-theme";',
  '  var order = ["auto", "light", "dark"];',
  '  var labels = { auto: "自动", light: "浅色", dark: "深色" };',
  '  function apply(theme) {',
  '    root.setAttribute("data-theme", theme);',
  '    var btn = document.getElementById("theme-toggle");',
  '    if (btn) {',
  '      btn.textContent = labels[theme] || labels.auto;',
  '      btn.setAttribute("title", "主题：" + (labels[theme] || labels.auto) + "（点击切换）");',
  '    }',
  '  }',
  '  var saved = "auto";',
  '  try {',
  '    var raw = window.localStorage.getItem(KEY);',
  '    if (raw === "light" || raw === "dark" || raw === "auto") { saved = raw; }',
  '  } catch (error) { saved = "auto"; }',
  '  apply(saved);',
  '  var button = document.getElementById("theme-toggle");',
  '  if (button) {',
  '    button.addEventListener("click", function () {',
  '      var current = root.getAttribute("data-theme") || "auto";',
  '      var next = order[(order.indexOf(current) + 1) % order.length];',
  '      apply(next);',
  '      try { window.localStorage.setItem(KEY, next); } catch (error) {}',
  '    });',
  '  }',
  '  var opened = [];',
  '  function expandAll() {',
  '    opened = [];',
  '    var nodes = document.querySelectorAll("details");',
  '    for (var i = 0; i < nodes.length; i++) {',
  '      if (!nodes[i].open) { nodes[i].open = true; opened.push(nodes[i]); }',
  '    }',
  '  }',
  '  function restore() {',
  '    for (var i = 0; i < opened.length; i++) { opened[i].open = false; }',
  '    opened = [];',
  '  }',
  '  window.addEventListener("beforeprint", expandAll);',
  '  window.addEventListener("afterprint", restore);',
  '  if (window.matchMedia) {',
  '    var mq = window.matchMedia("print");',
  '    var onChange = function (event) { if (event.matches) { expandAll(); } else { restore(); } };',
  '    if (mq.addEventListener) { mq.addEventListener("change", onChange); }',
  '    else if (mq.addListener) { mq.addListener(onChange); }',
  '  }',
  '})();',
].join('\n');

// The machine identity is derived from the session's own cwd fields - never from the
// environment, a module or a config file - so the renderer stays a pure function.
const USERNAME_PATTERNS = [
  /[A-Za-z]:[\\/]+Users[\\/]+([^\\/\s"'<>|*?,;:]+)/i,
  /\/[cC]\/Users\/([^\/\s"'<>|*?,;:]+)/,
  /\/Users\/([^\/\s"'<>|*?,;:]+)/,
  /\/home\/([^\/\s"'<>|*?,;:]+)/,
  /-Users-([^-\/\\\s"'<>|*?,;:]+)/i,
  /-home-([^-\/\\\s"'<>|*?,;:]+)/i,
];

function collectUsernames(session, events, rawText) {
  var found = [];
  var seen = Object.create(null);

  function consider(value) {
    if (typeof value !== 'string' || !value) return;
    for (var p = 0; p < USERNAME_PATTERNS.length; p++) {
      var match = USERNAME_PATTERNS[p].exec(value);
      if (!match) continue;
      var name = match[1];
      if (!name || name.length < 2) continue;
      var key = name.toLowerCase();
      if (seen[key]) continue;
      seen[key] = true;
      found.push(name);
    }
  }

  if (session && typeof session === 'object') consider(session.cwd);
  for (var i = 0; i < events.length; i++) {
    var event = events[i];
    if (!event || typeof event !== 'object') continue;
    consider(event.cwd);
    var data = event.data;
    if (data && typeof data === 'object') {
      consider(data.cwd);
      consider(data.projectPath);
      consider(data.workspace);
    }
  }
  // Last resort: scan the raw payload once. Only reached when no cwd field carried a
  // home path, so an ordinary conversation never pays this cost.
  if (!found.length && typeof rawText === 'string') consider(rawText);
  return found;
}

// One definition of "a shareable conversation entry", shared by the picker index and by
// options.pick inside the renderer: a real human turn (never machine context, never an
// inline context row) or an assistant message that actually carries prose. Reasoning,
// tool traffic and injected context are traces, so they never become entries.
// tools/context are per-turn counts - they tell the picker what a turn still brings along.
function collectEntries(events, redactor) {
  var turns = [];
  var current = null;
  function open(turn) {
    current = { turn: turn == null ? '' : str(turn), drafts: [], context: 0, tools: 0 };
    turns.push(current);
    return current;
  }
  function cell() { return current || open(''); }
  for (var i = 0; i < events.length; i++) {
    var event = events[i];
    if (!event || typeof event !== 'object') continue;
    var type = str(event.type);
    var data = event.data && typeof event.data === 'object' ? event.data : {};
    if (type === 'turn/start') { open(data.turn); continue; }
    if (type === 'tool/call') { cell().tools += 1; continue; }
    if (type === 'user/message') {
      var userBlocks = blocksOf(data);
      var speech = [];
      for (var b = 0; b < userBlocks.length; b++) {
        var blockType = str(userBlocks[b].type);
        if (blockType !== 'text' && blockType !== '') continue;
        var blockText = str(userBlocks[b].text);
        if (blockText.trim()) speech.push(blockText);
      }
      var text = speech.join('\n');
      // Same rule the renderer applies: an empty user message can never be context, and a
      // non-empty one is context whenever its source.kind (or the marker list) says so.
      if (text && contextReason(data, text)) { cell().context += 1; continue; }
      var userId = messageId(event, i);
      cell().drafts.push({ kind: 'user', id: userId, seq: Number(userId.slice(1)), time: eventTime(event), raw: text });
      continue;
    }
    if (type === 'assistant/message') {
      var messageBlocks = blocksOf(data.message);
      var parts = [];
      for (var a = 0; a < messageBlocks.length; a++) {
        var messageType = str(messageBlocks[a].type);
        if (messageType !== 'text' && messageType !== '') continue;
        var messageText = str(messageBlocks[a].text);
        if (messageText.trim()) parts.push(messageText);
      }
      // A thinking-only message emits no bubble, so it is not something to pick either.
      if (!parts.length) continue;
      var assistantId = messageId(event, i);
      cell().drafts.push({
        kind: 'assistant',
        id: assistantId,
        seq: Number(assistantId.slice(1)),
        time: eventTime(event),
        raw: parts.join('\n'),
      });
      continue;
    }
  }
  var entries = [];
  for (var t = 0; t < turns.length; t++) {
    var turn = turns[t];
    var turnNumber = Number(turn.turn);
    if (!isFinite(turnNumber)) turnNumber = 0;
    for (var d = 0; d < turn.drafts.length; d++) {
      var draft = turn.drafts[d];
      var redacted = redactor.text(draft.raw);
      entries.push({
        id: draft.id,
        kind: draft.kind,
        turn: turnNumber,
        seq: draft.seq,
        time: draft.time,
        label: excerptLabel(redacted),
        chars: redacted.length,
        tools: turn.tools,
        context: turn.context,
      });
    }
  }
  return { entries: entries, total: entries.length };
}

// The message index behind the picker: every entry the share page could show, in stream
// order, with the label a human scans. Rendering is not involved, so this stays cheap
// enough for a menu that opens on click.
export function indexSession(input) {
  var source = input && typeof input === 'object' ? input : {};
  var rawOptions = source.options && typeof source.options === 'object' ? source.options : {};
  var parsed = normalizeEvents(source.events);
  var usernames = collectUsernames(source.session, parsed.items,
    typeof source.events === 'string' ? source.events : '');
  var redactor = createRedactor({ enabled: rawOptions.redact !== false, usernames: usernames });
  var index = collectEntries(parsed.items, redactor);
  return { entries: index.entries, total: index.total };
}

export function renderSessionHtml(input) {
  var source = input && typeof input === 'object' ? input : {};
  var rawOptions = source.options && typeof source.options === 'object' ? source.options : {};
  var redactEnabled = rawOptions.redact !== false;
  var theme = rawOptions.theme === 'light' || rawOptions.theme === 'dark' ? rawOptions.theme : 'auto';
  // Reasoning is a trace, not the conversation. omit (default) keeps every byte of it out
  // of the document, count keeps one faint line per turn, full restores the old export.
  var reasoningMode = rawOptions.reasoning === 'count' || rawOptions.reasoning === 'full'
    ? rawOptions.reasoning : 'omit';

  var parsed = normalizeEvents(source.events);
  var events = parsed.items;
  var badLines = parsed.badLines;

  var usernames = collectUsernames(source.session, events,
    typeof source.events === 'string' ? source.events : '');
  var redactor = createRedactor({ enabled: redactEnabled, usernames: usernames });

  // options.pick: undefined ships the whole session (the historical behaviour), an empty
  // array ships an explicitly empty page, and a non-empty list ships only the entries it
  // names, in their original stream order. The index uses its own redactor so the header
  // count keeps reporting the hits of the document alone.
  var pickActive = false;
  var pickIds = new Set();
  if (Array.isArray(rawOptions.pick)) {
    pickActive = true;
    for (var pi = 0; pi < rawOptions.pick.length; pi++) {
      var pickId = rawOptions.pick[pi];
      if (typeof pickId === 'string' && pickId) pickIds.add(pickId);
    }
  }
  var entryIndex = collectEntries(events, createRedactor({ enabled: redactEnabled, usernames: usernames }));
  var totalEntries = entryIndex.total;
  var pickedEntries = 0;

  function redact(value) { return redactor.text(value); }
  function out(value) { return escapeText(value); }

  var header = source.session && typeof source.session === 'object' ? source.session : {};
  var meta = {
    id: str(header.id || header.sessionId),
    cwd: str(header.cwd),
    agentPreset: str(header.agentPreset),
    createdAt: header.createdAt,
  };

  var resultsByCallId = new Map();
  var callIds = new Set();
  var usedResults = new Set();
  for (var r = 0; r < events.length; r++) {
    var resultEvent = events[r];
    if (!resultEvent || resultEvent.type !== 'tool/result') continue;
    var resultData = resultEvent.data || {};
    var resultMessage = resultData.message || {};
    var resultCallId = str(resultMessage.toolCallId || resultData.toolCallId ||
      (resultMessage.source && resultMessage.source.callId));
    if (resultCallId && !resultsByCallId.has(resultCallId)) resultsByCallId.set(resultCallId, resultEvent);
  }
  for (var c = 0; c < events.length; c++) {
    var callEvent = events[c];
    if (!callEvent || callEvent.type !== 'tool/call') continue;
    var callId = str((callEvent.data || {}).callId);
    if (!callId) continue;
    callIds.add(callId);
    if (resultsByCallId.has(callId)) usedResults.add(resultsByCallId.get(callId));
  }

  function kChars(chars) {
    if (chars >= 1000) return (Math.round(chars / 100) / 10) + 'k';
    return String(chars);
  }

  // One reasoning segment: always nested inside its turn's single glue line, so it can
  // never add a row to the main timeline by itself.
  function reasoningSegment(index, text) {
    var chars = str(text).length;
    return '<details class="blk blk-think" data-kind="think"><summary><span class="tname">第 ' + (index + 1) + ' 段</span>' +
      '<span class="tmeta">· ' + out(kChars(chars)) + ' 字</span></summary><div class="body"><div class="md">' +
      renderMarkdown(text, redactor) + '</div></div></details>';
  }

  // Every reasoning block of one turn collapses into ONE muted line: a session with 91
  // segments costs a handful of faint rows, not dozens of screens of thinking.
  function reasoningGlue(list) {
    var total = 0;
    var segments = [];
    for (var i = 0; i < list.length; i++) {
      total += str(list[i]).length;
      segments.push(reasoningSegment(i, list[i]));
    }
    return '<details class="glue glue-think" data-kind="glue-think"><summary><span class="gname">思考过程</span>' +
      '<span class="gmeta">· ' + list.length + ' 段 · 约 ' + out(kChars(total)) + ' 字</span></summary>' +
      '<div class="body">' + segments.join('') + '</div></details>';
  }

  // count: one faint, non-interactive line per turn - the number of segments, never their text.
  function reasoningNote(count) {
    return '<p class="tnote" data-kind="think-count">思考 ' + count + ' 段 · 已省略</p>';
  }

  // Same treatment for tool traffic: one line per turn, the per-call detail (arguments
  // and result, still truncated by the same limits) lives one level deeper.
  function toolGlue(list) {
    var errors = 0;
    var entries = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].isError) errors += 1;
      entries.push(toolBlock(list[i].name, list[i].rawArgs, list[i].resultEvent));
    }
    return '<details class="glue glue-tool" data-kind="glue-tool"><summary><span class="gname">工具调用</span>' +
      '<span class="gmeta">· ' + list.length + ' 次' + (errors ? ' · ' + errors + ' 出错' : '') + '</span></summary>' +
      '<div class="body">' + entries.join('') + '</div></details>';
  }

  // Machine context is not something the user said: one grey row per turn, everything
  // one level deeper and still collapsed, so the conversation keeps the page.
  function contextCard(list) {
    var items = [];
    for (var i = 0; i < list.length; i++) items.push(contextItem(i, list[i]));
    return '<details class="glue glue-ctx" data-kind="glue-ctx"><summary><span class="gname">内联上下文</span>' +
      '<span class="gmeta">· ' + list.length + ' 条</span></summary>' +
      '<div class="body">' + items.join('') + '</div></details>';
  }

  // Machine text is reproduced verbatim (indentation, fences and list markers intact):
  // a share page must not reflow a runtime snapshot or a tool catalog. Only redaction and
  // HTML escaping run, so the expanded body is the original text character for character.
  function contextItem(index, item) {
    var chars = str(item.text).length;
    return '<details class="blk blk-ctx" data-kind="ctx"><summary><span class="tname">第 ' + (index + 1) + ' 条</span>' +
      '<span class="tmeta">· ' + out(kChars(chars)) + ' 字 · ' + out(item.reason) + '</span></summary>' +
      '<div class="body"><pre class="raw">' + out(redact(item.text)) + '</pre></div></details>';
  }

  function toolBlock(name, rawArgs, resultEvent) {
    var displayName = str(name) || 'tool';
    var argsPretty = redact(prettyArguments(rawArgs));
    var resultRaw = resultEvent ? redact(resultTextOf(resultEvent)) : '';
    var isError = !!(resultEvent && resultEvent.data && resultEvent.data.message && resultEvent.data.message.isError);
    var summary = resultEvent ? (summarize(resultRaw, 60) || '（空结果）') : '无结果记录';
    var head = '<summary><span class="tname">' + out(displayName) + '</span><span class="tmeta">· ' +
      out(summary) + (resultEvent ? ' · ' + lineCount(resultRaw) + ' 行' : '') + '</span>' +
      (isError ? '<span class="badge warn">出错</span>' : '') + '</summary>';
    var body = '';
    if (argsPretty.trim()) {
      var argsClip = clip(argsPretty, ARGS_LIMIT);
      body += '<div class="lbl">参数</div><pre class="code"><code>' + out(argsClip.text) + '</code></pre>';
      if (argsClip.truncated) body += '<div class="trunc">参数已截断（原始 ' + argsPretty.length + ' 字符）</div>';
    }
    if (resultEvent) {
      var resultClip = clip(resultRaw, RESULT_LIMIT);
      body += '<div class="lbl">结果</div><pre class="code"><code>' + out(resultClip.text) + '</code></pre>';
      if (resultClip.truncated) {
        body += '<div class="trunc">结果已截断：仅显示前 ' + RESULT_LIMIT + ' 字符（原始 ' + resultRaw.length + ' 字符）</div>';
      }
    } else {
      body += '<p class="note">该工具调用没有配对的 tool/result 事件。</p>';
    }
    return '<details class="blk blk-tool" data-kind="tool">' + head + '<div class="body">' + body + '</div></details>';
  }

  // The timeline is built turn by turn. Each turn keeps an ordered list of the things a
  // reader came for (user prompt, assistant prose) plus two traces (reasoning, tools)
  // that are aggregated into a single faint line appended AFTER that turn's prose.
  var groups = [];
  var current = null;
  var counts = new Map();
  var userMessages = 0;
  var assistantMessages = 0;
  var contextMessages = 0;
  var toolCalls = 0;
  var reasoningBlocks = 0;
  var reasoningRows = 0;
  var collapsedBlocks = 0;
  var topLevelBlocks = 0;
  var unpairedResults = 0;
  var unknownBlocks = new Map();
  var sessionTitle = '';
  var firstUserText = '';

  function openGroup(turn) {
    current = { turn: turn == null ? '' : str(turn), items: [], contexts: [], reasonings: [], reasoningCount: 0, tools: [] };
    groups.push(current);
    return current;
  }
  function cell() { return current || openGroup(''); }

  for (var i = 0; i < events.length; i++) {
    var event = events[i];
    if (!event || typeof event !== 'object') continue;
    var type = str(event.type);
    var data = event.data && typeof event.data === 'object' ? event.data : {};

    if (type === 'session') {
      if (!meta.id) meta.id = str(event.id || event.sessionId);
      if (!meta.cwd) meta.cwd = str(event.cwd);
      if (!meta.agentPreset) meta.agentPreset = str(event.agentPreset);
      if (meta.createdAt == null) meta.createdAt = event.createdAt;
      continue;
    }
    if (type === 'session/title') {
      if (typeof data.title === 'string' && data.title.trim()) sessionTitle = data.title.trim();
      continue;
    }
    if (type === 'turn/start') { openGroup(data.turn); continue; }
    if (type === 'tool/result') {
      if (!usedResults.has(event)) { unpairedResults += 1; counts.set('tool/result（未配对）', (counts.get('tool/result（未配对）') || 0) + 1); }
      continue;
    }
    if (type === 'user/message') {
      var userBlocks = blocksOf(data);
      var userParts = [];
      var userSpeech = [];
      for (var ub = 0; ub < userBlocks.length; ub++) {
        var userBlock = userBlocks[ub];
        var userType = str(userBlock.type);
        if (userType === 'text' || userType === '') {
          var userText = str(userBlock.text);
          if (userText.trim()) {
            userParts.push('<div class="md">' + renderMarkdown(userText, redactor) + '</div>');
            userSpeech.push(userText);
          }
        } else {
          unknownBlocks.set('user:' + (userType || '(none)'), (unknownBlocks.get('user:' + userType) || 0) + 1);
        }
      }
      userMessages += 1;
      var speechText = userSpeech.join('\n');
      var reason = speechText ? contextReason(data, speechText) : '';
      // Injected context keeps every byte (each entry is expandable in full) but loses
      // its "you said this" bubble: it becomes one faint row on the turn.
      if (reason) {
        contextMessages += 1;
        cell().contexts.push({ reason: reason, text: speechText });
        continue;
      }
      // A message the picker did not name ships nothing - not even its text, so it can
      // never leak into the document through a title or a bubble.
      if (pickActive && !pickIds.has(messageId(event, i))) continue;
      pickedEntries += 1;
      if (!firstUserText && speechText) firstUserText = compact(speechText, 200);
      if (!userParts.length) userParts.push('<p class="note">（此用户消息没有可显示的文本内容）</p>');
      cell().items.push('<section class="msg msg-user" data-role="user"><div class="who"><span class="dot"></span>' +
        '<span class="name">你</span></div>' +
        userParts.join('') + '</section>');
      continue;
    }
    if (type === 'assistant/message') {
      var assistantBlocks = blocksOf(data.message);
      var assistantParts = [];
      var assistantCell = cell();
      for (var ab = 0; ab < assistantBlocks.length; ab++) {
        var assistantBlock = assistantBlocks[ab];
        var assistantType = str(assistantBlock.type);
        if (assistantType === 'reasoning' || assistantType === 'thinking') {
          // omit/count never retain the text: a thinking block must not reach a single byte.
          assistantCell.reasoningCount += 1;
          if (reasoningMode === 'full') assistantCell.reasonings.push(str(assistantBlock.text));
          reasoningBlocks += 1;
        } else if (assistantType === 'text' || assistantType === '') {
          var assistantText = str(assistantBlock.text);
          if (assistantText.trim()) assistantParts.push('<div class="md">' + renderMarkdown(assistantText, redactor) + '</div>');
        } else if (assistantType === 'tool-call') {
          continue;
        } else {
          unknownBlocks.set('assistant:' + (assistantType || '(none)'), (unknownBlocks.get('assistant:' + assistantType) || 0) + 1);
        }
      }
      assistantMessages += 1;
      // A message that carries only thinking is fully covered by the turn's glue line,
      // so it emits no bubble: an empty "DeepSeek" card would only add noise.
      if (assistantParts.length && (!pickActive || pickIds.has(messageId(event, i)))) {
        pickedEntries += 1;
        assistantCell.items.push('<section class="msg msg-assistant" data-role="assistant"><div class="who"><span class="dot"></span>' +
          '<span class="name">DeepSeek</span></div>' +
          assistantParts.join('') + '</section>');
      }
      continue;
    }
    if (type === 'tool/call') {
      var toolCallId = str(data.callId);
      var matched = toolCallId && resultsByCallId.has(toolCallId) ? resultsByCallId.get(toolCallId) : null;
      toolCalls += 1;
      cell().tools.push({
        name: data.name,
        rawArgs: data.arguments,
        resultEvent: matched,
        isError: !!(matched && matched.data && matched.data.message && matched.data.message.isError),
      });
      continue;
    }
    var bucket = type || '(无 type)';
    counts.set(bucket, (counts.get(bucket) || 0) + 1);
  }

  unknownBlocks.forEach(function (count, key) {
    counts.set('block:' + key, count);
  });

  var timeline = [];
  var turns = 0;
  for (var gi = 0; gi < groups.length; gi++) {
    var group = groups[gi];
    // A turn nobody picked ships nothing at all; a turn with at least one picked message
    // keeps its inline-context card and its tool row, exactly as the full export does.
    if (pickActive && !group.items.length) continue;
    var body = group.items.slice();
    if (group.contexts.length) {
      body.push(contextCard(group.contexts));
      collapsedBlocks += 1;
      topLevelBlocks += 1;
    }
    if (group.reasoningCount) {
      if (reasoningMode === 'full') {
        body.push(reasoningGlue(group.reasonings));
        collapsedBlocks += 1;
        topLevelBlocks += 1;
      } else if (reasoningMode === 'count') {
        body.push(reasoningNote(group.reasoningCount));
        reasoningRows += 1;
      }
    }
    if (group.tools.length) {
      body.push(toolGlue(group.tools));
      collapsedBlocks += 1;
      topLevelBlocks += 1;
    }
    if (!body.length) continue;
    turns += 1;
    timeline.push('<section class="turn" data-turn="' + out(group.turn || String(turns)) + '">' +
      body.join('') + '</section>');
  }
  // Every rendered reasoning segment and every tool call is still its own collapsed element.
  if (reasoningMode === 'full') collapsedBlocks += reasoningBlocks;
  collapsedBlocks += toolCalls;

  var title = typeof rawOptions.title === 'string' && rawOptions.title.trim()
    ? rawOptions.title.trim()
    : (sessionTitle || compact(firstUserText, USER_TITLE_LEN) || 'DSH 会话记录');

  var titleHtml = out(redact(title));
  var generatedAt = out(formatTimestamp(rawOptions.now));
  var cwdHtml = meta.cwd ? out(redact(meta.cwd)) : '';
  var presetHtml = meta.agentPreset ? out(redact(meta.agentPreset)) : '';
  var idHtml = meta.id ? out(redact(meta.id)) : '';

  var internalHtml = '';
  var internalTotal = 0;
  counts.forEach(function (count) { internalTotal += count; });
  if (internalTotal > 0) {
    var entries = [];
    counts.forEach(function (count, key) { entries.push([key, count]); });
    entries.sort(function (a, b) { return b[1] - a[1] || (a[0] < b[0] ? -1 : 1); });
    var listHtml = '';
    for (var e = 0; e < entries.length; e++) {
      listHtml += '<li><code>' + out(entries[e][0]) + '</code> × ' + entries[e][1] + '</li>';
    }
    collapsedBlocks += 1;
    topLevelBlocks += 1;
    internalHtml = '<details class="blk blk-internal" data-kind="internal"><summary><span class="tname">内部事件</span>' +
      '<span class="tmeta">（' + internalTotal + ' 条）</span></summary><div class="body"><ul class="evtlist">' + listHtml + '</ul>' +
      '<p class="note">调度、流式与目录类事件，不承载对话正文。本会话事件流中没有子代理正文，只有 ptc 派发记录与 subagent 目录记录，因此这里只列计数。</p>' +
      '</div></details>';
  }

  var redacted = redactor.redactedCount;
  var userSpeechCount = userMessages - contextMessages;
  // 用户消息 counts real human turns only: the injected rows are listed as such, so a
  // reader never mistakes a tool catalog or a subagent relay for something the user said.
  var countLine = '轮次 ' + turns + '<span class="sep">·</span>用户消息 ' + userSpeechCount +
    '<span class="sep">·</span>内联上下文 ' + contextMessages +
    '<span class="sep">·</span>助手消息 ' + assistantMessages +
    '<span class="sep">·</span>工具调用 ' + toolCalls;
  var metaBits = [];
  if (idHtml) metaBits.push('会话 ' + idHtml);
  if (presetHtml) metaBits.push('预设 ' + presetHtml);
  if (cwdHtml) metaBits.push('工作目录 ' + cwdHtml);
  var headerHtml = '<header class="hdr"><div class="hdr-main"><h1 class="ttl">' + titleHtml + '</h1>' +
    '<p class="sub">生成时间 ' + generatedAt + '<span class="sep">·</span>' + countLine + '</p>' +
    (metaBits.length ? '<p class="sub">' + metaBits.join('<span class="sep">·</span>') + '</p>' : '') +
    '</div><div class="hdr-side">' +
    (pickActive ? '<span class="badge">已选 ' + pickedEntries + ' / ' + totalEntries + ' 条</span>' : '') +
    (redacted > 0 ? '<span class="badge warn">已脱敏 ' + redacted + ' 处</span>' : '') +
    '<span class="badge">分享自 DSH</span>' +
    '<button id="theme-toggle" class="tbtn" type="button" aria-label="切换主题">自动</button>' +
    '</div></header>';

  var footerBits = [
    '轮次 <b>' + turns + '</b>',
    '用户消息 <b>' + userSpeechCount + '</b>',
    '内联上下文 <b>' + contextMessages + '</b> 条',
    '助手消息 <b>' + assistantMessages + '</b>',
    '工具调用 <b>' + toolCalls + '</b>',
    '折叠块 <b>' + collapsedBlocks + '</b>',
    '已脱敏 <b>' + redacted + '</b> 处',
    '坏行 <b>' + badLines + '</b>',
    '事件 <b>' + events.length + '</b> 条',
  ];
  var footerHtml = '<footer class="ftr">' + footerBits.join('<span class="sep">·</span>') + '</footer>';

  // An empty pick is a legitimate request: a page that says so beats an exception or a
  // document that silently ships nothing.
  var emptyHtml = '';
  if (pickActive && pickedEntries === 0) {
    emptyHtml = '<p class="note" data-kind="pick-empty">未选择任何消息。本页只包含你在分享菜单里挑中的对话条目，' +
      '没有挑中的消息不会出现在这里；请返回分享菜单重新选择后再生成预览。</p>';
  }

  var html = '<!DOCTYPE html>\n<html lang="zh-CN" data-theme="' + theme + '">\n<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<meta name="generator" content="DSH session share ' + VERSION + '">\n' +
    '<title>' + titleHtml + '</title>\n' +
    '<style>\n' + CSS + '\n</style>\n' +
    '</head>\n<body>\n<div class="wrap">\n' + headerHtml + '\n' +
    '<main class="tl">\n' + (emptyHtml ? emptyHtml + '\n' : '') + timeline.join('\n') +
    (internalHtml ? '\n' + internalHtml : '') + '\n</main>\n' +
    footerHtml + '\n</div>\n' +
    '<script>\n' + SCRIPT + '\n</script>\n' +
    '</body>\n</html>\n';

  return {
    html: html,
    stats: {
      userMessages: userMessages,
      userSpeech: userSpeechCount,
      contextMessages: contextMessages,
      assistantMessages: assistantMessages,
      reasoning: reasoningMode,
      reasoningBlocks: reasoningBlocks,
      reasoningRows: reasoningRows,
      toolCalls: toolCalls,
      collapsedBlocks: collapsedBlocks,
      topLevelBlocks: topLevelBlocks,
      turns: turns,
      // picked is what the document actually carries; totalEntries is what it could have
      // carried (both are the same number when no pick was requested).
      picked: pickedEntries,
      totalEntries: totalEntries,
      redacted: redacted,
      badLines: badLines,
      bytes: utf8Length(html),
    },
  };
}

// The native snapshot builder consumes the same normalizers the HTML renderer uses, so a
// hosted share and a downloaded page can never disagree about what counts as speech,
// context, reasoning or an unpaired tool result.
export {
  normalizeEvents,
  blocksOf,
  resultTextOf,
  prettyArguments,
  clip,
  compact,
  plainMarkdown,
  excerptLabel,
  messageId,
  eventTime,
  summarize,
  lineCount,
  contextReason,
  collectUsernames,
  formatTimestamp,
  ARGS_LIMIT,
  RESULT_LIMIT,
  USER_TITLE_LEN,
};
