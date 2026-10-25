# dsh-plugin-session-share

把任意一个 DSH 会话导出成**单文件、离线可打开**的 HTML 分享页（含时间线、折叠的工具调用、脱敏）。

- 生成物是一份自包含 HTML：不依赖 JS/CDN/字体，双击就能读，可以直接发给别人。
- 排版由 `lib/render.js` 负责；共享配置项见「配置项」。

---

## ⚠ 已知致命风险（装之前先读）

这个插件的客户端部分是**半包（bundle）**：加载失败不是静默的，而是会让 **web boot 直接拒绝启动——整个 DSH 打不开**。这不是理论风险，本项目真实发生过一次。

现场日志原文（`%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-*-web-boot.log`）：

```text
--- error ---
Error: web boot: 1 entry did not activate
dsh-plugin-session-share: import failed (see console for the import error)

--- renderer console (error level, oldest first) ---
Uncaught Error: client-modules: duplicate factory registration for "share-html" (bundle executed twice without invalidate?)
Error: web boot: 1 entry did not activate
dsh-plugin-session-share: import failed (see console for the import error)
```

根因见文末「开发者须知：模块 id 必须等于包名」，已修复。

**应急三步（DSH 已经打不开时）：**

1. **完全关闭 DSH**（包括托盘图标，确认进程退出）；
2. **双击 `如果DSH起不来-双击我.cmd`**（推荐：它内部带 `-ExecutionPolicy Bypass`，能绕过「未签名脚本」拦截）——它会把 `cordis.patch.yml` 回滚到安装前的备份；
   若双击这个 .cmd 仍被拦，再改双击 `restore-if-broken.ps1`（或右键 → 使用 PowerShell 运行）；
   想先看它会选哪份：`如果DSH起不来-双击我.cmd -ListOnly`
3. **重新启动 DSH**，应能正常打开。

等价做法（能开 PowerShell 就行）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall
```

> 两个脚本都**不会**动你的会话、工作区或任何数据，只改 `cordis.patch.yml` 一个文件；改之前都会再备份一份（`bak-before-restore-*`）。

---

## 安装 / 卸载（一条命令）

前提：Windows PowerShell 5.1（系统自带）即可；插件包已解压到本机任意目录。

```powershell
# 安装到默认 profile（C:\Users\<你>\.dsh\profiles\desktop）
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1

# 只看看会写什么，不落盘
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -WhatIf

# 装到别的 profile / 别的插件目录
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -ProfileDir 'D:\...\profiles\desktop' -PluginDir 'D:\...\dsh-plugin-session-share'

# 卸载（按 id 删除条目，同样会备份）
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall
```

参数：`-ProfileDir`（默认值是脚本里写死的一条示例路径，等价于 `$env:USERPROFILE\.dsh\profiles\desktop`；**换机器安装时请显式传这个参数**，否则会指向你本机不存在的目录）、`-PluginDir`（默认脚本所在目录）、`-Uninstall`、`-WhatIf`。

脚本做的事：

1. 校验 `<PluginDir>\lib\index.js` 存在（不存在直接报错退出，绝不写坏配置）；
2. 把插件目录转成绝对路径，生成 `file:///` URL（正斜杠，空格与非 ASCII 按 UTF-8 百分号编码）；
3. 读现有 `<ProfileDir>\cordis.patch.yml`，**先删掉同 id 现有条目再追加**（幂等：连跑两次只有一条）；
4. 备份为 `cordis.patch.yml.bak-<yyyyMMdd-HHmmss>`，完整内容先写临时文件再替换目标文件；
5. 回读校验并打印最终条目，然后自动跑 `dsh --profile <名字> --dump-config` 做自检（PASS/FAIL）。

写入的条目长这样（顶层数组末尾，`insert` 形式）：

```yaml
- insert:
    - id: session-share-html
      name: 'file:///C:/Users/.../dsh-plugin-session-share/lib/index.js'
      config: {}
```

---

## 安装后验证（顺序别搞反）

**正确顺序：关闭 DSH → 安装 → 启动 DSH → 检查。**

