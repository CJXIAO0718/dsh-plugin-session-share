// 部署构建：npm run build（remote 模式）+ 清理演示数据。
// 演示快照 public/demo/ 不进入生产 dist/；openapi.yaml 保留。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// 个别 Windows 环境下 esbuild 清理系统 Temp 会被拒绝；统一改用项目内临时目录。
const tmpDir = resolve(root, '.tmp')
mkdirSync(tmpDir, { recursive: true })

const build = spawnSync('npm run build', {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, VITE_AUTH_MODE: 'remote', TMP: tmpDir, TEMP: tmpDir },
})
if (build.status !== 0) {
  console.error('[build:deploy] 构建失败，退出。')
  process.exit(build.status ?? 1)
}

const demoDir = resolve(root, 'dist', 'demo')
if (existsSync(demoDir)) {
  rmSync(demoDir, { recursive: true, force: true })
  console.log('[build:deploy] 已移除 dist/demo（演示数据不进入生产）。')
}

await import(pathToFileURL(resolve(root, 'scripts/precompress.mjs')).href)
console.log('[build:deploy] 完成。启动服务：node server/main.mjs')
