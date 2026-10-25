# 发布与分发：GitHub + 市场索引

本仓库**不发 npm**。分发只有一条链路：GitHub 仓库 + 一个市场索引 JSON，索引把每个版本号钉死在仓库的某一个 commit 上。

本文讲清楚三件事：为什么 GitHub 上有代码不等于进了市场、每版要跑哪些命令、别人怎么一行 spec 装上。

## 目录

1. 为什么上传到 GitHub 不等于进市场
2. 索引文件长什么样
3. 一次性准备
4. 发版步骤（每版必做）
5. 别人怎么安装
6. 注意事项
7. 校验与排错
8. 附录：字段速查与本仓库当前状态

## 1. 为什么上传到 GitHub 不等于进市场

- **市场只读用户自己配置的 URL。** DSH 的市场服务（`@deepseek-ai/dsh-plugin-market`）配置项 `indexes` 默认是空数组 `[]`；空的时候 Host 一个请求都不会发。仓库写得再好、star 再多，也不会自动出现在任何人的「发现」页里。
- **索引是唯一入口。** 谁把索引 URL 填进 DSH，谁就能看到你在这个索引里列出的插件与版本；反过来，只要索引里没写，那个版本在市场上就不存在。
- **市场本身还是可选件。** 市场由 `dsh-experimental-plugin-market-bundle` 提供，发行版默认不挂这个 bundle。没启用时「插件」页里连「发现」标签都没有 —— 先启用 bundle，再谈索引。
- **索引条目是「指针」，不是包本体。** 每个版本只写 `{ type: "git", url, commit }`，安装时去那个 commit 取代码。所以发版后忘了更新 commit，用户装到的就是旧代码，而且没有任何提示。

## 2. 索引文件长什么样

格式 1（`format: 1`），仓库里由 `tools/make-index.mjs` 生成到 `market/index.json`：

```json
{
  "format": 1,
  "title": "Session Share 插件市场",
  "description": "会话分享插件的 git 分发索引：每个版本固定到仓库的一个 commit。",
  "metadata": {},
  "plugins": [
    {
      "name": "dsh-plugin-session-share",
      "title": "会话分享 Session Share",
      "description": "把 DSH 会话导出为可分享的单文件页面。",
      "metadata": { "keywords": ["session", "share", "export"] },
      "versions": [
        {
          "version": "0.1.0",
          "publishTimestamp": 1762000000,
          "source": {
            "type": "git",
            "url": "https://github.com/OWNER/dsh-plugin-session-share",
            "commit": "0000000000000000000000000000000000000000"
          }
        }
      ]
    }
  ]
}
```

几条硬规则（都来自校验器，不是本仓库自创）：

- `version` 必须是精确 SemVer；同一个插件里不能重复。
- `publishTimestamp` **必填**，Unix 秒整数，范围 `[0, 10^11)`。漏掉会被校验器直接拒。
- `source.url` 必须是 **https、规范化**的仓库地址，至少两段路径，不带凭据、不带 query/fragment；`.git` 后缀会被脚本去掉（安装时再补回）。
- `source.commit` 必须是 **40 位小写 hex**，39 位、大写都会挂。
- 子目录安装才写 `source.path`，值是仓库内的相对目录（不能含 `.`、`..`）。
- `versions` 按 SemVer 降序排列（校验器解析后也会自己排一次）。
- 插件项的 `metadata`（category / keywords / labels / sortKeys）、`icon`、`author`、`homepage`、`repository`、`engines` 都是可选的展示与兼容性字段；写 `labels`/`category` 时必须先在索引根 `metadata` 里声明 id。

## 3. 一次性准备

- **公开仓库。** 私有仓库别人没有凭据，装不上（见第 6 节）。
- **一个 https 的索引地址。** 二选一：
  - GitHub Pages：`https://<user>.github.io/<repo>/market/index.json`
  - raw 文件：`https://raw.githubusercontent.com/<user>/<repo>/<branch>/market/index.json`
  两者都不带 `?`/`#`、不带凭据，符合市场对索引 URL 的校验。