1. **先完全关闭 DSH**（含托盘退出）。首次挂载新的客户端插件必须在「进程启动时」完成，见下面 HMR 说明。
2. 运行 `install.ps1`（它自带 `--dump-config` 自检；桌面端开着这条命令会被拒绝，那只是提示，不是安装失败）。
3. **启动 DSH 桌面端** → 设置 → 插件（plugin_manager）页 → 找到 id = `session-share-html`，确认 **phase 显示 active**。
4. 打开任意会话，对话头部应出现「**分享为 HTML**」按钮；点它 → 预览 / 下载能出页面即算通过。

**关于 HMR 的边界（很容易误判）：**

- 改**代码**、改**配置**（比如 `cordis.patch.yml`）：在**当前进程内**热更新生效，不用重启；
- **首次挂载一个新的客户端插件**（本插件就属于这种）：需要**重启 DSH** 才能在界面上看到入口。热更新只会重新求值已有模块，不会重新注册新的 client bundle 工厂。
- 因此 `install.ps1` 结尾那句「桌面端 HMR 会自动重载、不需要重启」只覆盖配置层；**看到入口这件事仍以「重启后出现在会话头部」为准**。重启后仍然看不到，才是真正的配置 / 加载问题（见「故障排查」）。

---

## 发布与分发（GitHub 仓库 + 市场索引，不发 npm）

本插件**不发布到 npm**。分发链路只有一条：GitHub 仓库 + 一份你自己托管的**市场索引** JSON —— 索引把每个版本号钉死在仓库的某一个 commit 上，所以「代码在 GitHub 上」本身并不等于「别人能在市场里搜到」。

完整发版流程（索引结构、每版要跑的命令、校验与排错）见 [docs/publish.md](docs/publish.md)。

### 别人怎么装

**① 插件页按 git URL 安装（pnpm 直接从 git 拉）**

安装串本身就是一条 pnpm spec：

```text
git+https://github.com/<your-account>/dsh-plugin-session-share.git#<40 位 commit>
```

把这条串交给插件管理器的安装入口；或者在 profile 目录里自己执行：

```bash
pnpm add "git+https://github.com/<your-account>/dsh-plugin-session-share.git#<40 位 commit>"
```

> 建议钉 `#<40 位 commit>` 而不是 `#main`：分支会漂移，插件重装一次行为就跟着变。

**② 添加市场索引 URL**

DSH 的市场服务只读你配置的 `indexes`（默认空数组，空着时一个请求都不会发）。把托管好的索引 JSON 地址加进去之后：插件 → 发现 → 搜索 `dsh-plugin-session-share` → 安装。

### 发布前必须替换的占位符

- `package.json` 的 `repository.url`：占位符是 `https://github.com/<your-account>/dsh-plugin-session-share`，首次发版前换成真实仓库地址；
- 市场索引里的 `OWNER` 与全 0 的 commit（见 `docs/publish.md`），用 `node tools/make-index.mjs` 重新生成。

### 分发物里有什么（`files` 白名单）

`files` 只放行 `lib`、`locale`、`cordis.patch.yml`、`README.zh.md`、`LICENSE`；`test/`、`tools/`、`docs/`、`*.ps1`、`.dsh-share/` 一律不进包。这既是将来上 npm 时的白名单，也让 `pnpm pack` 打出来的东西里不可能出现测试夹具，更不可能出现任何真实会话数据。

---

## 四种用法

| 用法 | 怎么做 | 适合 |
| --- | --- | --- |
| 会话头部按钮 | 在对话头部点「分享为 HTML」→ 预览 / 下载 | 手边就是那个会话 |
| `/share` 命令 | 在输入框敲 `/share`（可加 `download`） | 只想快速拿到链接 |
| 离线 CLI | `node tools/render-session.mjs --log <日志> --out <out.html>` | 批量、脚本、AI 调用、无桌面端 |
| 挑选部分对话 | 分享菜单第三项「选择对话后分享…」勾几条 → 预览 / 下载；或 CLI `--pick m12,m13` | 会话很长，只想发其中一两句 |

### 1）会话头部按钮

点「分享为 HTML」，菜单里有「预览」（新窗口打开）和「下载」。渲染在本地完成，不上传任何内容。

### 2）`/share` 命令

```
/share            生成可预览的分享链接
/share download   生成可直接下载的链接
```

