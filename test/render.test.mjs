// test/render.test.mjs - acceptance tests for lib/render.js + lib/redact.js
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSessionHtml, indexSession, VERSION } from '../lib/render.js';
import { createRedactor, DEFAULT_RULES } from '../lib/redact.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'fixtures', 'session-sample.events.jsonl');
const outDir = join(here, 'out');
const outPath = join(outDir, 'session-sample.html');
const BT = String.fromCharCode(96);
const FENCE = BT + BT + BT;

let passed = 0;
let failed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  PASS  ' + name);
  } catch (error) {
    failed += 1;
    failures.push(name + ' :: ' + error.message);
    console.log('  FAIL  ' + name + '  ->  ' + error.message);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function escapeIndependent(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function assertBalanced(html, tags) {
  const re = new RegExp('<(/?)(' + tags.join('|') + ')\\b[^>]*?(/?)>', 'g');
  const stack = [];
  let match;
  while ((match = re.exec(html)) !== null) {
    const closing = match[1] === '/';
    const name = match[2];
    const selfClosing = match[3] === '/';
    if (selfClosing) continue;
    if (!closing) {
      stack.push(name);
    } else {
      const top = stack.pop();
      if (top !== name) throw new Error('unbalanced </' + name + '> at offset ' + match.index + ', open was <' + top + '>');
    }
  }
  if (stack.length) throw new Error('unclosed tags: ' + stack.join(', '));
}

// ---------------------------------------------------------------------------
// Layout instrumentation: what a reader actually sees with every <details> closed
// (the default state of the page). Whitespace is not counted as a visible character.
// ---------------------------------------------------------------------------

function decodeEntities(value) {
  return String(value)
    .replace(/&#(\d+);/g, (all, code) => String.fromCharCode(Number(code)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripTags(value) {
  return String(value).replace(/<[^>]*>/g, '');
}

function textOf(value) {
  return decodeEntities(stripTags(value));
}

function charCount(value) {
  return String(value).replace(/\s+/g, '').length;
}

const VOID_TAGS = new Set(['br', 'img', 'input', 'meta', 'link', 'hr']);

// Walks the document once, splitting its text into three buckets:
//   mainText       - text outside every <details> (the conversation, always on screen)
//   topSummaryText - text in a summary of a TOP-LEVEL details: the faint trace rows that
//                    are on screen while everything is still collapsed (default state)
//   summaryText    - text in any summary, nested ones included (only reachable by clicking)
//   hiddenText     - text inside a <details> body (only visible after expanding)
function analyzeLayout(source) {
  const cleaned = String(source)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let detailsDepth = 0;
  let summaryDepth = 0;
  const summaryScopes = [];
  let topLevelDetails = 0;
  let mainText = '';
  let topSummaryText = '';
  let summaryText = '';
  let hiddenText = '';
  let position = 0;
  let match;
  while ((match = tagRe.exec(cleaned)) !== null) {
    const chunk = cleaned.slice(position, match.index);
    position = tagRe.lastIndex;
    if (chunk) {
      const text = decodeEntities(chunk);
      if (detailsDepth === 0) mainText += text;
      else if (summaryDepth > 0) {
        summaryText += text;
        if (summaryScopes[summaryScopes.length - 1] === 1) topSummaryText += text;
      } else hiddenText += text;
    }
    const closing = match[1] === '/';
    const name = match[2].toLowerCase();
    const attrs = match[3] || '';
    if (!closing && (/\/\s*$/.test(attrs) || VOID_TAGS.has(name))) continue;
    if (closing) {
      if (name === 'details') detailsDepth = Math.max(0, detailsDepth - 1);
      if (name === 'summary') {
        summaryDepth = Math.max(0, summaryDepth - 1);
        summaryScopes.pop();
      }
      continue;
    }
    if (name === 'details') {
      if (detailsDepth === 0) topLevelDetails += 1;
      detailsDepth += 1;
    }
    if (name === 'summary') {
      summaryDepth += 1;
      summaryScopes.push(detailsDepth);
    }
  }
  const tail = decodeEntities(cleaned.slice(position));
  if (detailsDepth === 0) mainText += tail;
  else hiddenText += tail;
  return { topLevelDetails, mainText, topSummaryText, summaryText, hiddenText };
}

function detailsOfKind(source, kind) {
  const re = new RegExp('<details class="blk blk-' + kind +
    '" data-kind="' + kind + '">([\\s\\S]*?)<\\/details>', 'g');
  const out = [];
  let match;
  while ((match = re.exec(source)) !== null) out.push(match[1]);
  return out;
}

function glueSummaries(source, kind) {
  const re = new RegExp('<details class="glue ' + kind + '"[^>]*><summary>([\\s\\S]*?)<\\/summary>', 'g');
  const out = [];
  let match;
  while ((match = re.exec(source)) !== null) out.push(textOf(match[1]).trim());
  return out;
}

function splitTurns(source) {
  return source.split('<section class="turn" data-turn=').slice(1);
}

function readVars(block) {
  const map = Object.create(null);
  for (const pair of String(block).split(';')) {
    const index = pair.indexOf(':');
    if (index === -1) continue;
    map[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
  }
  return map;
}

// Pulls one rule out of a stylesheet by its exact selector (rules sit on their own line).
function cssRule(source, selector) {
  const at = String(source).indexOf('\n' + selector + '{');
  if (at === -1) return '';
  const open = source.indexOf('{', at);
  const close = source.indexOf('}', open);
  return source.slice(open + 1, close);
}

function cssNumber(declarations, property) {
  const at = String(declarations).indexOf(property + ':');
  if (at === -1) return NaN;
  const matched = /^[\d.]+/.exec(declarations.slice(at + property.length + 1).trim());
  return matched ? Number(matched[0]) : NaN;
}

function luminance(hex) {
  const matched = /^#([0-9a-fA-F]{6})$/.exec(String(hex).trim());
  assert(matched, 'palette colour is not a 6-digit hex literal: ' + hex);
  const value = parseInt(matched[1], 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
const rawJsonl = readFileSync(fixturePath, 'utf8');
const lines = rawJsonl.split(/\r?\n/).filter((line) => line.length > 0);
const events = lines.map((line, index) => {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error('fixture line ' + (index + 1) + ' is not valid JSON: ' + error.message);
  }
});
const sessionEvent = events.find((event) => event.type === 'session');

const NOW = new Date(1792783483113);
// Checks (a)-(v) describe the full-export document: the previous behaviour, still
// reachable with reasoning:'full'. The default (omit) and count documents are covered by
// the dedicated checks (w)-(ab) below, so no legacy assertion has to be weakened.
const rendered = renderSessionHtml({
  session: sessionEvent,
  events: rawJsonl,
  options: { redact: true, now: NOW, theme: 'auto', reasoning: 'full' },
});
const html = rendered.html;
const stats = rendered.stats;

mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, html, 'utf8');
const fileSize = statSync(outPath).size;

console.log('');
console.log('DSH session share - render/redact acceptance tests  (render v' + VERSION + ')');
console.log('fixture: ' + lines.length + ' events, ' + rawJsonl.length + ' chars');
console.log('output : ' + outPath);

check('(a) first user message (escaped form) is present in output', () => {
  const firstUser = events.find((event) => event.type === 'user/message');
  const text = firstUser.data.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
  const expected = escapeIndependent(text);
  assert(expected.length > 10, 'fixture first user message seems empty');
  assert(html.includes(expected), 'escaped first user text not found');
  assert(html.includes('data-role="user"'), 'no user message container emitted');
});

check('(b) no real user-path literals leak into output', () => {
  const cwd = String(sessionEvent.cwd);
  const userMatch = cwd.match(/Users[\\/]+([^\\/]+)/);
  assert(userMatch, 'could not derive real username from fixture cwd');
  const user = userMatch[1];
  const needles = [
    'C:\\Users\\' + user,
    'C:/Users/' + user,
    '/Users/' + user,
    '\\Users\\' + user,
    '/home/' + user,
    '/c/Users/' + user,
  ];
  for (const needle of needles) {
    assert(!html.includes(needle), 'leaked path literal: ' + needle);
  }
  assert(html.includes('%USERPROFILE%'), 'expected %USERPROFILE% placeholder in output');
});

check('(c) no external resource references and no http(s) scheme', () => {
  assert(!/<script[^>]*\ssrc=/i.test(html), 'found script src');
  assert(!/<link\b/i.test(html), 'found link tag');
  assert(!/<img\b/i.test(html), 'found img tag');
  assert(!/<iframe\b/i.test(html), 'found iframe');
  assert(!/@import/i.test(html), 'found CSS import');
  const lowered = html.toLowerCase();
  assert(!lowered.includes('http://'), 'output still contains http scheme');
  assert(!lowered.includes('https://'), 'output still contains https scheme');
});

check('(d) tool collapse blocks == tool/call events', () => {
  const toolBlocks = (html.match(/data-kind="tool"/g) || []).length;
  const callEvents = events.filter((event) => event.type === 'tool/call');
  const resultEvents = events.filter((event) => event.type === 'tool/result');
  const callIds = new Set(callEvents.map((event) => event.data.callId));
  const resultIds = new Set(resultEvents.map((event) => event.data.message && event.data.message.toolCallId));
  const orphanResults = [...resultIds].filter((id) => !callIds.has(id));
  const callsWithoutResult = [...callIds].filter((id) => !resultIds.has(id));
  console.log('        pairing: calls=' + callIds.size + ' results=' + resultIds.size +
    ' orphan_results=' + orphanResults.length + ' calls_without_result=' + callsWithoutResult.length +
    ' (reported separately, not fatal)');
  assert(toolBlocks === callEvents.length,
    'tool blocks ' + toolBlocks + ' != tool/call events ' + callEvents.length);
  assert(stats.toolCalls === callEvents.length, 'stats.toolCalls mismatch');
});

check('(e) document skeleton and div/section balance', () => {
  assert(html.startsWith('<!DOCTYPE html>'), 'missing doctype');
  assert(html.includes('<html'), 'missing html root');
  assert(html.includes('<style'), 'missing style block');
  assert(html.includes('</style>'), 'missing style close');
  assert(html.includes('<script'), 'missing inline script');
  assert(html.includes('</html>'), 'missing html close');
  assertBalanced(html, ['div', 'section']);
  assertBalanced(html, ['main', 'header', 'footer', 'details', 'summary', 'pre', 'ul', 'ol', 'li', 'p']);
});

check('(f) hostile / synthetic events never throw', () => {
  const big = 'X'.repeat(150 * 1024);
  const synthetic = [
    { type: 'session', id: 'syn-1', cwd: 'C:\\Users\\alice\\proj', createdAt: 1 },
    { type: 'assistant/message', seq: 1, time: 1, data: { message: { content: [{ type: 'reasoning', text: '先想一想。' }] } } },
    { type: 'tool/call', seq: 2, time: 2, data: { callId: 'c1', name: 'big_tool', arguments: '{"a":1}' } },
    { type: 'tool/result', seq: 3, time: 3, data: { message: { toolCallId: 'c1', content: [{ type: 'text', text: big }] } } },
    { type: 'totally/unknown-event', seq: 4, data: { foo: 1 } },
    { type: 'weird/no-data-at-all', seq: 5 },
    { type: 'assistant/message', seq: 6, data: {} },
    { type: 'user/message', seq: 7, data: { content: [{ type: 'image', data: 'blob' }] } },
    { type: 'assistant/message', seq: 8, data: { message: { content: [{ type: 'brand-new-block', text: 'x' }] } } },
    { type: 'tool/call', seq: 9, data: { name: 'no_call_id', arguments: { nested: true } } },
    { type: 'tool/result', seq: 10, data: { message: { content: 'plain string content' } } },
    null,
    'not-an-object',
  ];
  const syntheticResult = renderSessionHtml({ events: synthetic, options: { now: 0, reasoning: 'full' } });
  assert(typeof syntheticResult === 'object' && typeof syntheticResult.html === 'string', 'no result object');
  assert(syntheticResult.html.includes('内部事件'), 'unknown events not folded into internal section');
  assert(syntheticResult.html.includes('结果已截断'), 'oversized tool result not marked truncated');
  assert(syntheticResult.html.includes('思考过程'), 'reasoning block not collapsed');
  assert(syntheticResult.html.includes('未配对'), 'unpaired tool/result not reported');
  assert(syntheticResult.stats.toolCalls === 2, 'expected 2 tool calls, got ' + syntheticResult.stats.toolCalls);
  assert(syntheticResult.stats.badLines === 2, 'expected 2 bad entries, got ' + syntheticResult.stats.badLines);

  const brokenJsonl = [
    JSON.stringify({ type: 'user/message', data: { content: [{ type: 'text', text: 'still renders' }] } }),
    '{ this line is not json at all',
    '',
    JSON.stringify({ type: 'unknown/kaboom', data: {} }),
  ].join('\n');
  const broken = renderSessionHtml({ events: brokenJsonl, options: { now: 0 } });
  assert(broken.stats.badLines === 1, 'expected badLines=1, got ' + broken.stats.badLines);
  assert(broken.html.includes('still renders'), 'valid line after a broken line was dropped');

  const nothing = renderSessionHtml({});
  assert(nothing.html.includes('</html>'), 'empty input did not produce a document');
  const deep = renderSessionHtml({ events: [], options: { redact: false } });
  assert(deep.stats.redacted === 0, 'redact:false must not redact');
});

check('(g) redaction is idempotent, hits secrets, spares prose', () => {
  const redactor = createRedactor();
  const sample = [
    'C:\\Users\\alice\\Documents\\secret.txt',
    'C:/Users/alice/x',
    '/c/Users/alice/y',
    '/Users/alice/z',
    '/home/alice/w',
    'sk-' + 'a'.repeat(24),
    'Authorization: Bearer ' + 'b'.repeat(20),
    'ghp_' + 'c'.repeat(24),
    'github_pat_' + 'd'.repeat(24),
    'AKIAIOSFODNN7EXAMPLE',
    'xoxb-1234567890-abcdefghij',
    '{"password": "hunter2secret"}',
  ].join('\n');
  const once = redactor.text(sample);
  const twice = redactor.text(once);
  assert(once === twice, 'redaction is not idempotent');
  assert(redactor.redactedCount > 0, 'redactedCount did not increase');
  assert(!once.includes('alice'), 'username survived redaction');
  assert(once.includes('%USERPROFILE%') && once.includes('~'), 'expected path placeholders');

  const cases = [
    ['C:\\Users\\alice\\proj', '%USERPROFILE%'],
    ['C:/Users/alice/proj', '%USERPROFILE%'],
    ['/c/Users/alice/proj', '%USERPROFILE%'],
    ['/Users/alice/proj', '~'],
    ['/home/alice/proj', '~'],
    ['sk-' + 'a'.repeat(24), '[REDACTED:sk]'],
    ['Bearer ' + 'b'.repeat(20), 'Bearer [REDACTED:bearer]'],
    ['ghp_' + 'c'.repeat(24), '[REDACTED:github]'],
    ['github_pat_' + 'd'.repeat(24), '[REDACTED:github]'],
    ['AKIAIOSFODNN7EXAMPLE', '[REDACTED:aws]'],
    ['xoxb-1234567890-abcdefghij', '[REDACTED:slack]'],
    ['{"password": "hunter2secret"}', '[REDACTED]'],
  ];
  for (const pair of cases) {
    const single = createRedactor();
    const output = single.text(pair[0]);
    assert(output.includes(pair[1]), 'missing placeholder ' + pair[1] + ' for ' + pair[0] + ' -> ' + output);
    assert(single.redactedCount > 0, 'no hit counted for ' + pair[0]);
  }

  const benign = '这是正常的中文说明，提到 /Users/ 与 password 单词，以及 C:/path/to 这样的目录。';
  const spare = createRedactor();
  assert(spare.text(benign) === benign, 'prose was damaged: ' + spare.text(benign));

  const mdSource = FENCE + 'bash\ncurl https://api.example.com/v1 -H "Authorization: Bearer ' + 'b'.repeat(20) + '"\n' + FENCE;
  const md = renderSessionHtml({
    events: [{ type: 'user/message', data: { content: [{ type: 'text', text: mdSource }] } }],
    options: { now: 0 },
  });
  assert(md.html.includes('<pre class="code"><code>'), 'fenced code block not rendered as pre');
  assert(md.html.includes('<div class="clang">bash</div>'), 'language label missing');
  assert(md.html.includes('Bearer [REDACTED:bearer]'), 'secret inside code block not redacted');
  assert(md.html.indexOf('https://') === -1, 'code block leaked a raw scheme');
  assert(md.html.includes('https&#58;//api.example.com/v1'), 'URL scheme not inerted inside code block');
  assert(DEFAULT_RULES.length >= 10, 'expected at least 10 default rules');

  assert(stats.redacted > 0, 'real render reported zero redactions');
  assert(html.includes('已脱敏 ' + stats.redacted + ' 处'), 'header does not show the redaction count');
});

check('(h) stats and shape consistency', () => {
  assert(stats.bytes === Buffer.byteLength(html, 'utf8'), 'stats.bytes != utf8 length');
  assert(stats.userMessages === events.filter((event) => event.type === 'user/message').length, 'userMessages mismatch');
  assert(stats.assistantMessages === events.filter((event) => event.type === 'assistant/message').length, 'assistantMessages mismatch');
  assert(stats.badLines === 0, 'real fixture should parse cleanly, got badLines=' + stats.badLines);
  assert(stats.collapsedBlocks >= stats.toolCalls, 'collapsedBlocks should cover tool blocks');
  assert(html.includes('分享自 DSH'), 'missing share badge');
  assert(/@media \(max-width:640px\)/.test(html), 'missing narrow viewport rule');
  assert(/@media \(prefers-color-scheme: dark\)/.test(html), 'missing auto dark theme');
  assert(/@media print/.test(html), 'missing print rules');
  assert(html.includes('id="theme-toggle"'), 'missing theme toggle');
  assert(/try\s*\{[^}]*localStorage/.test(html), 'localStorage access not guarded by try/catch');
  const scriptBody = html.slice(html.indexOf('<script>'));
  assert(scriptBody.split('</script>').length === 2, 'expected exactly one script tag');
  assert(scriptBody.indexOf(BT) === -1, 'inline script must not use template literals');
  assert(scriptBody.indexOf('await') === -1, 'inline script must not use await');
  assert(scriptBody.indexOf('=>') === -1, 'inline script must stay ES5/ES2017 friendly');
});

const realUsername = (function () {
  const matched = String(sessionEvent.cwd).match(/Users[\\/]+([^\\/]+)/);
  return matched ? matched[1] : '';
})();

check('(i) output contains zero occurrences of the machine username', () => {
  assert(realUsername.length >= 2, 'could not derive the machine username from the fixture cwd');
  const occurrences = html.split(realUsername).length - 1;
  console.log('        derived username "' + realUsername + '" -> occurrences in output: ' + occurrences);
  assert(occurrences === 0, 'username still appears ' + occurrences + ' time(s) in the output');
});

check('(j) no flattened -Users-<name> directory name survives', () => {
  const flattened = [
    new RegExp('-Users-' + realUsername, 'i'),
    new RegExp('-users-' + realUsername, 'i'),
    new RegExp('-home-' + realUsername, 'i'),
    new RegExp('C-Users-' + realUsername, 'i'),
  ];
  for (const re of flattened) assert(!re.test(html), 'flattened form still matches ' + re);
  assert(html.includes('-Users-%USERNAME%'), 'expected a readable -Users-%USERNAME% placeholder');
  assert(html.indexOf('***') === -1, 'placeholder must stay readable instead of being masked');
});

check('(k) identity redaction is idempotent and raised the hit count', () => {
  const second = createRedactor({ usernames: [realUsername] });
  assert(second.text(html) === html, 'a second redaction pass over the document changed it');
  assert(stats.redacted > 54, 'hit count did not rise above the pre-fix baseline of 54: ' + stats.redacted);
  assert(html.includes('已脱敏 ' + stats.redacted + ' 处'), 'header count out of sync with the body');
});

check('(l) the same rules work for any machine name', () => {
  const synthetic = renderSessionHtml({
    session: { cwd: 'C:\\Users\\alice\\proj' },
    events: [
      { type: 'user/message', data: { content: [{ type: 'text', text: 'D --C-Users-alice-proj-- and C:\\Users\\alice\\x' }] } },
      { type: 'tool/call', data: { callId: 'k1', name: 'ls', arguments: '{"p":"C:\\\\Users\\\\alice\\\\y"}' } },
      { type: 'tool/result', data: { message: { toolCallId: 'k1', content: [{ type: 'text', text: 'sessions/--C-Users-alice-Documents--' }] } } },
    ],
    options: { now: 0 },
  });
  const occurrences = synthetic.html.split('alice').length - 1;
  assert(occurrences === 0, 'derived name leaked ' + occurrences + ' time(s)');
  assert(synthetic.html.includes('-Users-%USERNAME%'), 'missing flattened placeholder for the derived name');
  assert(synthetic.html.includes('%USERPROFILE%'), 'missing profile placeholder for the derived name');
  assert(synthetic.stats.redacted >= 4, 'expected several identity hits, got ' + synthetic.stats.redacted);
  const withoutCwd = renderSessionHtml({
    events: [{ type: 'user/message', data: { content: [{ type: 'text', text: 'no identity here' }] } }],
    options: { now: 0 },
  });
  assert(withoutCwd.html.includes('no identity here'), 'render broke when no cwd was available');
  assert(createRedactor().patterns.length === DEFAULT_RULES.length, 'no-identity redactor must keep the base rule count');
});

// ---------------------------------------------------------------------------
// Information hierarchy: the conversation is the document, thinking/tool traffic is a
// faint trace. These checks read the rendered document the way a reader sees it.
// ---------------------------------------------------------------------------

const layout = analyzeLayout(html);
const turnSections = splitTurns(html);
const turnEventCount = events.filter((event) => event.type === 'turn/start' && event.data && event.data.turn != null).length;
const mainChars = charCount(layout.mainText);
const topSummaryChars = charCount(layout.topSummaryText);
const summaryChars = charCount(layout.summaryText);
const hiddenChars = charCount(layout.hiddenText);
// The default state of the page: every details closed, so only the summaries of
// top-level details are on screen next to the conversation.
const visibleRatio = mainChars / (mainChars + topSummaryChars);
const expandedRatio = mainChars / (mainChars + summaryChars + hiddenChars);

const internalCards = (html.match(/data-kind="internal"/g) || []).length;
const inTurnDetails = layout.topLevelDetails - internalCards;

check('(m) hierarchy: at most 3 trace rows per turn, none of them a bubble', () => {
  console.log('        turns rendered=' + turnSections.length + '  turn/start events=' + turnEventCount +
    '  top-level details=' + layout.topLevelDetails + ' (' + inTurnDetails + ' inside turns + ' +
    internalCards + ' internal)  (pre-refactor baseline: 165 details, 91 think rows)');
  for (let i = 0; i < turnSections.length; i += 1) {
    const part = turnSections[i];
    const users = (part.match(/data-role="user"/g) || []).length;
    const assistants = (part.match(/data-role="assistant"/g) || []).length;
    const ctx = glueSummaries(part, 'glue-ctx');
    const think = glueSummaries(part, 'glue-think');
    const tool = glueSummaries(part, 'glue-tool');
    console.log('        turn ' + (i + 1) + ': bubbles user=' + users + ' assistant=' + assistants +
      '  trace rows=' + (ctx.length + think.length + tool.length) + '  ' + JSON.stringify(ctx.concat(think, tool)));
    assert(ctx.length <= 1, 'turn ' + (i + 1) + ' has ' + ctx.length + ' context cards, expected <= 1');
    assert(ctx.length + think.length + tool.length <= 3,
      'turn ' + (i + 1) + ' has more than 3 trace rows');
  }
  assert(turnSections.length === turnEventCount,
    'rendered turns ' + turnSections.length + ' != turn/start events ' + turnEventCount);
  assert(turnEventCount > 0, 'fixture has no turns');
  assert(inTurnDetails <= turnEventCount * 3,
    'in-turn top-level details ' + inTurnDetails + ' > turns*3 = ' + (turnEventCount * 3));
  assert(stats.topLevelBlocks === layout.topLevelDetails, 'stats.topLevelBlocks != measured top-level details');
  assert(stats.turns === turnSections.length, 'stats.turns != rendered turns');
});

check('(n) conversation is the主体: visible chars outside details >= 0.60', () => {
  console.log('        chars: conversation(outside details)=' + mainChars +
    '  top-level trace rows=' + topSummaryChars +
    '  (nested summaries=' + summaryChars + ', collapsed bodies=' + hiddenChars + ')');
  console.log('        ratio (default collapsed view) = ' + visibleRatio.toFixed(4) +
    '   [everything expanded = ' + expandedRatio.toFixed(4) + ', informational only]');
  assert(visibleRatio >= 0.6, 'conversation share of the visible page ' + visibleRatio.toFixed(4) + ' < 0.60');
});

check('(o) every trace row is a single short line (<= 40 chars)', () => {
  const think = glueSummaries(html, 'glue-think');
  const tool = glueSummaries(html, 'glue-tool');
  const ctx = glueSummaries(html, 'glue-ctx');
  const lengths = think.concat(tool, ctx).map((text) => text.length);
  console.log('        think rows=' + JSON.stringify(think));
  console.log('        tool  rows=' + JSON.stringify(tool));
  console.log('        ctx   rows=' + JSON.stringify(ctx));
  console.log('        max summary length=' + Math.max.apply(null, lengths) + ' chars');
  assert(think.length > 0 && tool.length > 0, 'expected both trace rows to exist');
  assert(ctx.length > 0, 'expected an inline-context row on the fixture');
  for (const text of think.concat(tool, ctx)) {
    assert(text.length <= 40, 'trace summary too long (' + text.length + '): ' + text);
  }
  assert(ctx.length <= turnEventCount, 'context rows ' + ctx.length + ' exceed one per turn');
  assert(/^内联上下文/.test(ctx[0]) && /条/.test(ctx[0]), 'context row lost its shape: ' + ctx[0]);
  assert(think.length <= turnEventCount, 'think rows ' + think.length + ' exceed one per turn');
  assert(tool.length <= turnEventCount, 'tool rows ' + tool.length + ' exceed one per turn');
  assert(/^思考过程/.test(think[0]) && /段/.test(think[0]), 'think row lost its shape: ' + think[0]);
  assert(/^工具调用/.test(tool[0]) && /次/.test(tool[0]), 'tool row lost its shape: ' + tool[0]);
});

check('(p) assistant prose precedes the trace and outranks it typographically', () => {
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const bodyRule = cssRule(css, 'body');
  const glueRule = cssRule(css, 'details.glue>summary');
  const mainSize = cssNumber(bodyRule, 'font-size');
  const glueSize = cssNumber(glueRule, 'font-size');
  const glueLineHeight = cssNumber(glueRule, 'line-height');
  console.log('        main text ' + mainSize + 'px / trace row ' + glueSize + 'px -> ' +
    (glueSize / mainSize).toFixed(3) + 'x, trace line-height ' + glueLineHeight);
  assert(isFinite(mainSize) && isFinite(glueSize), 'could not read font sizes from the stylesheet');
  assert(glueSize / mainSize <= 0.8, 'trace font ' + glueSize + 'px is not <= 0.8 of main ' + mainSize + 'px');
  assert(isFinite(glueLineHeight) && glueLineHeight <= 1.5, 'trace line-height ' + glueLineHeight + ' is not compact');
  assert(/border:0/.test(cssRule(css, 'details.glue')), 'trace block should carry no card border');
  assert(/border-top:1px dashed var\(--line\)/.test(glueRule), 'trace row border must use the --line variable');

  let checked = 0;
  for (let i = 0; i < turnSections.length; i += 1) {
    const part = turnSections[i];
    const glueIndex = part.indexOf('class="glue');
    const proseIndex = part.indexOf('class="msg ');
    assert(proseIndex !== -1, 'turn ' + (i + 1) + ' has no conversation card');
    if (glueIndex === -1) continue;
    assert(proseIndex < glueIndex, 'turn ' + (i + 1) + ': trace row appears before the conversation');
    checked += 1;
  }
  const assistantCards = turnSections.filter((part) => part.indexOf('data-role="assistant"') !== -1).length;
  console.log('        DOM order verified in ' + checked + ' turns with trace; assistant cards present in ' + assistantCards);
  assert(checked > 0, 'no turn carried both prose and trace, check is vacuous');
  assert(assistantCards > 0, 'assistant prose vanished from the timeline');
});

check('(q) collapsing is lossless: reasoning text and every tool entry survive', () => {
  const originalSegments = [];
  for (const event of events) {
    if (event.type !== 'assistant/message') continue;
    const content = (event.data && event.data.message && event.data.message.content) || [];
    for (const block of content) {
      if (block.type === 'reasoning' || block.type === 'thinking') originalSegments.push(String(block.text || ''));
    }
  }
  const renderedSegments = detailsOfKind(html, 'think');
  const originalChars = charCount(originalSegments.join(''));
  const renderedChars = charCount(renderedSegments.map((part) => textOf(part)).join(''));
  const delta = (renderedChars - originalChars) / originalChars;
  console.log('        reasoning segments: fixture=' + originalSegments.length + ' rendered=' + renderedSegments.length);
  console.log('        reasoning chars (whitespace excluded): fixture=' + originalChars +
    ' rendered=' + renderedChars + ' delta=' + (delta * 100).toFixed(2) + '%');
  assert(renderedSegments.length === originalSegments.length,
    'reasoning segments ' + renderedSegments.length + ' != fixture ' + originalSegments.length);
  assert(Math.abs(delta) <= 0.05, 'reasoning text changed by ' + (delta * 100).toFixed(2) + '% (>5%)');

  const callEvents = events.filter((event) => event.type === 'tool/call');
  const resultEvents = events.filter((event) => event.type === 'tool/result');
  const callIds = new Set(callEvents.map((event) => event.data.callId));
  const pairedIds = new Set(resultEvents
    .map((event) => event.data.message && event.data.message.toolCallId)
    .filter((id) => id && callIds.has(id)));
  const renderedCalls = detailsOfKind(html, 'tool').length;
  const renderedArgs = (html.match(/<div class="lbl">参数<\/div>/g) || []).length;
  const renderedResults = (html.match(/<div class="lbl">结果<\/div>/g) || []).length;
  console.log('        tool entries: fixture calls=' + callEvents.length + ' results=' + resultEvents.length +
    ' paired=' + pairedIds.size + '  rendered calls=' + renderedCalls + ' args=' + renderedArgs + ' results=' + renderedResults);
  assert(renderedCalls === callEvents.length, 'rendered tool entries ' + renderedCalls + ' != calls ' + callEvents.length);
  assert(renderedResults === pairedIds.size, 'rendered results ' + renderedResults + ' != paired results ' + pairedIds.size);
  assert(renderedArgs === callEvents.length, 'rendered argument blocks ' + renderedArgs + ' != calls ' + callEvents.length);

  const big = 'Y'.repeat(30000);
  const limits = renderSessionHtml({
    events: [
      { type: 'tool/call', data: { callId: 'z1', name: 'big', arguments: JSON.stringify({ blob: 'Z'.repeat(9000) }) } },
      { type: 'tool/result', data: { message: { toolCallId: 'z1', content: [{ type: 'text', text: big }] } } },
    ],
    options: { now: 0 },
  });
  assert(limits.html.includes('结果已截断：仅显示前 12000 字符'), 'result truncation limit (12000) lost');
  assert(limits.html.includes('参数已截断'), 'argument truncation limit (4000) lost');
  assert(limits.html.includes('工具调用'), 'tool trace row missing on the synthetic case');
});

check('(r) trace colours come from CSS variables and stay readable in both themes', () => {
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const glueRule = cssRule(css, 'details.glue>summary');
  console.log('        trace row colour declaration: ' + (/color:[^;]+/.exec(glueRule) || ['(none)'])[0]);
  assert(/color:var\(--muted\)/.test(glueRule), 'trace colour is not var(--muted): ' + glueRule);
  assert(!/#[0-9a-fA-F]{3,8}/.test(glueRule), 'trace rule hard-codes a hex colour: ' + glueRule);
  assert(!/rgba?\(/.test(glueRule), 'trace rule hard-codes an rgb() colour: ' + glueRule);
  assert(!/color:#/.test(html.slice(html.indexOf('<style>'), html.indexOf('</style>')).split('details.glue>summary')[1].slice(0, 400)),
    'a literal colour still follows the trace rule');

  const palettes = [
    ['light', readVars(cssRule(css, ':root'))],
    ['dark', readVars(cssRule(css, ':root[data-theme="dark"]'))],
  ];
  for (const pair of palettes) {
    const name = pair[0];
    const vars = pair[1];
    assert(vars['--muted'], name + ' palette has no --muted');
    assert(vars['--bg'], name + ' palette has no --bg');
    const ratio = contrastRatio(vars['--muted'], vars['--bg']);
    console.log('        ' + name + ' theme: --muted ' + vars['--muted'] + ' on --bg ' + vars['--bg'] +
      ' -> contrast ' + ratio.toFixed(2) + ':1');
    assert(ratio >= 3.0, name + ' theme trace contrast ' + ratio.toFixed(2) + ' is unreadable');
  }

  const printRule = css.slice(css.indexOf('@media print'));
  assert(/details,details>\*\{display:block !important\}/.test(printRule), 'print no longer expands every details');
  assert(html.includes('beforeprint'), 'print expansion hook for the interactive page missing');
});

check('(s) output stays one self-contained file ending in </html>', () => {
  assert(/<\/html>\s*$/.test(html), 'document does not end with </html>');
  assert((html.match(/<style/g) || []).length === 1, 'expected exactly one style block');
  assert((html.match(/<script/g) || []).length === 1, 'expected exactly one inline script');
  assert(!/\b(src|href)=/i.test(html), 'found an external src/href reference');
  const styleBlock = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  assert(!/url\(/i.test(styleBlock), 'found a css url() reference');
  assert(!/@import/i.test(styleBlock), 'found a css @import');
  assert(!/<link\b/i.test(html) && !/<img\b/i.test(html) && !/<iframe\b/i.test(html), 'found an external resource tag');
  assert(!/http:\/\/|https:\/\//i.test(html), 'found an http(s) scheme');
  assert(stats.bytes === Buffer.byteLength(html, 'utf8'), 'stats.bytes != utf8 length');
  console.log('        bytes=' + stats.bytes + '  style blocks=1  script blocks=1  external refs=0');
});

// ---------------------------------------------------------------------------
// Inline context: DSH puts runtime snapshots, catalogs and subagent relays into the same
// user role. They are not something the user said, so they must not look like a bubble.
// ---------------------------------------------------------------------------

const fixtureInjected = [];
const fixtureSpeech = [];
const kindDistribution = new Map();
for (const event of events) {
  if (event.type !== 'user/message') continue;
  const kind = event.data && event.data.source && event.data.source.kind ? String(event.data.source.kind) : '(no source.kind)';
  kindDistribution.set(kind, (kindDistribution.get(kind) || 0) + 1);
  const text = (event.data.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => String(block.text || ''))
    .join('\n');
  if (!text.trim()) continue;
  if (kind === 'user' || kind === '(no source.kind)') fixtureSpeech.push(text);
  else fixtureInjected.push(text);
}

check('(t) injected context is demoted to one grey row per turn, real speech keeps its bubble', () => {
  console.log('        fixture source.kind distribution: ' + JSON.stringify([...kindDistribution]));
  console.log('        fixture: real speech=' + fixtureSpeech.length + ' messages/' +
    charCount(fixtureSpeech.join('')) + ' chars, injected=' + fixtureInjected.length + ' messages/' +
    charCount(fixtureInjected.join('')) + ' chars');
  assert(fixtureInjected.length > 0 && fixtureSpeech.length > 0, 'fixture no longer exercises both branches');

  assert(stats.contextMessages === fixtureInjected.length,
    'stats.contextMessages ' + stats.contextMessages + ' != fixture injected ' + fixtureInjected.length);
  assert(stats.userSpeech === fixtureSpeech.length,
    'stats.userSpeech ' + stats.userSpeech + ' != fixture speech ' + fixtureSpeech.length);
  assert(stats.userMessages === stats.userSpeech + stats.contextMessages, 'stats counts do not add up');

  const bubbles = (html.match(/data-role="user"/g) || []).length;
  const ctxItems = (html.match(/data-kind="ctx"/g) || []).length;
  console.log('        rendered: user bubbles=' + bubbles + '  context entries=' + ctxItems +
    '  context rows=' + glueSummaries(html, 'glue-ctx').length);
  assert(bubbles === fixtureSpeech.length, 'user bubbles ' + bubbles + ' != real user messages ' + fixtureSpeech.length);
  assert(ctxItems === fixtureInjected.length, 'context entries ' + ctxItems + ' != injected messages ' + fixtureInjected.length);

  const mainText = analyzeLayout(html).mainText;
  for (const text of fixtureInjected) {
    const head = text.replace(/\s+/g, ' ').trim().slice(0, 40);
    assert(head.length > 10, 'injected fixture text too short to check');
    assert(!mainText.includes(head), 'injected context still sits in the conversation area: ' + head);
  }
  for (const text of fixtureSpeech) {
    const head = text.replace(/\s+/g, ' ').trim().slice(0, 30);
    assert(mainText.includes(head), 'real user speech is missing from the conversation area: ' + head);
  }

  // Structure wins over the marker list, and the marker list still fires when a stream
  // carries no source at all.
  const precedence = renderSessionHtml({
    events: [
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '<system-reminder> but this one really is me' }] } },
      { type: 'user/message', data: { content: [{ type: 'text', text: '<system-reminder> no source at all' }] } },
      { type: 'user/message', data: { source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'plain words, injected kind' }] } },
    ],
    options: { now: 0 },
  });
  assert((precedence.html.match(/data-role="user"/g) || []).length === 1,
    'source.kind=user must win over the marker list');
  assert(precedence.stats.contextMessages === 2, 'expected 2 context messages, got ' + precedence.stats.contextMessages);
  assert((precedence.html.match(/data-kind="ctx"/g) || []).length === 2, 'context entries missing on the marker fallback path');
  assert(precedence.html.includes('标记 &lt;system-reminder&gt;'), 'marker fallback did not report its reason');
});

check('(u) injected context stays complete after expanding (>= 99% of the original text)', () => {
  // The same redaction the page applies, so the comparison is about lost text only.
  const expectedRedactor = createRedactor({ usernames: [realUsername] });
  const expected = charCount(fixtureInjected.map((text) => expectedRedactor.text(text)).join(''));
  const rawOriginal = charCount(fixtureInjected.join(''));
  const bodies = detailsOfKind(html, 'ctx').map((part) => part.replace(/^<summary>[\s\S]*?<\/summary>/, ''));
  const rendered = bodies.map((part) => charCount(textOf(part))).reduce((a, b) => a + b, 0);
  const kept = rendered / expected;
  console.log('        context body chars: fixture=' + rawOriginal + ' (after redaction=' + expected + ') rendered=' +
    rendered + ' kept=' + (kept * 100).toFixed(2) + '%');
  assert(detailsOfKind(html, 'ctx').length === fixtureInjected.length, 'context entry count drifted');
  assert(kept >= 0.99, 'expanded context lost text: kept ' + (kept * 100).toFixed(2) + '%');

  const sample = renderSessionHtml({
    events: [{ type: 'user/message', data: { source: { kind: 'agent-message' }, content: [{ type: 'text', text: '【任务】保留这一段完整原文\n- 第一项\n- 第二项' }] } }],
    options: { now: 0 },
  });
  assert(sample.html.includes('【任务】保留这一段完整原文'), 'context body was dropped');
  assert(sample.html.includes('第一项') && sample.html.includes('第二项'), 'context list items were dropped');
});

check('(v) identifier-embedded username is redacted; pure digit runs are untouched', () => {
  assert(realUsername.length >= 2, 'need a derived username');
  const name = realUsername;
  const redactor = createRedactor({ usernames: [name] });
  const digitRun = '17927' + name + '5954';
  const cases = [
    ['username_' + name, 'username_%USERNAME%'],
    ['-' + name + '-', '-%USERNAME%-'],
    [name + '_x', '%USERNAME%_x'],
    ['id-' + name + '-suffix', 'id-%USERNAME%-suffix'],
    ['a' + name + 'b', 'a%USERNAME%b'],
  ];
  for (const pair of cases) {
    const output = redactor.text(pair[0]);
    console.log('        ' + JSON.stringify(pair[0]) + ' -> ' + JSON.stringify(output));
    assert(output === pair[1], 'expected ' + pair[1] + ' for ' + pair[0] + ' -> ' + output);
    assert(!output.includes(name), 'name survived in ' + pair[0]);
  }
  for (const input of [digitRun, 'ts=' + digitRun, 'id ' + digitRun + ' end']) {
    const output = redactor.text(input);
    assert(output === input, 'a digit run containing the name was damaged: ' + input + ' -> ' + output);
  }
  console.log('        digit run kept intact: ' + digitRun);

  const joined = cases.map((pair) => pair[0]).join(' ');
  const once = createRedactor({ usernames: [name] }).text(joined);
  const twice = createRedactor({ usernames: [name] }).text(once);
  assert(once === twice, 'identifier redaction is not idempotent');

  const page = renderSessionHtml({
    session: { cwd: 'C:\\Users\\' + name + '\\proj' },
    events: [{ type: 'user/message', data: { content: [{ type: 'text', text: 'env username_' + name + ' and ' + digitRun }] } }],
    options: { now: 0 },
  });
  assert(page.html.includes('username_%USERNAME%'), 'the rendered page still shows username_' + name);
  assert(page.html.includes(digitRun), 'the rendered page damaged the digit run ' + digitRun);
  assert(!page.html.includes('username_' + name), 'identifier form leaked into the page');
});

// ---------------------------------------------------------------------------
// Requirement 3: reasoning is not part of the conversation. omit (default) ships none of
// its bytes, count ships one faint non-interactive line per turn, full reproduces the
// document above. Substring sampling is the evidence: the fixture text is cut into
// fixed windows and every window must be absent from an omitted document.
// ---------------------------------------------------------------------------

const reasoningFixture = [];
for (const event of events) {
  if (event.type !== 'assistant/message') continue;
  const content = (event.data && event.data.message && event.data.message.content) || [];
  for (const block of content) {
    if (block.type === 'reasoning' || block.type === 'thinking') reasoningFixture.push(String(block.text || ''));
  }
}
// Ground truth for the sampling: every character the fixture holds OUTSIDE a reasoning
// block (prose, tool arguments, tool output, injected context). A window that also lives
// there proves nothing about reasoning, so only reasoning-only windows are asserted on -
// a tool result that happens to quote a log never enters the verdict.
const nonReasoningCorpus = (function () {
  const parts = [];
  const blockList = (content) => (Array.isArray(content) ? content
    : (typeof content === 'string' ? [{ type: 'text', text: content }] : []));
  for (const event of events) {
    if (event.type === 'assistant/message') {
      for (const block of blockList(event.data && event.data.message && event.data.message.content)) {
        if (block.type === 'reasoning' || block.type === 'thinking') continue;
        parts.push(String(block.text || ''));
      }
    } else if (event.type === 'user/message') {
      for (const block of blockList(event.data && event.data.content)) parts.push(String(block.text || ''));
    } else if (event.type === 'tool/call') {
      parts.push(String((event.data && event.data.name) || ''));
      parts.push(JSON.stringify(event.data && event.data.arguments));
    } else if (event.type === 'tool/result') {
      const message = (event.data && event.data.message) || {};
      parts.push(JSON.stringify(message.content));
      for (const block of blockList(message.content)) parts.push(String(block.text || ''));
    } else if (event.cwd) parts.push(String(event.cwd));
    else if (event.data && event.data.title) parts.push(String(event.data.title));
  }
  parts.push(String((sessionEvent && sessionEvent.cwd) || ''));
  return stripWs(parts.join('\u0000'));
})();
const SAMPLE = 24;
const reasoningWindows = [];
for (const segment of reasoningFixture) {
  const flat = stripWs(segment);
  for (let at = 0; at + SAMPLE <= flat.length; at += SAMPLE) reasoningWindows.push(flat.slice(at, at + SAMPLE));
}
const reasoningSamples = reasoningWindows.filter((window) => !nonReasoningCorpus.includes(window));
function stripWs(value) {
  return String(value).replace(/\s+/g, '');
}
function documentText(source) {
  return stripWs(decodeEntities(stripTags(String(source))));
}
function sampleHits(source) {
  const text = documentText(source);
  let hits = 0;
  for (const sample of reasoningSamples) if (text.includes(sample)) hits += 1;
  return hits;
}

const omitPage = renderSessionHtml({
  session: sessionEvent, events: rawJsonl, options: { redact: true, now: NOW, theme: 'auto' },
});
const countPage = renderSessionHtml({
  session: sessionEvent, events: rawJsonl, options: { redact: true, now: NOW, theme: 'auto', reasoning: 'count' },
});
// The default document is the one a share actually ships; keep it next to the fixture
// render so the layout can be opened in a browser without re-running anything.
writeFileSync(join(outDir, 'session-sample-omit.html'), omitPage.html, 'utf8');
const turnsWithThinking = glueSummaries(html, 'glue-think').length;

check('(w) reasoning omit (default) exports zero characters of thinking', () => {
  console.log('        fixture reasoning: ' + reasoningFixture.length + ' segments / ' +
    charCount(reasoningFixture.join('')) + ' chars -> ' + reasoningWindows.length + ' windows, ' +
    reasoningSamples.length + ' of them reasoning-only (the rest coincide with quoted prose/tool output)');
  assert(omitPage.stats.reasoning === 'omit', 'default reasoning mode is not omit: ' + omitPage.stats.reasoning);
  const hits = sampleHits(omitPage.html);
  const thinkNodes = (omitPage.html.match(/data-kind="think"/g) || []).length;
  const countRows = (omitPage.html.match(/data-kind="think-count"/g) || []).length;
  console.log('        omit document: reasoning sample hits=' + hits + '/' + reasoningSamples.length +
    '  thinking nodes=' + thinkNodes + '  思考过程 rows=' + (omitPage.html.match(/思考过程/g) || []).length +
    '  count rows=' + countRows);
  assert(hits === 0, hits + ' reasoning sample window(s) survive in the omit document');
  assert(thinkNodes === 0, 'omit still ships ' + thinkNodes + ' thinking node(s)');
  assert(countRows === 0, 'omit must not ship a count row');
  assert(!omitPage.html.includes('思考过程'), 'omit still ships the 思考过程 trace row');
  assert(omitPage.stats.reasoningBlocks === reasoningFixture.length, 'stats.reasoningBlocks drifted');
});

check('(x) reasoning count ships one faint line per turn, never the text', () => {
  assert(countPage.stats.reasoning === 'count', 'reasoning mode is not echoed in stats');
  const rows = [];
  const re = /<p class="tnote" data-kind="think-count">([\s\S]*?)<\/p>/g;
  let match;
  while ((match = re.exec(countPage.html)) !== null) rows.push(textOf(match[1]).trim());
  const counted = rows.reduce((sum, row) => {
    const digits = /^思考 (\d+) 段 · 已省略$/.exec(row);
    return sum + (digits ? Number(digits[1]) : 0);
  }, 0);
  const longest = rows.reduce((max, row) => Math.max(max, charCount(row)), 0);
  console.log('        count rows=' + JSON.stringify(rows));
  console.log('        rows=' + rows.length + ' (turns with thinking=' + turnsWithThinking + ')' +
    '  segments summed=' + counted + '/' + reasoningFixture.length + '  longest row=' + longest + ' chars');
  assert(rows.length === turnsWithThinking, 'count rows ' + rows.length + ' != turns with thinking ' + turnsWithThinking);
  assert(countPage.stats.reasoningRows === rows.length, 'stats.reasoningRows out of sync: ' + countPage.stats.reasoningRows);
  assert(counted === reasoningFixture.length, 'counted segments ' + counted + ' != fixture ' + reasoningFixture.length);
  for (const row of rows) {
    assert(/^思考 \d+ 段 · 已省略$/.test(row), 'count row lost its shape: ' + row);
    assert(charCount(row) <= 30, 'count row longer than 30 chars: ' + row);
  }
  const hits = sampleHits(countPage.html);
  console.log('        count document: reasoning sample hits=' + hits + '  thinking nodes=' +
    (countPage.html.match(/data-kind="think"/g) || []).length);
  assert(hits === 0, hits + ' reasoning sample window(s) reach the count document');
  assert((countPage.html.match(/data-kind="think"/g) || []).length === 0, 'count mode still ships a thinking body');
  assert(!/<details[^>]*data-kind="think-count"/.test(countPage.html), 'the count row must not be collapsible');
});

check('(y) reasoning full reproduces the previous document', () => {
  assert(stats.reasoning === 'full', 'fixture page is not rendered in full mode');
  const rows = glueSummaries(html, 'glue-think');
  const segments = detailsOfKind(html, 'think');
  const hits = sampleHits(html);
  console.log('        full document: think rows=' + rows.length + '  segments=' + segments.length +
    '  reasoning sample hits=' + hits + '/' + reasoningSamples.length + '  first row=' + JSON.stringify(rows[0]));
  assert(rows.length === turnsWithThinking, 'full mode lost its 思考过程 rows');
  assert(segments.length === reasoningFixture.length, 'full mode segments ' + segments.length + ' != fixture ' + reasoningFixture.length);
  assert(hits >= Math.floor(reasoningSamples.length * 0.5),
    'full mode dropped reasoning text: only ' + hits + '/' + reasoningSamples.length + ' samples found');
});

// ---------------------------------------------------------------------------
// Requirement 4: the two speakers must be distinguishable without reading the label.
// The check reads the stylesheet the way the browser does, then verifies legibility.
// ---------------------------------------------------------------------------

function declarationMap(rule) {
  const map = new Map();
  for (const part of String(rule).split(';')) {
    const at = part.indexOf(':');
    if (at === -1) continue;
    map.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return map;
}

check('(z) user and assistant bubbles differ in >= 3 CSS dimensions', () => {
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const userRule = cssRule(css, 'section.msg-user');
  const asstRule = cssRule(css, 'section.msg-assistant');
  const user = declarationMap(userRule);
  const asst = declarationMap(asstRule);
  assert(user.size && asst.size, 'could not read the two bubble rules');
  const differing = [...new Set([...user.keys(), ...asst.keys()])]
    .filter((key) => user.get(key) !== asst.get(key)).sort();
  console.log('        user      : ' + [...user].map((pair) => pair[0] + '=' + pair[1]).join(' | '));
  console.log('        assistant : ' + [...asst].map((pair) => pair[0] + '=' + pair[1]).join(' | '));
  console.log('        differing declarations (' + differing.length + '): ' + differing.join(', '));
  for (const key of ['align-self', 'background', 'border-color']) {
    assert(differing.includes(key), 'the two bubbles do not differ in ' + key);
  }
  assert(differing.length >= 3, 'only ' + differing.length + ' CSS differences, need >= 3');
  assert(/var\(--user-bg\)/.test(user.get('background')) && /var\(--asst-bg\)/.test(asst.get('background')),
    'bubble backgrounds are not palette variables');
  assert(/var\(--user-bd\)/.test(user.get('border-color')) && /var\(--asst-bd\)/.test(asst.get('border-color')),
    'bubble borders are not palette variables');
  for (const pair of [['user', userRule], ['assistant', asstRule]]) {
    assert(!/#[0-9a-fA-F]{3,8}/.test(pair[1]), pair[0] + ' bubble rule hard-codes a hex colour');
    assert(!/rgba?\(/.test(pair[1]), pair[0] + ' bubble rule hard-codes an rgb() colour');
  }
  const userTag = cssRule(css, '.msg-user .who');
  const asstTag = cssRule(css, '.msg-assistant .who');
  const userDot = cssRule(css, '.msg-user .dot');
  const asstDot = cssRule(css, '.msg-assistant .dot');
  console.log('        name tag  : user="' + userTag + '"  assistant="' + asstTag + '" + pill(' + cssRule(css, '.msg-assistant .who .name') + ')');
  console.log('        marker    : user="' + userDot + '"  assistant="' + asstDot + '"');
  assert(/flex-direction:row-reverse/.test(userTag) && !/row-reverse/.test(asstTag),
    'the two name tags do not sit on opposite sides');
  assert(/border-radius:2px/.test(userDot) && /border-radius:50%/.test(asstDot),
    'the two markers do not have different shapes');
  assert((html.match(/class="msg msg-user"/g) || []).length > 0 &&
    (html.match(/class="msg msg-assistant"/g) || []).length > 0, 'bubble classes missing from the document');
  const mobile = css.slice(css.indexOf('@media (max-width:640px)'));
  const mobileUser = (/section\.msg-user\{[^}]*\}/.exec(mobile) || ['(none)'])[0];
  const mobileAsst = (/section\.msg-assistant\{[^}]*\}/.exec(mobile) || ['(none)'])[0];
  console.log('        mobile <640px: ' + mobileUser + '   ' + mobileAsst);
  assert(/section\.msg-user\{max-width:9\d%\}/.test(mobile), 'user bubble has no narrow-viewport width');
  assert(/section\.msg-assistant\{max-width:100%\}/.test(mobile), 'assistant bubble has no narrow-viewport width');
  for (const pair of [['user', mobileUser], ['assistant', mobileAsst]]) {
    const width = /max-width:(\d+)%/.exec(pair[1]);
    assert(width && Number(width[1]) <= 100, pair[0] + ' bubble exceeds the viewport on mobile');
  }
});

check('(aa) text on both bubble backgrounds stays >= 4.5:1 in light and dark', () => {
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const palettes = [
    ['light', readVars(cssRule(css, ':root'))],
    ['dark', readVars(cssRule(css, ':root[data-theme="dark"]'))],
  ];
  const measured = [];
  for (const pair of palettes) {
    const name = pair[0];
    const vars = pair[1];
    const body = contrastRatio(vars['--fg'], vars['--bg']);
    measured.push([name, 'body on page', vars['--fg'], vars['--bg'], body]);
    assert(body >= 4.5, name + ' body contrast ' + body.toFixed(2) + ':1 is below 4.5:1');
    for (const role of ['user', 'assistant']) {
      const prefix = role === 'user' ? '--user' : '--asst';
      const fg = vars[prefix + '-fg'];
      const bg = vars[prefix + '-bg'];
      assert(fg && bg, name + ' palette is missing ' + prefix + '-fg / ' + prefix + '-bg');
      const ratio = contrastRatio(fg, bg);
      measured.push([name, role + ' bubble text', fg, bg, ratio]);
      assert(ratio >= 4.5, name + ' ' + role + ' bubble contrast ' + ratio.toFixed(2) + ':1 is below 4.5:1');
    }
    const tag = contrastRatio(vars['--asst-tag-fg'], vars['--asst-tag-bg']);
    measured.push([name, 'assistant name pill', vars['--asst-tag-fg'], vars['--asst-tag-bg'], tag]);
    assert(tag >= 4.5, name + ' name pill contrast ' + tag.toFixed(2) + ':1 is below 4.5:1');
  }
  for (const row of measured) {
    console.log('        ' + row[0] + ' / ' + row[1] + ': ' + row[2] + ' on ' + row[3] + ' -> ' +
      row[4].toFixed(2) + ':1');
  }
  const lowest = measured.reduce((min, row) => Math.min(min, row[4]), Infinity);
  console.log('        lowest measured contrast=' + lowest.toFixed(2) + ':1 (threshold 4.5:1)');
});

check('(ab) omit keeps one self-contained file, tools/context intact, print unchanged', () => {
  const page = omitPage.html;
  assert(/<\/html>\s*$/.test(page), 'omit document does not end with </html>');
  assert((page.match(/<style/g) || []).length === 1, 'expected exactly one style block');
  assert((page.match(/<script/g) || []).length === 1, 'expected exactly one inline script');
  assert(!/\b(src|href)=/i.test(page), 'found an external src/href reference');
  assert(!/<link\b|<img\b|<iframe\b/i.test(page), 'found an external resource tag');
  assert(!/http:\/\/|https:\/\//i.test(page), 'found an http(s) scheme');
  assert(omitPage.stats.bytes === Buffer.byteLength(page, 'utf8'), 'stats.bytes != utf8 length');
  const nameHits = realUsername.length >= 2 ? page.split(realUsername).length - 1 : -1;
  console.log('        omit document: ' + omitPage.stats.bytes + ' bytes  username hits=' + nameHits +
    '  http(s)=' + (page.match(/https?:\/\//gi) || []).length + '  redacted=' + omitPage.stats.redacted);
  assert(nameHits === 0, 'username leaked into the omit document ' + nameHits + ' time(s)');

  const toolFull = glueSummaries(html, 'glue-tool');
  const toolOmit = glueSummaries(page, 'glue-tool');
  const ctxFull = glueSummaries(html, 'glue-ctx');
  const ctxOmit = glueSummaries(page, 'glue-ctx');
  console.log('        tool rows  full=' + JSON.stringify(toolFull));
  console.log('        tool rows  omit=' + JSON.stringify(toolOmit));
  console.log('        context    full=' + JSON.stringify(ctxFull) + ' entries=' + detailsOfKind(html, 'ctx').length);
  console.log('        context    omit=' + JSON.stringify(ctxOmit) + ' entries=' + detailsOfKind(page, 'ctx').length);
  assert(JSON.stringify(toolFull) === JSON.stringify(toolOmit), 'tool trace rows moved with the reasoning switch');
  assert(JSON.stringify(ctxFull) === JSON.stringify(ctxOmit), 'context rows moved with the reasoning switch');
  assert(detailsOfKind(html, 'ctx').length === detailsOfKind(page, 'ctx').length,
    'context entries moved with the reasoning switch');
  const omitTurns = splitTurns(page);
  assert(omitTurns.length === turnSections.length, 'turn count changed with the reasoning switch');
  for (let i = 0; i < omitTurns.length; i += 1) {
    const rows = glueSummaries(omitTurns[i], 'glue-tool');
    assert(rows.length <= 1, 'turn ' + (i + 1) + ' has ' + rows.length + ' tool rows');
    for (const row of rows) assert(charCount(row) <= 40, 'tool row too long (' + charCount(row) + '): ' + row);
  }
  const css = page.slice(page.indexOf('<style>'), page.indexOf('</style>'));
  const printRule = css.slice(css.indexOf('@media print'));
  assert(/details,details>\*\{display:block !important\}/.test(printRule), 'print no longer expands every details');
  assert(/pre\.code\{white-space:pre-wrap/.test(printRule), 'print code rule lost');
  console.log('        print: tools+context still expand via details{display:block !important}; ' +
    'reasoning nodes in the omit document=' + (page.match(/data-kind="think"/g) || []).length);
  assert((page.match(/data-kind="think"/g) || []).length === 0, 'omit document would print thinking');
});

// ---------------------------------------------------------------------------
// Requirement 5: per-message picking. indexSession decides what a shareable entry is;
// options.pick decides which of them the document carries. Both read the same stream, so
// every id the picker lists is an id the renderer honours.
// ---------------------------------------------------------------------------

function messageBlocks(event) {
  if (!event || !event.data) return [];
  const container = event.type === 'assistant/message' ? event.data.message : event.data;
  const content = container && container.content;
  if (Array.isArray(content)) return content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return [];
}

// The prose the renderer would print for one message event; '' when it prints a bubble
// with no text block at all.
function proseOf(event) {
  const parts = [];
  for (const block of messageBlocks(event)) {
    if (!block || typeof block !== 'object') continue;
    const type = block.type == null ? '' : String(block.type);
    if (type !== 'text' && type !== '') continue;
    const text = String(block.text == null ? '' : block.text);
    if (text.trim()) parts.push(text);
  }
  return parts;
}

const messageBySeq = new Map();
for (const event of events) {
  if (event && typeof event.seq === 'number') messageBySeq.set(event.seq, event);
}

const humanUserMessages = events.filter((event) => event.type === 'user/message' &&
  event.data && event.data.source && event.data.source.kind === 'user' && proseOf(event).length);
const assistantProseMessages = events.filter((event) => event.type === 'assistant/message' && proseOf(event).length);
const entryIndex = indexSession({ session: sessionEvent, events: rawJsonl, options: { redact: true } });

const sampleRedactor = createRedactor({ usernames: [realUsername] });
// Only letter/digit runs are sampled: markdown markers, backticks, URL schemes and
// punctuation are rewritten on the way into the document, a letter run never is.
function sampleWindows(value, size) {
  const width = size || SAMPLE;
  const runs = stripWs(sampleRedactor.text(String(value))).match(/[\p{L}\p{N}]+/gu) || [];
  const out = [];
  for (const run of runs) {
    for (let at = 0; at + width <= run.length; at += 1) out.push(run.slice(at, at + width));
  }
  return out;
}

function eventProse(event) {
  if (!event) return '';
  if (event.type === 'user/message' || event.type === 'assistant/message') return proseOf(event).join('\n');
  return '';
}

function hitsIn(page, samples) {
  const text = documentText(page);
  let hits = 0;
  for (const sample of samples) if (text.includes(sample)) hits += 1;
  return hits;
}

check('(ac) indexSession lists exactly the human turns and the assistant prose', () => {
  console.log('        fixture: human user/message=' + humanUserMessages.length +
    '  assistant prose messages=' + assistantProseMessages.length +
    '  index total=' + entryIndex.total);
  for (const entry of entryIndex.entries) {
    console.log('        ' + entry.id + '  ' + entry.kind.padEnd(9) + ' turn=' + entry.turn +
      '  seq=' + entry.seq + '  chars=' + entry.chars + '  tools=' + entry.tools +
      '  context=' + entry.context + '  ' + JSON.stringify(entry.label.slice(0, 42)));
  }
  assert(humanUserMessages.length > 0 && assistantProseMessages.length > 0,
    'fixture no longer exercises both kinds of entry');
  assert(entryIndex.total === humanUserMessages.length + assistantProseMessages.length,
    'index total ' + entryIndex.total + ' != human ' + humanUserMessages.length +
    ' + assistant prose ' + assistantProseMessages.length);
  assert(entryIndex.entries.length === entryIndex.total, 'entries length != total');
  const users = entryIndex.entries.filter((entry) => entry.kind === 'user');
  const assistants = entryIndex.entries.filter((entry) => entry.kind === 'assistant');
  assert(users.length === humanUserMessages.length, 'user entries ' + users.length + ' != ' + humanUserMessages.length);
  assert(assistants.length === assistantProseMessages.length,
    'assistant entries ' + assistants.length + ' != ' + assistantProseMessages.length);

  const seen = new Set();
  const forbidden = [/\n/, /\r/, /```/, /`/, /\*\*/, /^#{1,6}\s/, /^\s*[-*+]\s/, /^\s*\d+[.)]\s/, /\[[^\]]*\]\(/, /!\[/];
  for (const entry of entryIndex.entries) {
    assert(/^m\d+$/.test(entry.id), 'id does not follow the m<seq> rule: ' + entry.id);
    assert(!seen.has(entry.id), 'duplicate entry id: ' + entry.id);
    seen.add(entry.id);
    assert(entry.kind === 'user' || entry.kind === 'assistant', 'unexpected kind: ' + entry.kind);
    assert(Number.isFinite(entry.turn) && entry.turn > 0, 'turn is not a positive number: ' + entry.turn);
    assert(typeof entry.seq === 'number' && typeof entry.time === 'number', 'seq/time must be numbers');
    assert(typeof entry.chars === 'number' && entry.chars >= 0, 'chars is not a number');
    assert(typeof entry.tools === 'number' && typeof entry.context === 'number', 'tools/context must be numbers');
    assert(entry.label.length <= 80, 'label longer than 80 chars (' + entry.label.length + '): ' + entry.label);
    for (const re of forbidden) assert(!re.test(entry.label), 'label still carries a markdown marker ' + re + ': ' + entry.label);
    if (realUsername.length >= 2) {
      assert(!entry.label.includes(realUsername), 'label leaked the username: ' + entry.label);
    }
    // The id must resolve back to the message event it came from - that is what makes the
    // index stable when messages are inserted above it.
    const source = messageBySeq.get(entry.seq);
    assert(!!source, 'entry ' + entry.id + ' does not resolve to an event with seq ' + entry.seq);
    assert(source.type === (entry.kind === 'user' ? 'user/message' : 'assistant/message'),
      'entry ' + entry.id + ' points at a ' + source.type);
  }
  // Reasoning, tool traffic and injected context are traces: they never become entries.
  const traceSeqs = new Set();
  for (const event of events) {
    if (event.type === 'tool/call' || event.type === 'tool/result') traceSeqs.add(event.seq);
    if (event.type === 'user/message' && event.data && event.data.source && event.data.source.kind &&
      event.data.source.kind !== 'user') traceSeqs.add(event.seq);
  }
  for (const entry of entryIndex.entries) assert(!traceSeqs.has(entry.seq), 'trace event ' + entry.seq + ' became an entry');
  const reasoningOnly = events.filter((event) => event.type === 'assistant/message' &&
    messageBlocks(event).some((block) => block && (block.type === 'reasoning' || block.type === 'thinking')) &&
    proseOf(event).length === 0);
  console.log('        traced, never indexed: tool events=' + traceSeqs.size +
    '  thinking-only assistant messages=' + reasoningOnly.length);
  for (const event of reasoningOnly) assert(!seen.has('m' + event.seq), 'thinking-only message became an entry');
});

const pickPair = (function () {
  for (let i = 0; i + 1 < entryIndex.entries.length; i += 1) {
    const a = entryIndex.entries[i];
    const b = entryIndex.entries[i + 1];
    if (a.turn === b.turn && a.tools > 0 && a.context > 0 && b.tools > 0 && b.context > 0) return [a, b];
  }
  return null;
})();
const pickIdsPair = pickPair ? pickPair.map((entry) => entry.id) : [];
const pickedPage = renderSessionHtml({
  session: sessionEvent,
  events: rawJsonl,
  options: { redact: true, now: NOW, theme: 'auto', pick: pickIdsPair },
});

check('(ad) a pick ships only the chosen entries and keeps their turn traces', () => {
  assert(pickPair, 'no two consecutive fixture entries share a turn that has tools and context');
  console.log('        picked: ' + pickIdsPair.join(',') + ' (turn ' + pickPair[0].turn +
    ', tools=' + pickPair[0].tools + ', context=' + pickPair[0].context + ')');
  assert(pickedPage.stats.picked === 2, 'stats.picked ' + pickedPage.stats.picked + ' != 2');
  assert(pickedPage.stats.totalEntries === entryIndex.total,
    'stats.totalEntries ' + pickedPage.stats.totalEntries + ' != index total ' + entryIndex.total);
  const bubbles = (pickedPage.html.match(/data-role="user"/g) || []).length +
    (pickedPage.html.match(/data-role="assistant"/g) || []).length;
  console.log('        rendered: bubbles=' + bubbles + '  turns=' + splitTurns(pickedPage.html).length +
    '  ctx entries=' + detailsOfKind(pickedPage.html, 'ctx').length +
    '  tool entries=' + detailsOfKind(pickedPage.html, 'tool').length +
    '  ctx rows=' + JSON.stringify(glueSummaries(pickedPage.html, 'glue-ctx')) +
    '  tool rows=' + JSON.stringify(glueSummaries(pickedPage.html, 'glue-tool')));
  assert(bubbles === 2, 'picked document carries ' + bubbles + ' bubbles, expected 2');
  assert(splitTurns(pickedPage.html).length === 1, 'the two picked entries must share one rendered turn');
  // A turn that kept at least one picked message keeps its traces, in the very same shape.
  assert(glueSummaries(pickedPage.html, 'glue-ctx').length === 1, 'the picked turn lost its inline-context row');
  assert(glueSummaries(pickedPage.html, 'glue-tool').length === 1, 'the picked turn lost its tool row');
  assert(detailsOfKind(pickedPage.html, 'ctx').length === pickPair[0].context,
    'context entries ' + detailsOfKind(pickedPage.html, 'ctx').length + ' != turn context ' + pickPair[0].context);
  assert(detailsOfKind(pickedPage.html, 'tool').length === pickPair[0].tools,
    'tool entries ' + detailsOfKind(pickedPage.html, 'tool').length + ' != turn tool calls ' + pickPair[0].tools);
  assert(JSON.stringify(glueSummaries(pickedPage.html, 'glue-ctx')) === JSON.stringify([glueSummaries(html, 'glue-ctx')[0]]),
    'the context row changed shape under pick');

  // Every picked body must be there...
  const pickedText = documentText(pickedPage.html);
  for (const entry of pickPair) {
    const windows = sampleWindows(eventProse(messageBySeq.get(entry.seq)), 12);
    assert(windows.length > 0, 'no sample window for picked entry ' + entry.id);
    assert(windows.some((window) => pickedText.includes(window)), 'picked entry ' + entry.id + ' is missing from the page');
  }

  // ...and nothing an unpicked entry holds may survive, anywhere in the document. The
  // corpus below holds every other source of text (the picked bodies, reasoning, tool
  // traffic, inline context), so a window missing from it belongs to an unpicked entry
  // alone - a hit would be a real leak, not a coincidence.
  const toolCorpus = [];
  for (const event of events) {
    if (event.type === 'tool/call') {
      toolCorpus.push(String((event.data && event.data.name) || ''));
      toolCorpus.push(JSON.stringify(event.data && event.data.arguments));
    } else if (event.type === 'tool/result') {
      toolCorpus.push(JSON.stringify((event.data && event.data.message && event.data.message.content) || ''));
    } else if (event.type === 'session' || event.type === 'session/title') {
      toolCorpus.push(JSON.stringify(event.data || {}));
      toolCorpus.push(String(event.cwd || ''));
    }
  }
  const pickedSeqs = new Set(pickPair.map((entry) => entry.seq));
  const otherCorpus = stripWs(sampleRedactor.text([
    ...pickPair.map((entry) => eventProse(messageBySeq.get(entry.seq))),
    ...reasoningFixture,
    ...toolCorpus,
    ...fixtureInjected,
    String((sessionEvent && sessionEvent.title) || ''),
  ].join('\u0000')));
  const unpickedSamples = [];
  for (const entry of entryIndex.entries) {
    if (pickedSeqs.has(entry.seq)) continue;
    for (const window of sampleWindows(eventProse(messageBySeq.get(entry.seq)))) {
      if (!otherCorpus.includes(window) && unpickedSamples.indexOf(window) === -1) unpickedSamples.push(window);
    }
  }
  const leaks = hitsIn(pickedPage.html, unpickedSamples);
  console.log('        unpicked entries: ' + (entryIndex.total - pickPair.length) +
    '  exclusive sample windows=' + unpickedSamples.length + '  hits in the picked page=' + leaks);
  assert(unpickedSamples.length > 0, 'no unpicked sample window survived the corpus filter, check is vacuous');
  assert(leaks === 0, leaks + ' unpicked body window(s) reached the picked page');
  assert(/<\/html>\s*$/.test(pickedPage.html), 'picked document does not end with </html>');
  assert(pickedPage.html.includes('已选 2 / ' + entryIndex.total + ' 条'), 'header does not report the pick');
});

check('(ae) unknown ids in a pick are ignored and never raise', () => {
  assert(pickPair, 'need a valid pair to mix the unknown id into');
  const mixed = renderSessionHtml({
    session: sessionEvent,
    events: rawJsonl,
    options: { redact: true, now: NOW, theme: 'auto', pick: [pickIdsPair[0], 'm999999', pickIdsPair[1], '', null, 7] },
  });
  console.log('        pick=' + JSON.stringify([pickIdsPair[0], 'm999999', pickIdsPair[1]]) +
    ' -> picked=' + mixed.stats.picked + ' totalEntries=' + mixed.stats.totalEntries);
  assert(mixed.stats.picked === 2, 'unknown ids changed the count: picked=' + mixed.stats.picked);
  assert(mixed.stats.totalEntries === entryIndex.total, 'totalEntries drifted');
  assert(!mixed.html.includes('m999999'), 'an unmatched id leaked into the document');
  const onlyUnknown = renderSessionHtml({
    session: sessionEvent,
    events: rawJsonl,
    options: { redact: true, now: NOW, theme: 'auto', pick: ['m999999'] },
  });
  assert(onlyUnknown.stats.picked === 0, 'a pick of unknown ids shipped ' + onlyUnknown.stats.picked + ' entries');
  assert(onlyUnknown.html.includes('未选择任何消息'), 'an all-miss pick produced no explanation');
});

check('(af) pick: [] ships an empty page that explains itself', () => {
  const empty = renderSessionHtml({
    session: sessionEvent,
    events: rawJsonl,
    options: { redact: true, now: NOW, theme: 'auto', pick: [] },
  });
  console.log('        empty pick: picked=' + empty.stats.picked + ' totalEntries=' + empty.stats.totalEntries +
    '  turns=' + empty.stats.turns + '  bytes=' + empty.stats.bytes);
  assert(empty.stats.picked === 0, 'empty pick shipped ' + empty.stats.picked + ' entries');
  assert(empty.stats.totalEntries === entryIndex.total, 'totalEntries must stay the full index total');
  assert(/<\/html>\s*$/.test(empty.html), 'empty pick did not produce a document');
  assert(empty.html.includes('未选择任何消息'), 'empty pick has no explanation');
  assert((empty.html.match(/data-role="user"/g) || []).length === 0, 'empty pick still shows user bubbles');
  assert((empty.html.match(/data-role="assistant"/g) || []).length === 0, 'empty pick still shows assistant bubbles');
  assert(detailsOfKind(empty.html, 'tool').length === 0 && detailsOfKind(empty.html, 'ctx').length === 0,
    'empty pick still shows trace bodies');
  const allSamples = [];
  for (const entry of entryIndex.entries) {
    for (const window of sampleWindows(eventProse(messageBySeq.get(entry.seq)))) allSamples.push(window);
  }
  const leaks = hitsIn(empty.html, allSamples);
  console.log('        body windows across all ' + entryIndex.total + ' entries=' + allSamples.length +
    '  hits in the empty page=' + leaks);
  assert(leaks === 0, leaks + ' message body window(s) reached the empty page');
});

check('(ag) no pick (or pick: undefined) reproduces the document exactly', () => {
  const plain = renderSessionHtml({ session: sessionEvent, events: rawJsonl, options: { redact: true, now: NOW, theme: 'auto' } });
  assert(plain.html === omitPage.html, 'the default document is not deterministic');
  const explicit = renderSessionHtml({
    session: sessionEvent,
    events: rawJsonl,
    options: { redact: true, now: NOW, theme: 'auto', pick: undefined },
  });
  assert(explicit.html === plain.html, 'pick: undefined changed the document');
  console.log('        default document: picked=' + plain.stats.picked + ' totalEntries=' + plain.stats.totalEntries +
    '  bytes=' + plain.stats.bytes);
  assert(plain.stats.picked === entryIndex.total, 'default picked ' + plain.stats.picked + ' != total ' + entryIndex.total);
  assert(plain.stats.totalEntries === entryIndex.total, 'default totalEntries drifted');
  assert(plain.stats.picked === plain.stats.totalEntries, 'default picked != totalEntries');
  assert(!plain.html.includes('已选 '), 'the default document grew a pick badge');
  const reversed = renderSessionHtml({
    session: sessionEvent,
    events: rawJsonl,
    options: { redact: true, now: NOW, theme: 'auto', pick: [pickIdsPair[1], pickIdsPair[0]] },
  });
  assert(reversed.html === pickedPage.html, 'pick order changed the document; stream order must win');
  const duplicated = renderSessionHtml({
    session: sessionEvent,
    events: rawJsonl,
    options: { redact: true, now: NOW, theme: 'auto', pick: [pickIdsPair[0], pickIdsPair[0], pickIdsPair[1]] },
  });
  assert(duplicated.html === pickedPage.html, 'a duplicated id rendered the entry twice');
  console.log('        pick order/duplicates: document identical to the canonical pick');
});
// ---------------------------------------------------------------------------
// Requirement 3: a reader must tell the two speakers apart without reading a label, and a
// run of assistant replies must not fuse into one paragraph. Everything below is measured
// off the stylesheet the way the browser applies it.
// ---------------------------------------------------------------------------

const speakerCss = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const userBubbleRule = cssRule(speakerCss, 'section.msg-user');
const asstBubbleRule = cssRule(speakerCss, 'section.msg-assistant');
const userDecl = declarationMap(userBubbleRule);
const asstDecl = declarationMap(asstBubbleRule);

// CSS shorthand expansion (margin:20px 0 -> 20/0/20/0), so a spacing claim is a number.
function boxValues(declarations, property) {
  const at = String(declarations).indexOf(property + ':');
  if (at === -1) return [];
  const raw = declarations.slice(at + property.length + 1).split(';')[0].trim();
  const parts = raw.split(/\s+/).filter(Boolean).map((value) => parseFloat(value));
  if (!parts.length || parts.some((value) => !isFinite(value))) return [];
  if (parts.length === 1) return [parts[0], parts[0], parts[0], parts[0]];
  if (parts.length === 2) return [parts[0], parts[1], parts[0], parts[1]];
  if (parts.length === 3) return [parts[0], parts[1], parts[2], parts[1]];
  return parts.slice(0, 4);
}

function hexFree(rule) {
  return !/#[0-9a-fA-F]{3,8}/.test(rule) && !/rgba?\(/.test(rule);
}

check('(ah) user and assistant containers differ in >= 5 CSS dimensions, each one listed', () => {
  const keys = [...new Set([...userDecl.keys(), ...asstDecl.keys()])].sort();
  const diffs = keys.filter((key) => userDecl.get(key) !== asstDecl.get(key));
  console.log('        container  user      : section.msg-user{' + userBubbleRule + '}');
  console.log('        container  assistant : section.msg-assistant{' + asstBubbleRule + '}');
  for (const key of diffs) {
    console.log('        differs  ' + key + ':  user=' + (userDecl.has(key) ? userDecl.get(key) : '(未声明)') +
      '  |  assistant=' + (asstDecl.has(key) ? asstDecl.get(key) : '(未声明)'));
  }
  const axes = [
    ['对齐', 'align-self'],
    ['底色', 'background'],
    ['圆角', 'border-radius'],
    ['边框', 'border-color'],
    ['侧边色条', 'border-left'],
    ['间距', 'margin'],
  ];
  for (const axis of axes) {
    const ok = diffs.includes(axis[1]);
    console.log('        axis ' + axis[0] + ' (' + axis[1] + '): ' + (ok ? 'satisfied' : 'MISSING'));
    assert(ok, 'the two containers do not differ in ' + axis[1] + ' (' + axis[0] + ')');
  }
  console.log('        differing declarations (' + diffs.length + '): ' + diffs.join(', '));
  assert(diffs.length >= 5, 'only ' + diffs.length + ' CSS differences, need >= 5');
  assert(hexFree(userBubbleRule) && hexFree(asstBubbleRule), 'a bubble container hard-codes a colour');
  // The two identity marks are different shapes: a filled pill vs an avatar + hairline.
  const pill = cssRule(speakerCss, '.msg-user .who .name');
  const name = cssRule(speakerCss, '.msg-assistant .who .name');
  const asstBar = cssRule(speakerCss, '.msg-assistant .who');
  console.log('        identity  user      : .msg-user .who .name{' + pill + '}');
  console.log('        identity  assistant : .msg-assistant .who{' + asstBar + '} .name{' + name + '}');
  assert(/background:var\(--user-pill-bg\)/.test(pill) && /border-radius:999px/.test(pill),
    'the user identity is not a filled pill');
  assert(!/background/.test(name) && !/border-radius/.test(name), 'the assistant identity became a pill too');
  assert(/border-bottom:1px solid var\(--asst-tag-bg\)/.test(asstBar), 'the assistant identity row has no hairline');
  assert(hexFree(pill) && hexFree(name) && hexFree(asstBar), 'an identity rule hard-codes a colour');
});

check('(ai) the identity bar is its own block, never mixed into the prose paragraph', () => {
  const userHead = '<section class="msg msg-user" data-role="user"><div class="who"><span class="dot"></span>' +
    '<span class="name">你</span></div><div class="md">';
  const asstHead = '<section class="msg msg-assistant" data-role="assistant"><div class="who"><span class="dot"></span>' +
    '<span class="name">DeepSeek</span></div><div class="md">';
  const userBubbles = (html.match(/data-role="user"/g) || []).length;
  const asstBubbles = (html.match(/data-role="assistant"/g) || []).length;
  const userHeads = html.split(userHead).length - 1;
  const asstHeads = html.split(asstHead).length - 1;
  console.log('        user bubbles=' + userBubbles + ' canonical bar-then-body heads=' + userHeads);
  console.log('        assistant bubbles=' + asstBubbles + ' canonical bar-then-body heads=' + asstHeads);
  assert(userBubbles > 0 && asstBubbles > 0, 'the fixture no longer carries both speakers');
  assert(userHeads === userBubbles, 'a user bubble does not open its identity bar and body as separate blocks');
  assert(asstHeads === asstBubbles, 'an assistant bubble does not open its identity bar and body as separate blocks');
  const bars = html.match(/<div class="who">[\s\S]*?<\/div>/g) || [];
  const barTexts = [...new Set(bars.map((bar) => textOf(bar).trim()))].sort();
  console.log('        identity bars=' + bars.length + ' (bubbles=' + (userBubbles + asstBubbles) +
    ')  bar texts=' + JSON.stringify(barTexts));
  assert(bars.length === userBubbles + asstBubbles, 'identity bars ' + bars.length + ' != bubbles ' +
    (userBubbles + asstBubbles));
  for (const bar of bars) {
    const text = textOf(bar).trim();
    assert(text === '你' || text === 'DeepSeek', 'an identity bar carries prose: ' + text.slice(0, 40));
  }
});

check('(aj) every speaker surface stays >= 4.5:1 in light and dark', () => {
  const palettes = [
    ['light', readVars(cssRule(speakerCss, ':root'))],
    ['dark', readVars(cssRule(speakerCss, ':root[data-theme="dark"]'))],
  ];
  const surfaces = [
    ['正文 on 页面底', '--fg', '--bg'],
    ['用户正文 on 用户气泡底', '--user-fg', '--user-bg'],
    ['「你」胶囊文字 on 胶囊底', '--user-pill-fg', '--user-pill-bg'],
    ['助手正文 on 助手卡底', '--asst-fg', '--asst-bg'],
    ['「DeepSeek」 on 助手卡底', '--asst-tag-fg', '--asst-bg'],
    ['「DeepSeek」 on 身份栏底色', '--asst-tag-fg', '--asst-tag-bg'],
  ];
  const measured = [];
  for (const palette of palettes) {
    for (const surface of surfaces) {
      const vars = palette[1];
      const fg = vars[surface[1]];
      const bg = vars[surface[2]];
      assert(fg && bg, palette[0] + ' palette is missing ' + surface[1] + ' / ' + surface[2]);
      const ratio = contrastRatio(fg, bg);
      measured.push([palette[0], surface[0], fg, bg, ratio]);
      console.log('        ' + palette[0] + ' / ' + surface[0] + ': ' + fg + ' on ' + bg + ' -> ' +
        ratio.toFixed(2) + ':1' + (ratio >= 4.5 ? '' : '  *** below 4.5:1'));
      assert(ratio >= 4.5, palette[0] + ' ' + surface[0] + ' ' + ratio.toFixed(2) + ':1 is below 4.5:1');
    }
  }
  const lowest = measured.reduce((min, row) => Math.min(min, row[4]), Infinity);
  console.log('        lowest measured contrast=' + lowest.toFixed(2) + ':1 over ' + measured.length +
    ' surface/theme pairs (threshold 4.5:1)');
  for (const selector of ['.msg-user .who', '.msg-user .who .name', '.msg-user .dot', '.msg-assistant .who',
    '.msg-assistant .who .name', '.msg-assistant .dot',
    'section.msg-assistant+section.msg-assistant::before']) {
    const rule = cssRule(speakerCss, selector);
    assert(rule, 'missing speaker rule ' + selector);
    assert(hexFree(rule), selector + ' hard-codes a colour: ' + rule);
  }
  console.log('        colour audit: all 7 speaker rules resolve through var()/colour-mix only');
  const printRule = speakerCss.slice(speakerCss.indexOf('@media print'));
  assert(/\.msg-user \.who \.name\{background:transparent/.test(printRule),
    'the solid pill would print as white-on-white; the print block must neutralise its fill');
  console.log('        print: the solid pill degrades to transparent + black text, so "你" survives on paper');
});

check('(ak) rhythm: 12px + a hairline between replies, 20px around a user turn', () => {
  const turnRule = cssRule(speakerCss, 'section.turn');
  const gap = cssNumber(turnRule, 'gap');
  const sep = cssRule(speakerCss, 'section.msg-assistant+section.msg-assistant::before');
  const userBox = boxValues(userBubbleRule, 'margin');
  const asstBox = boxValues(asstBubbleRule, 'margin');
  console.log('        section.turn{' + turnRule + '}  -> gap=' + gap + 'px between assistant cards');
  console.log('        section.msg-assistant+section.msg-assistant::before{' + sep + '}');
  console.log('        user margin box=' + JSON.stringify(userBox) + '  assistant margin box=' +
    JSON.stringify(asstBox));
  assert(gap === 12, 'assistant-to-assistant gap is ' + gap + 'px, expected 12px');
  assert(/height:1px/.test(sep) && /background:var\(--line\)/.test(sep),
    'no hairline between two consecutive assistant cards');
  assert(/top:-6px/.test(sep), 'the hairline is not centred in the 12px gap');
  assert(userBox.length === 4, 'the user bubble carries no vertical margin');
  const userTop = userBox[0];
  const userBottom = userBox[2];
  console.log('        spacing: assistant->assistant=' + gap + 'px  previous->user=' + (gap + userTop) +
    'px  user->next=' + (gap + userBottom) + 'px');
  assert(userTop > gap && userBottom > gap,
    'user spacing ' + userTop + 'px is not larger than the ' + gap + 'px assistant gap');
  assert(gap + userTop > gap && gap + userBottom > gap, 'a user turn does not breathe more than a reply');
  assert(asstBox.length === 0 && !/margin-(top|bottom)/.test(asstBubbleRule),
    'the assistant card grew a vertical margin');
  // DOM evidence: three consecutive replies are three sibling sections, so the + rule fires.
  const three = renderSessionHtml({
    events: [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'assistant/message', seq: 1, data: { message: { content: [{ type: 'text', text: '第一段回答。' }] } } },
      { type: 'assistant/message', seq: 2, data: { message: { content: [{ type: 'text', text: '第二段回答。' }] } } },
      { type: 'assistant/message', seq: 3, data: { message: { content: [{ type: 'text', text: '第三段回答。' }] } } },
    ],
    options: { now: 0 },
  });
  const adjacent = (three.html.match(/<\/section><section class="msg msg-assistant"/g) || []).length;
  console.log('        three consecutive replies -> adjacent assistant sections=' + adjacent +
    ' (the + rule fires ' + adjacent + 'x)');
  assert(adjacent === 2, 'expected 2 adjacent assistant pairs, got ' + adjacent);
});

check('(al) the rendered share page is captured at 1180px wide', () => {
  const pngPath = join(outDir, 'share-page.png');
  if (!existsSync(pngPath)) {
    console.log('        ' + pngPath + ' 未生成（截图需要浏览器）：');
    console.log('        msedge --headless --disable-gpu --window-size=1180,H --screenshot=share-page.png file:///.../out/session-sample-omit.html');
    return;
  }
  const buffer = readFileSync(pngPath);
  assert(buffer.slice(1, 4).toString('latin1') === 'PNG', 'share-page.png is not a PNG file');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  console.log('        ' + pngPath + ' -> ' + width + 'x' + height + ' px, ' + buffer.length + ' bytes');
  assert(width === 1180, 'share page width is ' + width + ', expected 1180');
  assert(height > 600, 'share page height ' + height + ' is too short to show the timeline');
});

console.log('');
console.log('-------------------------------------------------------------');
console.log('stats: ' + JSON.stringify(stats));
console.log('output size: ' + fileSize + ' bytes');
console.log('passed ' + passed + ', failed ' + failed);
if (failed) {
  console.log('failures:');
  for (const failure of failures) console.log('  - ' + failure);
}
process.exitCode = failed ? 1 : 0;