- **仓库里有 origin。** 脚本从 `git config --get remote.origin.url` 取地址（`git@github.com:user/repo.git`、`ssh://`、`git://` 都会规范化成 `https://github.com/user/repo`），也可以用 `--url` 覆盖。
- **校验器。** 脚本用的是 DSH 安装里那份真正的校验器（`packages/@deepseek-ai/dsh-plugin-market-index` 的构建产物，位于 `F:/Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js`）。纯 Node 读不了 asar，所以脚本发现加载失败时会自动用 DSH 的 Electron 以 `ELECTRON_RUN_AS_NODE=1` 重跑自己一遍；装在别处可用环境变量覆盖：`DSH_APP_ASAR=<...>/resources/app.asar` 或 `DSH_MARKET_INDEX_MODULE=<lib/index.js>`。

## 4. 发版步骤（每版必做）

1. 改 `package.json` 的 `version`。
2. `git add -A && git commit -m "vX.Y.Z" && git tag vX.Y.Z`。
3. `git push && git push --tags`。走 git 安装时别人只能取到已推送的 commit，本地提交不行。
4. 生成索引：`node tools/make-index.mjs`（子目录安装时加 `--path <仓库内子目录>`；`--title` / `--description` 可覆盖索引标题）。
5. 提交索引：`git add market/index.json && git commit -m "index: vX.Y.Z" && git push`。
6. 把 `market/index.json` 发布到第 3 节选定的地址（Pages 发布分支或 raw 分支都行）。
7. DSH 里：插件 → 发现 → 空状态里的「添加索引源」→ 粘贴索引 URL → 保存。第 7 步只需做一次，之后刷新即取新索引。
8. 每版结束跑一次 `node tools/make-index.mjs --check` 自检（会提示索引里的 commit 与 HEAD 是否一致）。

> 第 4、5 步为什么分开：索引里的 `commit` 必须指向**已发布的代码 commit**。如果把索引和代码放进同一个 commit，只有等这个 commit 生成后才能写它的 sha，只能二次提交 —— 所以按「先代码，后索引」两步走。索引文件自己晚一个 commit 落库，不影响它指向的代码。

## 5. 别人怎么安装

**走市场（推荐）：** 添加索引 URL 后，插件 → 发现 → 搜索 `dsh-plugin-session-share` → 安装。安装串由 `marketInstallTarget` 生成，形如：

```text
git+https://github.com/OWNER/dsh-plugin-session-share.git#<40 位 commit>
```

子目录安装（`source.path` 非空）时追加 pnpm 的 `path:` 参数：

```text
git+https://github.com/OWNER/dsh-plugin-session-share.git#<40 位 commit>&path:/packages/plugin
```

**不走市场：** 上面这条串本身就是 `pnpm add` 能吃的 spec（插件管理器的 `installBundle` 就是按 `pnpm add` 语义装），可以直接交给插件管理器，或在 profile 目录执行：

```bash
pnpm add "git+https://github.com/OWNER/dsh-plugin-session-share.git#<40 位 commit>"
```

本仓库当前是占位样例，`node tools/make-index.mjs --check` 打印的那条安装串如下（`OWNER` 与 40 个 0 都是占位值，首次发版必须重新生成）：

```text
git+https://github.com/OWNER/dsh-plugin-session-share.git#0000000000000000000000000000000000000000
```

## 6. 注意事项

- **每次发版必须更新索引里的 commit。** 代码动了、索引没动，所有人装到的还是旧 commit。`--check` 会在 commit 与 HEAD 不一致时给出 warn。
- **私有仓库装不了。** 索引里的 git 安装对他人就是匿名 `git clone`；私有仓库只会安装失败。要给别人用就开源。
- **包内不能含测试与真实数据。** `package.json` 的 `files` 已限定为 `lib`、`locale`、`cordis.patch.yml`；但 git 安装是整仓库取回再按包根/`path` 解析，所以**真实会话日志、token、导出文件一律不要提交进仓库**，`test/` 也不该被安装流程依赖。
- **同一版本号不要指两个 commit。** 脚本对已存在的版本只更新 `source`（幂等，不会新建条目），这是给「tag 前手滑」擦屁股的；正常发版请升版本号，历史条目一律保留。
- **`publishTimestamp` 首次写入后保留**，重跑不会刷新，所以重复运行是幂等的（除了 commit 变化）。
- **索引 URL 也会被校验。** 市场只接受规范化、`http(s)`、无凭据、无 fragment 的地址；`http://` 的地址虽然能用，但建议一律 https。