### 3）离线 CLI（AI 可调用）

```bash
node tools/render-session.mjs --log <session.v4.jsonl.zstd 或 .jsonl> --out <out.html> [--reasoning omit|count|full] [--pick m12,m13] [--no-redact] [--title "标题"]
```

- 零外部依赖，唯一 import 是 `../lib/render.js`；被 `import` 复用时不执行 CLI。
- 直接支持 DSH 的 `session.v4.jsonl.zstd`：它是**多个 zstd 帧顺序拼接**，CLI 按魔数 `28 b5 2f fd` 逐帧解压；也支持未压缩的 `.jsonl`。
- 成功时 stdout 只打印一行 JSON：

```json
{"out":"C:\\...\\out.html","bytes":271869,"stats":{"events":258,"redact":true,"userMessages":11,"assistantMessages":29,"toolCalls":24,"redacted":54}}
```

- `--reasoning` 控制思考过程：`omit`（默认，不显示）/ `count`（每个回合只留一行「思考 N 段 · 已省略」）/ `full`（全文展开）。stdout JSON 的 `stats.reasoning` 会回显实际使用的值；非法值 → stderr 一行中文 + **退出码 2**。

@B3@bash
# 只想看对话、但想知道这一轮思考了多少：count
node tools/render-session.mjs --log session.v4.jsonl.zstd --out out.html --reasoning count
@B3@

- 失败时 stderr 一行中文错误 + 退出码 1（文件不存在 / 非 zstd / 无事件 / 渲染抛错）；参数非法（如 `--reasoning bogus`、`--pick m12,abc`）是退出码 2。

会话日志默认在 `%USERPROFILE%\.dsh\sessions\<工作目录编码>\<session-id>\session.v4.jsonl.zstd`。

### 4）选择部分对话后分享

会话太长时，把整份导出发出去既不方便也不安全。这一种用法只把**你勾选的几条消息**发给别人。

**入口**：会话头部的分享菜单 → 第三项「**选择对话后分享…**」（英文：Select messages to share…）。

1. 点它打开选择浮层，列表由接口 `GET /api/session.shareIndex?sessionId=<id>` 提供，每行是：勾选框 + 角色（你 / DeepSeek）+ 单行摘录（+ 时间）。
2. 工具栏可以「全选 / 全不选」，并显示「已选 N 条」。
3. 底部「生成预览」= `GET /api/session.shareHtml?sessionId=<id>&pick=m12,m13`，复用原来的预览浮层；预览浮层里新增「下载」按钮（实际请求会再带 `&download=1`）。

> **摘录在服务端就已脱敏**：列表里的单行摘录是渲染前由 `lib/render.js` 算好的（走过同一套脱敏规则、去掉 markdown 标记、压成一行、最多 80 字），不是浏览器里再截的原文。

**条目 id 是稳定的**：`m` + 该消息在会话事件流里的序号，例如 `m12`。它**只跟这条消息本身绑定，与它在页面里的位置无关**——重新渲染、换 `--reasoning` 选项、换主题都不会改变 id，所以「同一份页面里只想发一两句」时可以直接记下 id 复用。

**CLI 用法**：

```bash
# 只想发两条：--pick 用逗号分隔条目 id；不传 = 全部（原来的行为）
node tools/render-session.mjs --log session.v4.jsonl.zstd --out out.html --pick m12,m13
```

- id 格式是 `m<序号>`，整体必须匹配 `^m\d+(,m\d+)*$`；空值或非法值 → stderr 一行中文 + **退出码 2**。
- 命不中的 id 直接忽略（不报错）；选中集合为空（例如 `--pick m999999` 全不命中）会输出「未选择任何消息」的空页，不是崩溃。
- stdout 一行 JSON 里 `stats.picked` = 实际渲染出来的条目数，`stats.totalEntries` = 这份会话里可分享的条目总数（两个数字都由渲染器回显）。
- 端口路由同理：`GET /api/session.shareIndex` 返回 `{ sessionId, title, total, entries }`；`GET|HEAD /api/session.shareHtml?...&pick=` 里非法项会被丢弃、最多 500 项。
- 只挑选条目不改变其它规则：某轮只要有 ≥1 条被选中的消息，这一轮的内联上下文灰卡与工具调用行**仍然照旧出现**（否则整轮不出现）；脱敏、折叠、`--reasoning` 全部照旧。

