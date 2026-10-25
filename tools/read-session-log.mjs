#!/usr/bin/env node
// 读取 DSH 会话日志 session.v4.jsonl.zstd（多帧 zstd 拼接），输出每行一个事件 JSON。
// 用法: node tools/read-session-log.mjs <path-to-session.v4.jsonl.zstd> [outFile]
import fs from "node:fs";
import zlib from "node:zlib";

export function readSessionEvents(file) {
  const buf = fs.readFileSync(file);
  const isZstd = buf.length > 4 && buf[0] === 0x28 && buf[1] === 0xb5 && buf[2] === 0x2f && buf[3] === 0xfd;
  if (!isZstd) {
    return buf.toString("utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  }
  const offs = [];
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) offs.push(i);
  }
  const parts = [];
  for (let k = 0; k < offs.length; k++) {
    const slice = buf.subarray(offs[k], k + 1 < offs.length ? offs[k + 1] : buf.length);
    try { parts.push(zlib.zstdDecompressSync(slice).toString("utf8")); } catch {}
  }
  return parts.join("").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

if (process.argv[1] && /read-session-log\.mjs$/i.test(process.argv[1])) {
  const [, , file, outFile] = process.argv;
  if (!file) { console.error("usage: node tools/read-session-log.mjs <session.v4.jsonl.zstd> [out.jsonl]"); process.exit(2); }
  const events = readSessionEvents(file);
  const text = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  if (outFile) fs.writeFileSync(outFile, text, "utf8"); else process.stdout.write(text);
}