## 7. 校验与排错

脚本结尾用**真实校验器**校验产物：`parseMarketIndex(JSON.parse(text), "https://example.com/market/index.json")`，再对每个版本调 `marketInstallTarget(name, version)` 打印安装串。

退出码：`0` 通过；`1` 索引不合法（校验器给出的 `path` + `reason` 会打印出来）；`2` 环境问题（不是 git 仓库、没有 origin、找不到校验器、参数写错）。

常见报错（左边是校验器的 `path`，右边是 `reason`）：

| path | reason | 怎么修 |
|---|---|---|
| `$.plugins[0].versions[0].version` | `must be an exact SemVer version` | 版本号写成 `1.2.3`，不要 `v1.2.3` / 区间 |
| `$.plugins[0].versions[0].source.commit` | `must be a lowercase 40-hex-digit commit SHA` | 39 位或大写都会挂，重新跑 make-index |
| `$.plugins[0].versions` | `must be a non-empty array` | 至少留一个版本条目 |
| `$.plugins[0].versions[0].publishTimestamp` | `must be an integer number of Unix seconds` | 漏了必填字段，让脚本写 |
| `$.title` | `must be a string with a non-whitespace character` / 多语言对象 `must contain en` | 标题别留空；用对象写多语言时必须带 `en` |
| `$.plugins[0].metadata.labels` | `references undeclared id` | 先在索引根 `metadata.labels` 里声明 |
| `$.plugins[0].versions[0].source.url` | `must use https:` / `must be a canonical URL` | 交给脚本规范化，别手写 ssh 地址 |

市场侧排错：填了 URL 但列表为空 —— 看「索引源」对话框里该源的错误行，Host 的拒绝原因就写在那里；带 `?`、带 `#`、带 `user:pass` 的 URL 都会被拒。

## 8. 附录：字段速查与本仓库当前状态

| 字段 | 必填 | 说明 |
|---|---|---|
| `format` | 是 | 固定 `1` |
| `title` | 是 | 索引标题，字符串或 `{ "en": ..., "zh": ... }`（对象必须含 `en`） |
| `description` | 否 | 索引描述，同上 |
| `metadata` | 否 | 声明 `categories` / `labels` / `sortKeys`，供插件项引用 |
| `plugins[].name` | 是 | npm 包名 |
| `plugins[].title` / `description` / `icon` / `author` / `homepage` / `repository` / `metadata` / `engines` | 否 | 展示与兼容性元数据 |
| `plugins[].versions[].version` | 是 | 精确 SemVer |
| `plugins[].versions[].publishTimestamp` | 是 | Unix 秒整数 |
| `plugins[].versions[].source.type` | 是 | `npm` 或 `git`（本仓库只用 `git`） |
| `plugins[].versions[].source.url` | 是（git） | 规范化 https 仓库地址 |
| `plugins[].versions[].source.commit` | 是（git） | 40 位小写 hex |
| `plugins[].versions[].source.path` | 否 | 仓库内子目录 |

**本仓库当前状态：** `market/index.json` 是占位样例 —— 本目录还不是 git 仓库，所以 `url` 里是 `OWNER`、`commit` 是 40 个 0，并带一个 `_placeholder` 标记字段（校验器不认识的顶层成员会被忽略，不影响读取）。首次发布前必须：

```bash
git init && git add -A && git commit -m "release"
git remote add origin git@github.com:<你的账号>/dsh-plugin-session-share.git
node tools/make-index.mjs   # 会写入真实 url 与 commit，并自动删除 _placeholder
git push -u origin HEAD
```

然后按第 4 节发布索引。