---

## 配置项

插件条目里的 `config`（`lib/index.js` 读取）：

| 键 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| `theme` | `auto` \| `light` \| `dark` | `auto` | 分享页初始主题，右上角按钮可切换 |
| `redact` | `true` \| `false` | `true` | 脱敏总开关；`false` = 关闭脱敏（原样输出，慎用） |

```yaml
- insert:
    - id: session-share-html
      name: 'file:///C:/.../dsh-plugin-session-share/lib/index.js'
      config:
        theme: light
        redact: true
```

离线 CLI 用 `--no-redact` 关闭脱敏，用 `--title` 覆盖标题。

另外暴露：路由 `GET /api/session.shareHtml`（支持 `&pick=m12,m13`、`&download=1`）、路由 `GET /api/session.shareIndex`（挑选浮层的条目列表）、命令 `/share`、工具 `share_conversation_html`（写文件到会话 cwd 下的 `.dsh-share/`）。

---

## 脱敏规则（默认开启）

规则是确定性的纯文本替换（同一输入永远得到同一输出，可重复执行）：

| # | 规则 | 命中示例 | 替换为 |
| --- | --- | --- | --- |
| 1 | Windows 用户目录 | `C:\Users\alice\...` | `%USERPROFILE%` |
| 2 | MSYS/Git-bash | `/c/Users/alice/...` | `%USERPROFILE%` |
| 3 | macOS 家目录 | `/Users/alice/...` | `~` |
| 4 | Linux 家目录 | `/home/alice/...` | `~` |
| 5 | 带引号的密钥键值 | `"password": "hunter2"` | 值替换为 `[REDACTED]` |
| 6 | 裸密钥键值 | `api_key=abc123` | 值替换为 `[REDACTED]` |
| 7 | Bearer Token | `Bearer eyJhbGci...` | `Bearer [REDACTED:bearer]` |
| 8 | OpenAI 风格 Key | `sk-xxxx...` | `[REDACTED:sk]` |
| 9 | GitHub Token | `ghp_xxx` / `gho_` / `ghu_` / `ghs_` / `ghr_` | `[REDACTED:github]` |
| 10 | GitHub 细粒度 Token | `github_pat_xxx` | `[REDACTED:github]` |
| 11 | AWS Access Key ID | `AKIA...` | `[REDACTED:aws]` |
| 12 | Slack Token | `xoxb-...` / `xoxa-` / `xoxp-` | `[REDACTED:slack]` |

关闭方式：插件 `config.redact: false`，或 CLI 加 `--no-redact`。页头会显示「已脱敏 N 处」，数字来自实际替换次数。

---

## 内联上下文的识别与折叠

分享页的主体是**真人对话**。会话里还有大量并非用户发言的内容——`system-reminder`、运行时环境、工具清单、子代理汇报、`Working Context` 等。它们默认折叠成每轮一条灰色小卡「内联上下文 · N 条 ▸」，展开后是逐字保留的原文（只做脱敏与 HTML 转义，不过 markdown）。

识别有两条路径，按优先级：

1. **结构信号（优先）**：`user/message` 的 `data.source.kind`。`kind === "user"` 才是真人发言（此时即使正文以 `<system-reminder>` 开头也仍然算用户气泡）；其它取值（实测见过 `runtime-context`、`skill-catalog`、`liangshen-tool-catalog`、`liangshen-working-context`、`agent-message`、`subagent-settled`）一律进灰卡。
2. **标记清单（兜底）**：仅当 `source.kind` 缺失时使用，且只匹配**消息开头前缀**，避免正文里提到这些词被误判。清单是 `lib/render.js` 里的 `CONTEXT_MARKERS` 常量：

   ```text
   system-reminder / environment_context / Current runtime context /
   Current working directory: / [Working Context: / available_tools /
   The following tools are available… / 【环境事实 / 【项目根】 / 【任务】 /
   sent a message: / Background subagent
   ```

遇到新的注入形态，往 `CONTEXT_MARKERS` 追加一条前缀即可；若新版 DSH 给了新的 `source.kind`，两者都不用改（结构信号优先）。

