// lib/redact.js - deterministic, dependency-free redactor.
// Rule order matters: user paths (wide -> narrow), then key/value secrets, then tokens.
// Every placeholder (%USERPROFILE%, ~, [REDACTED*]) is built from characters that no rule
// matches, so redacting the same text twice yields byte-identical output (idempotent).
// No node:crypto / no randomness: output is a pure function of the input.

const USER_PROFILE = '%USERPROFILE%';
const HOME = '~';

export const DEFAULT_RULES = [
  // Windows profile: C:\Users\name, C:/Users/name, with any back/forward slash mix.
  {
    id: 'windows-user-profile',
    pattern: /[A-Za-z]:(?:\\+|\/+)Users(?:\\+|\/)[^\\/\s"'<>|*?,;:&]+/gi,
    replacement: USER_PROFILE,
  },
  // Git-bash / MSYS style: /c/Users/name
  {
    id: 'msys-user-profile',
    pattern: /\/[cC]\/Users\/[^\/\s"'<>|*?,;:&]+/g,
    replacement: USER_PROFILE,
  },
  // macOS: /Users/name
  {
    id: 'macos-user-home',
    pattern: /\/Users\/[^\/\s"'<>|*?,;:&]+/g,
    replacement: HOME,
  },
  // Linux: /home/name
  {
    id: 'posix-home',
    pattern: /\/home\/[^\/\s"'<>|*?,;:&]+/g,
    replacement: HOME,
  },
  // "password": "..." / password=... / 'api_key': '...'
  {
    id: 'secret-key-value-quoted',
    // group 1 = key prefix, group 2 = value quote, group 3 = value
    pattern: /((["']?)(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\2\s*[:=]\s*)(["'])(?!\[REDACTED\]\3)([^"'\r\n]{1,200})\3/gi,
    replacement: '$1$3[REDACTED]$3',
  },
  // Bare form: password=hunter2 / api_key: abc123
  {
    id: 'secret-key-value-bare',
    pattern: /(\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*)(?!\[REDACTED\]|["'])[^\s"'&;,\r\n]{4,}/gi,
    replacement: '$1[REDACTED]',
  },
  { id: 'bearer-token', pattern: /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}=*/g, replacement: 'Bearer [REDACTED:bearer]' },
  { id: 'openai-style-key', pattern: /\bsk-[A-Za-z0-9_-]{16,}/g, replacement: '[REDACTED:sk]' },
  { id: 'github-token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}\b/g, replacement: '[REDACTED:github]' },
  { id: 'github-fine-grained-token', pattern: /\bgithub_pat_[A-Za-z0-9_]{16,}\b/g, replacement: '[REDACTED:github]' },
  { id: 'aws-access-key-id', pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[REDACTED:aws]' },
  { id: 'slack-token', pattern: /\bxox[bap]-[A-Za-z0-9-]{10,}/g, replacement: '[REDACTED:slack]' },
];

// A username only becomes a redaction literal when it is long enough to be meaningful
// and is not a word that occurs in ordinary prose. The flattened-path rules are always
// safe (they are anchored on "-Users-"/"-home-") so they are enabled unconditionally.
const COMMON_WORDS = [
  'user', 'users', 'home', 'admin', 'work', 'test', 'tmp', 'temp', 'root', 'guest',
  'public', 'shared', 'default', 'desktop', 'documents', 'downloads', 'local', 'main',
  'data', 'code', 'node', 'dev', 'dsh', 'src', 'lib', 'app', 'name', 'system', 'files',
  'windows', 'program', 'me', 'pc', 'my', 'and', 'the', 'true', 'false', 'null',
];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^$(){}|[\]\\-]/g, '\\$&');
}

// Derived strictly from the caller-supplied identity (never from the environment).
// DSH flattens workspace paths into directory names by swapping separators for
// hyphens: C:\Users\<name>\Documents\x becomes --C-Users-<name>-Documents-x--.
// The standard path rules cannot see those, so the name itself must be redacted too.
function identityRules(usernames) {
  const list = Array.isArray(usernames) ? usernames : usernames ? [usernames] : [];
  const rules = [];
  const seen = Object.create(null);
  for (let i = 0; i < list.length; i += 1) {
    const raw = typeof list[i] === 'string' ? list[i].trim() : '';
    if (raw.length < 2) continue;
    const key = raw.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    const literal = escapeRegExp(raw);
    rules.push({
      id: 'flattened-users-' + key,
      pattern: new RegExp('-Users-' + literal + '(?=[-.\\\\/]|$)', 'gi'),
      replacement: '-Users-%USERNAME%',
    });
    rules.push({
      id: 'flattened-home-' + key,
      pattern: new RegExp('-home-' + literal + '(?=[-.\\\\/]|$)', 'gi'),
      replacement: '-home-%USERNAME%',
    });
    if (COMMON_WORDS.indexOf(key) === -1) {
      rules.push({
        id: 'literal-username-' + key,
        pattern: new RegExp('\\b' + literal + '\\b', 'gi'),
        replacement: '%USERNAME%',
      });
      // \b cannot see the boundaries that matter inside an identifier: in
      // "username_<name>", "-<name>-" or "<name>_x" the name sits next to a letter, an
      // underscore or a hyphen - all word characters on a digit's side - so the plain
      // literal rule above never fires. Digits are excluded on both sides on purpose:
      // a longer number that merely contains the name (a timestamp such as
      // 1792785315954) must never be damaged, so a pure digit run stays untouched.
      rules.push({
        id: 'identifier-prefixed-username-' + key,
        pattern: new RegExp('([A-Za-z_-])' + literal, 'gi'),
        replacement: '$1%USERNAME%',
      });
      rules.push({
        id: 'identifier-suffixed-username-' + key,
        pattern: new RegExp(literal + '(?=[A-Za-z_-])', 'gi'),
        replacement: '%USERNAME%',
      });
    }
  }
  return rules;
}

function expand(template, match, groups) {
  if (template.indexOf('$') === -1) return template;
  return template.replace(/\$(\d)/g, (all, digit) => {
    const g = groups[Number(digit) - 1];
    return g == null ? '' : g;
  });
}

export function createRedactor(options = {}) {
  const enabled = !options || options.enabled !== false;
  const activeRules = DEFAULT_RULES.concat(identityRules(options && options.usernames));
  const patterns = activeRules.map((rule) => rule.pattern);
  let count = 0;

  function text(input) {
    if (input == null) return '';
    let value = typeof input === 'string' ? input : String(input);
    if (!enabled || value === '') return value;
    for (let i = 0; i < activeRules.length; i++) {
      const rule = activeRules[i];
      value = value.replace(rule.pattern, (...args) => {
        count += 1;
        const groups = args.slice(1, args.length - 2);
        return expand(rule.replacement, args[0], groups);
      });
    }
    return value;
  }

  return {
    text,
    get redactedCount() {
      return count;
    },
    patterns,
    reset() {
      count = 0;
    },
  };
}
