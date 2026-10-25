#!/usr/bin/env node
// Rebuilds market/index.json, the plugin market index (format 1) this repository publishes.
// Zero dependencies, Node >= 20. Run with --help for the options.
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT), '..');
const INDEX_FILE = path.join(ROOT, 'market', 'index.json');
// Only resolves relative icon references while validating; the published URL is wherever you deploy the file.
const PROBE_INDEX_URL = 'https://example.com/market/index.json';
// The DSH install this tool validates against. Node cannot read inside an asar, so the script re-runs itself
// under that install's Electron binary (ELECTRON_RUN_AS_NODE) when the module only exists there.
const DSH_ASAR = path.resolve(process.env.DSH_APP_ASAR || 'F:/Harness/resources/app.asar');
const VALIDATOR_INSIDE_ASAR = path.join(DSH_ASAR, 'dsh', 'node_modules', '@deepseek-ai', 'dsh-plugin-market-index', 'lib', 'index.js');
const REEXEC_ENV = 'DSH_MAKE_INDEX_REEXEC';

const USAGE = [
  'Usage: node tools/make-index.mjs [options]',
  '',
  '  --path <dir>          package directory inside the repository (subdirectory installs)',
  '  --url <url>           override the remote URL taken from origin',
  '  --title <text>        override the index title',
  '  --description <text>  override the index description',
  '  --check               validate market/index.json and print install specs, write nothing',
  '  --help                show this text',
  '',
  'Environment:',
  '  DSH_APP_ASAR              DSH install holding the market index validator',
  '  DSH_MARKET_INDEX_MODULE   explicit path to the validator module (wins over the install)',
].join('\n');

function die(code, message) {
  console.error('make-index: ' + message);
  process.exit(code);
}

function parseArgs(argv) {
  const options = { check: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    const equals = raw.startsWith('--') ? raw.indexOf('=') : -1;
    const flag = equals > 0 ? raw.slice(0, equals) : raw;
    const inline = equals > 0 ? raw.slice(equals + 1) : undefined;
    const take = () => {
      if (inline !== undefined) return inline;
      index += 1;
      if (index >= argv.length) die(2, flag + ' needs a value');
      return argv[index];
    };
    if (flag === '--path') options.path = take();
    else if (flag === '--url') options.url = take();
    else if (flag === '--title') options.title = take();
    else if (flag === '--description') options.description = take();
    else if (flag === '--check') options.check = true;
    else if (flag === '--help' || flag === '-h') options.help = true;
    else die(2, 'unknown argument ' + JSON.stringify(raw) + ' (try --help)');
  }
  return options;
}