## 隐私警告（请务必读）

> **这是「脱敏」，不是「匿名化」。** 生成的 HTML 里依然是**完整对话正文**：你说过的需求、贴过的代码、文件路径、命令输出、用户名、内网地址、业务数据……脱敏只覆盖上表那十几类模式。
>
> 发出去之前，请自己打开 HTML 扫一眼（尤其是粘贴过日志 / 配置 / 密钥的会话）。不确定就别发，或者先删掉敏感会话段再导出。

单文件 HTML 不联网、无外部资源，但**文件本身自带全部内容**——转发即等于公开。

---

## 已知限制

- 只在 Windows + PowerShell 5.1 上验证过这两个 `*.ps1`；它们**必须保存为 UTF-8 with BOM**，否则 5.1 会按 ANSI 解码中文而报语法错误。
- `.zstd` 解码依赖 Node 内置 zstd（Node >= 22.15 才有 `zlib.zstdDecompressSync`）；Node 20 上只能喂未压缩的 `.jsonl`。CLI 遇到无 zstd 的 Node 会直接给出中文提示。
- 桌面端运行中，`dsh --profile desktop --dump-config` 会被拒绝（`profile is managed exclusively by the Electron application`）；这不是配置错误，插件页看到 `phase=active` 即可。
- 分享页是静态快照：生成之后会话再变化不会自动更新。
- 子代理正文不展开：内部事件（ptc 派发、subagent 目录等）只按类型计数折叠。
- 主题跟随系统的能力取决于浏览器 `prefers-color-scheme`。
- `tools/read-session-log.mjs` 是调试脚本，它的「是否作为入口执行」判断在**含非 ASCII 的路径**下不触发（本仓库路径带中文），直接 `node tools/read-session-log.mjs` 会静默什么都不做；需要时改用 `tools/render-session.mjs`（它用 `fileURLToPath` 正确判断，且可按模块 import）。
- `restore-if-broken.ps1` 只能恢复「有备份」的情形；从没安装 / 从没备份过的配置它无从恢复，此时用 `install.ps1 -Uninstall`。

---

## 故障排查

**0. DSH 根本打不开（web boot 卡住 / 闪退）**

先看 `%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-*-web-boot.log`，若出现 `duplicate factory registration` 或 `entry did not activate`：
完全关闭 DSH → 双击 `如果DSH起不来-双击我.cmd` → 重启。详见文首「已知致命风险」。

**1. 插件页看不到 / 不是 active**

桌面端 → 设置 → 插件（plugin_manager）页，找 id = `session-share-html`：

- 没有这个 id：`cordis.patch.yml` 没写进去，或写成了裸行（裸行会被 warn 后丢弃）。用 `install.ps1 -WhatIf` 看应该写什么，再重跑安装。
- 有 id 但 phase 不是 active：把插件页的报错文案和浏览器控制台（下一条）发出来，多半是 `lib/index.js` 路径 / 加载失败。
- 有 id 且 active 但**界面没有按钮**：很可能只是没重启——客户端插件首次挂载要重启进程。

**2. `--dump-config` 自检**

```powershell
<dsh-cli> --profile desktop --dump-config
```

- `<dsh-cli>` 是 DSH 桌面安装目录下的 `resources/runtime/cli/bin/dsh.cmd`（Windows）。
- 自检是**可选**的：`install.ps1` 按 `-DshCli` → 环境变量 `DSH_CLI` → `PATH` → 常见安装位置 依次探测；都找不到时会打印「未找到 dsh CLI，跳过 --dump-config 自检（不影响安装）」并照常完成安装。
- 想强制指定：`install.ps1 -DshCli "<你的 dsh.cmd 路径>"`。
- 打印合成后的条目并报告「未匹配 patch」。
- 桌面端运行时会整条命令被拒绝，属正常；关掉桌面端再跑即可。
- 输出里搜 `session-share-html`：有 = 配置生效。

**3. 按钮点了报「分享失败」/ 一直转圈**

打开浏览器 DevTools → Console 和 Network：

- `GET /api/session.shareHtml?...` 404/500：插件没加载（回到第 1 步）或渲染抛错（服务端日志会有 `[session-share-html]` 前缀的 warn）。
- 预览空白但下载成功：浏览器拦截弹窗，允许弹窗或直接用下载。

