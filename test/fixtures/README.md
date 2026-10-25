# 测试夹具（全部为合成数据）

`session-sample.events.jsonl` —— **完全虚构**的 DSH 会话事件流，96 行，约 50 KB。
它替代了早期版本里那份从本机真实会话解压出来的事件流：那份文件含真实对话内容、
真实用户名与真实本机路径，**不得再提交到任何仓库或对外发送**。

## 合成到什么程度

- 用户 `alice`（虚构）、工程 `C:\Users\alice\projects\acme-crm`（虚构）、
  会话 id `session-7f3c9a1e-…`（虚构）；
- 对话内容是虚构的「订单列表导出 CSV」需求，四轮：需求 → BOM 兼容 → 分组小计 → 分页导出；
- 所有 UUID、callId、jobId、子代理 id 均为占位串，与任何真实会话无关。

## 为什么还要保留真实形态

事件类型与字段形状按真实 DSH 事件流 1:1 仿写，供 `test/render.test.mjs` 做形态覆盖：

| 类别 | 覆盖的事件 |
| --- | --- |
| 会话头 | `session`、`permission/preset`、`sandbox/mode`、`approval/policy`、`agent-preset/selected` |
| 消息 | `user/message`（`source.kind` = user / runtime-context / skill-catalog / working-context / subagent-settled / agent-message）、`assistant/message`（reasoning + text + tool-call 块，`data.stream` 含 reasoning-chunks / text-chunks / tool-call-chunks）、`system/message` |
| 工具 | `tool/call`、`tool/result`（6 组一一配对）、`tool/ptc-dispatch-start`、`tool/ptc-dispatch` |
| 轮次 | `turn/start`、`step/start`、`step/end`、`turn/end`（4 轮 / 11 步） |
| 其它 | `agent/inbox/spliced`、`session/title`（fallback + provider）、`session/title-llm-request`、`request/header`、`request/context`、`session-log-deepseek/delivery-accepted`、`job/registered`、`job/settled`、`subagent/catalog`、`todo/write`、`web/deepseek-search-llm-request` |

夹具里刻意保留了 60 处以上「用户目录 / 扁平化会话目录」形态，用来验证脱敏：

- `C:\Users\alice\…` → `%USERPROFILE%\…`
- `--C-Users-alice-projects-acme-crm--` → `--C-Users-%USERNAME%-…`
- 其余 `alice` 字面量 → `%USERNAME%`

## 修改夹具时注意

`test/render.test.mjs` 的断言大多按夹具现算（条数、配对、脱敏命中数），但也有几条
对夹具规模敏感，改夹具后请重跑 `node test/render.test.mjs`：

- 推理段落总字数要足够大（渲染时会为每段加固定长度的「第 N 段」标签，
  字数太少会让偏差超过 5%）；
- 每条消息里至少要有一段 24 字符以上不含标点的连续片段，
  否则「未选条目」的采样窗口会为空；
- 第一轮真人消息所在轮次要同时带工具调用和内联上下文，供「按条挑选取样」使用。