function git(args) {
  try {
    return execFileSync('git', ['-C', ROOT].concat(args), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

// git@github.com:user/repo.git, ssh://git@host/user/repo.git and git://host/user/repo all become
// https://host/user/repo: format 1 requires a canonical https URL without credentials or a .git suffix.
function normalizeRemote(raw) {
  let text = String(raw).trim();
  const scp = /^[A-Za-z0-9._-]+@([^:/]+):(?!\/)(.+)$/.exec(text);
  if (scp) text = 'https://' + scp[1] + '/' + scp[2];
  else if (text.startsWith('ssh://')) {
    const ssh = new URL(text);
    text = 'https://' + ssh.hostname + ssh.pathname;
  } else if (text.startsWith('git://')) text = 'https://' + text.slice('git://'.length);
  else if (text.startsWith('http://')) text = 'https://' + text.slice('http://'.length);
  if (!text.startsWith('https://')) throw new Error('unsupported remote ' + raw + ': the index format requires https');
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error('remote ' + raw + ' is not a URL');
  }
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  let pathname = url.pathname.replace(/\/+$/, '');
  if (pathname.endsWith('.git')) pathname = pathname.slice(0, -'.git'.length);
  url.pathname = pathname;
  const segments = pathname.split('/').filter((segment) => segment !== '');
  if (segments.length < 2) throw new Error('remote ' + raw + ' must name a repository: https://host/owner/repo');
  return url.href;
}

function normalizePackagePath(raw) {
  const text = String(raw).trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (text === '') return undefined;
  if (text.split('/').some((segment) => segment === '.' || segment === '..')) die(2, '--path must not contain . or .. segments');
  return text;
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function versionKey(text) {
  const match = SEMVER.exec(String(text));
  if (!match) return undefined;
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  };
}

// SemVer 2.0.0 precedence; entries that are not exact versions keep their relative order.
function compareVersions(left, right) {
  const a = versionKey(left);
  const b = versionKey(right);
  if (a === undefined || b === undefined) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] - b.numbers[index];
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const x = a.prerelease[index];
    const y = b.prerelease[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) {
      if (Number(x) !== Number(y)) return Number(x) - Number(y);
    } else if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

async function loadValidator() {
  const candidates = [
    process.env.DSH_MARKET_INDEX_MODULE,
    path.join(ROOT, 'node_modules', '@deepseek-ai', 'dsh-plugin-market-index', 'lib', 'index.js'),
    VALIDATOR_INSIDE_ASAR,
  ].filter((candidate) => typeof candidate === 'string' && candidate !== '');
  const failures = [];
  for (const candidate of candidates) {
    try {
      const module = await import(pathToFileURL(candidate).href);
      if (typeof module.parseMarketIndex !== 'function' || typeof module.marketInstallTarget !== 'function') {
        failures.push(candidate + ': does not export parseMarketIndex/marketInstallTarget');
        continue;
      }
      return { module, from: candidate };
    } catch (error) {
      failures.push(candidate + ': ' + (error && error.code ? error.code : String(error).split('\n')[0]));
    }
  }
  return { failures };
}

function findElectron() {
  const appRoot = path.dirname(path.dirname(DSH_ASAR));
  let entries;
  try {
    entries = readdirSync(appRoot);
  } catch {
    return undefined;
  }
  const executables = entries.filter((entry) => /\.exe$/i.test(entry) && !/^uninstall/i.test(entry));
  if (executables.length === 0) return undefined;
  const preferred = executables.find((entry) => /harness/i.test(entry));
  return path.join(appRoot, preferred === undefined ? executables[0] : preferred);
}

function reexecUnderElectron(failures) {
  const electron = findElectron();
  if (electron === undefined) {
    die(2, 'cannot load the market index validator and found no Electron binary beside ' + DSH_ASAR + '\n  ' + failures.join('\n  '));
  }
  console.error('make-index: validator lives inside ' + path.basename(DSH_ASAR) + ', re-running under ' + path.basename(electron));
  const env = Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' });
  env[REEXEC_ENV] = '1';
  const child = spawnSync(electron, [SCRIPT].concat(process.argv.slice(2)), { stdio: 'inherit', env });
  if (child.error) die(2, 're-run failed: ' + child.error.message);
  process.exit(child.status === null ? 2 : child.status);
}

function defaultTitle(pkgName) {
  return pkgName + ' 市场';
}

async function readOrCreateIndex(pkg, options) {
  let text;
  try {
    text = await readFile(INDEX_FILE, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') die(1, 'cannot read ' + path.relative(ROOT, INDEX_FILE) + ': ' + error.message);
  }
  let existing;
  if (text !== undefined) {
    try {
      existing = JSON.parse(text);
    } catch (error) {
      die(1, path.relative(ROOT, INDEX_FILE) + ' is not valid JSON, refusing to overwrite it: ' + error.message);
    }
  }
  if (existing !== undefined && typeof existing === 'object' && existing !== null && !Array.isArray(existing)) {
    if (existing.format !== 1) die(1, path.relative(ROOT, INDEX_FILE) + ': "format" must be 1');
    if (existing.plugins !== undefined && !Array.isArray(existing.plugins)) die(1, path.relative(ROOT, INDEX_FILE) + ': "plugins" must be an array');
    if (existing.plugins === undefined) existing.plugins = [];
    if (existing.title === undefined) existing.title = options.title === undefined ? defaultTitle(pkg.name) : options.title;
    if (options.title !== undefined) existing.title = options.title;
    if (options.description !== undefined) existing.description = options.description;
    if (existing.metadata === undefined || existing.metadata === null || typeof existing.metadata !== 'object' || Array.isArray(existing.metadata)) existing.metadata = {};
    return existing;
  }
  const created = { format: 1, title: options.title === undefined ? defaultTitle(pkg.name) : options.title };
  const description = options.description === undefined ? pkg.description : options.description;
  if (typeof description === 'string' && description.trim() !== '') created.description = description;
  created.metadata = {};
  created.plugins = [];
  return created;
}

function ensurePlugin(index, pkg) {
  let plugin = index.plugins.find((entry) => entry !== null && typeof entry === 'object' && entry.name === pkg.name);
  if (plugin === undefined) {
    plugin = { name: pkg.name };
    if (typeof pkg.description === 'string' && pkg.description.trim() !== '') plugin.description = pkg.description;
    plugin.versions = [];
    index.plugins.push(plugin);
  }
  if (!Array.isArray(plugin.versions)) plugin.versions = [];
  if (plugin.description === undefined && typeof pkg.description === 'string' && pkg.description.trim() !== '') plugin.description = pkg.description;
  return plugin;
}

function validateAndReport(text, module) {
  const { parseMarketIndex, marketInstallTarget } = module;
  let document;
  try {
    document = JSON.parse(text);
  } catch (error) {
    die(1, 'index is not valid JSON: ' + error.message);
  }
  let parsed;
  try {
    parsed = parseMarketIndex(document, PROBE_INDEX_URL);
  } catch (error) {
    if (error && error.name === 'MarketIndexError') die(1, 'parseMarketIndex rejected the index: ' + error.path + ' ' + error.reason);
    throw error;
  }
  console.log('parseMarketIndex 通过 (' + PROBE_INDEX_URL + ')');
  for (const plugin of parsed.plugins) {
    for (const version of plugin.versions) {
      const target = marketInstallTarget(plugin.name, version);
      const registry = target.registry === undefined ? '' : '  [registry ' + target.registry + ']';
      console.log('  ' + plugin.name + '@' + version.version + ' -> ' + target.spec + registry);
    }
  }
  return parsed;
}

async function runCheck(options, pkg, module) {
  let text;
  try {
    text = await readFile(INDEX_FILE, 'utf8');
  } catch {
    die(1, 'no ' + path.relative(ROOT, INDEX_FILE) + ' yet: run node tools/make-index.mjs first');
  }
  const parsed = validateAndReport(text, module);

  const head = git(['rev-parse', 'HEAD']);
  if (!/^[0-9a-f]{40}$/.test(head)) {
    console.log('note: not a git checkout, skipped the commit/HEAD comparison');
  } else {
    const plugin = parsed.plugins.find((entry) => entry.name === pkg.name);
    const version = plugin === undefined ? undefined : plugin.versions.find((entry) => entry.version === pkg.version);
    if (version === undefined) console.log('warn: the index has no ' + pkg.name + '@' + pkg.version + ' entry, re-run without --check');
    else if (version.source.commit !== head) console.log('warn: the index pins ' + version.source.commit.slice(0, 12) + ' but HEAD is ' + head.slice(0, 12) + ', re-run without --check');
    const remoteRaw = options.url === undefined ? git(['config', '--get', 'remote.origin.url']) : options.url;
    if (remoteRaw !== '' && version !== undefined) {
      let remote;
      try {
        remote = normalizeRemote(remoteRaw);
      } catch (error) {
        remote = undefined;
        console.log('warn: ' + error.message);
      }
      if (remote !== undefined && remote !== version.source.url) console.log('warn: the index points at ' + version.source.url + ' but origin is ' + remote);
    }
  }
  console.log('check only: ' + path.relative(ROOT, INDEX_FILE) + ' untouched');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  const loaded = await loadValidator();
  if (loaded.module === undefined) {
    if (process.env[REEXEC_ENV] === '1') die(2, 'the validator still does not load:\n  ' + loaded.failures.join('\n  '));
    reexecUnderElectron(loaded.failures);
    return;
  }
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  if (options.check) {
    await runCheck(options, pkg, loaded.module);
    return;
  }

  const head = git(['rev-parse', 'HEAD']);
  if (!/^[0-9a-f]{40}$/.test(head)) die(2, 'no git HEAD in ' + ROOT + ': commit the release before generating the index');
  const remoteRaw = options.url === undefined ? git(['config', '--get', 'remote.origin.url']) : options.url;
  if (remoteRaw === '') die(2, 'no remote: origin is unset, pass --url <https://github.com/owner/repo>');
  let remote;
  try {
    remote = normalizeRemote(remoteRaw);
  } catch (error) {
    die(2, error.message);
  }
  const packagePath = options.path === undefined ? undefined : normalizePackagePath(options.path);

  const index = await readOrCreateIndex(pkg, options);
  const plugin = ensurePlugin(index, pkg);
  const source = { type: 'git', url: remote, commit: head };
  if (packagePath !== undefined) source.path = packagePath;
  const existing = plugin.versions.find((entry) => entry !== null && typeof entry === 'object' && entry.version === pkg.version);
  if (existing === undefined) plugin.versions.push({ version: pkg.version, publishTimestamp: Math.floor(Date.now() / 1000), source });
  else existing.source = source;
  plugin.versions.sort((left, right) => compareVersions(right.version, left.version));
  delete index._placeholder;

  const text = JSON.stringify(index, null, 2) + '\n';
  validateAndReport(text, loaded.module);
  await mkdir(path.dirname(INDEX_FILE), { recursive: true });
  await writeFile(INDEX_FILE, text, 'utf8');
  console.log('wrote ' + path.relative(ROOT, INDEX_FILE) + ': ' + pkg.name + '@' + pkg.version + ' -> ' + head.slice(0, 12) + ' from ' + remote);
  console.log('validator: ' + loaded.from);
  validateAndReport(await readFile(INDEX_FILE, 'utf8'), loaded.module);
}

await main();