**4. 回滚**

安装 / 卸载 / 恢复都会先备份，文件名形如 `cordis.patch.yml.bak-20261024-034631`：

```powershell
Copy-Item -LiteralPath '<ProfileDir>\cordis.patch.yml.bak-20261024-034631' -Destination '<ProfileDir>\cordis.patch.yml' -Force
```

或者直接 `.\restore-if-broken.ps1 -ListOnly` 看看有哪些备份、会选哪一份，再决定。

**5. 手工删条目**

在 `cordis.patch.yml` 顶层数组里删掉整个

```yaml
- insert:
    - id: session-share-html
      ...
```

块（若该 `insert:` 下还有别的插件，只删 `- id: session-share-html` 那一项）。别把同层的别的条目一起删掉。

---

## 开发者须知：模块 id 必须等于包名

客户端 bundle 里 `window.__ModuleLoader__.load({ id })` 的 `id` **必须等于 package.json 的包名**（本项目：`dsh-plugin-session-share`）。

它和插槽贡献 id 是**两回事**，别混用：

| 位置 | 作用 | 本项目取值 |
| --- | --- | --- |
| `window.__ModuleLoader__.load({ id })` | 给**整个 client bundle** 建档，加载器按**包名**登记 | `dsh-plugin-session-share` |
| `ctx.slots.register({ id })` | 往某个插槽里**贡献一项**（按钮 / 菜单） | `share-html` |

写错（例如把 load 的 id 写成插槽 id `share-html`）会怎样：加载器按包名建档的那一行填不上 → 同一个 bundle 被**二次求值** → 撞重复注册 → **web boot 拒绝启动，整个桌面端打不开**（日志见文首）。

官方对照实现：`@deepseek-ai/dsh-session-log-export`（DSH 自带的同类导出插件），看它的客户端文件 `node_modules/@deepseek-ai/dsh-session-log-export/lib/client.js` 里 `load({ id })` 用的就是包名。本机 profile 里若没装这个包，可在 DSH 安装目录内找同名包对照。

本仓库现状（改之前请先对照）：

- `lib/client.js` 第 1~2 行：`window.__ModuleLoader__.load({ id: "dsh-plugin-session-share" ... })`
- `lib/client.js` 第 286 行附近：`ctx.slots.register({ id: "share-html" ... })`

一个包名、一个插槽 id，**只改该改的那个**。

---

## 目录结构

```
dsh-plugin-session-share/
├─ install.ps1              # 一键安装 / 卸载 / -WhatIf（PowerShell 5.1）
├─ 如果DSH起不来-双击我.cmd  # 双击入口：绕过执行策略，内部调 restore-if-broken.ps1
├─ restore-if-broken.ps1    # 应急恢复：把配置回滚到安装前（可 -ListOnly 预览）
├─ cordis.patch.yml         # 包内 bundle patch（GUI/plugin_manager 安装路线）
├─ lib/
│  ├─ index.js              # 插件在 DSH 内的注册（命令、路由、工具）
│  ├─ client.js             # 会话头部「分享为 HTML」按钮（load id 必须=包名）
│  ├─ render.js             # 事件流 → 单文件 HTML（零依赖）
│  └─ redact.js             # 脱敏规则
├─ tools/
│  ├─ render-session.mjs    # 离线 CLI（支持多帧 zstd / jsonl）
│  └─ read-session-log.mjs  # 调试用：zstd → jsonl
└─ test/fixtures/           # 含真实对话的本地夹具，不要外发
```

## 开发者自检

```bash
node tools/render-session.mjs --log test/fixtures/session-sample.events.jsonl --out out.html
```

stdout 一行 JSON，`bytes` 应在数百 KB 量级；`stats.redacted > 0` 说明脱敏生效。

装 / 卸脚本自检（临时目录里造假 profile，不碰真实配置）：

```powershell
.\install.ps1 -ProfileDir '<临时 profile 目录>' -PluginDir '<含 lib\index.js 的目录>' -WhatIf
.\restore-if-broken.ps1 -ProfileDir '<临时 profile 目录>' -ListOnly
```
