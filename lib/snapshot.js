import {
  ARGS_LIMIT,
  RESULT_LIMIT,
  USER_TITLE_LEN,
  VERSION,
  blocksOf,
  clip,
  compact,
  collectUsernames,
  contextReason,
  eventTime,
  formatTimestamp,
  lineCount,
  messageId,
  normalizeEvents,
  plainMarkdown,
  prettyArguments,
  resultTextOf,
  summarize,
} from "./render.js";
import { createRedactor } from "./redact.js";

/**
 * Native share document. The plugin composes this object directly from the session event
 * stream; the host never receives an exported HTML page and the reader never parses one.
 * Bump SCHEMA_VERSION only for a breaking shape change.
 */
export const SNAPSHOT_SCHEMA = "dsh.session-share/v1";
export const SCHEMA_VERSION = 1;

function str(value) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function finiteNumber(value, fallback) {
  var number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function charLabel(chars) {
  return chars >= 1000 ? Math.round(chars / 100) / 10 + "k" : String(chars);
}

function cleanName(value, fallback) {
  return str(value).trim() || fallback;
}

/**
 * Builds the portable document the hosting API stores. It deliberately contains no HTML:
 * every message keeps Markdown source, every trace keeps plain text, and the reader is the
 * only place that turns them into pixels.
 */
export function buildShareSnapshot(input) {
  var source = input && typeof input === "object" ? input : {};
  var rawOptions = source.options && typeof source.options === "object" ? source.options : {};
  var redactEnabled = rawOptions.redact !== false;
  var reasoningMode = rawOptions.reasoning === "count" || rawOptions.reasoning === "full"
    ? rawOptions.reasoning
    : "omit";

  var parsed = normalizeEvents(source.events);
  var events = parsed.items;
  var badLines = parsed.badLines;

  var usernames = collectUsernames(source.session, events,
    typeof source.events === "string" ? source.events : "");
  var redactor = createRedactor({ enabled: redactEnabled, usernames: usernames });

  function redact(value) {
    return redactor.text(value);
  }

  // The index exists only so a selective share can report what it left out. It uses its
  // own redactor for the same reason the HTML renderer does: the header count belongs to
  // the document, not to the picker.
  var entryIndex = collectEntries(events, createRedactor({ enabled: redactEnabled, usernames: usernames }));
  var totalEntries = entryIndex.total;

  var pickActive = false;
  var pickIds = new Set();
  if (Array.isArray(rawOptions.pick)) {
    pickActive = true;
    for (var pi = 0; pi < rawOptions.pick.length; pi++) {
      if (typeof rawOptions.pick[pi] === "string" && rawOptions.pick[pi]) pickIds.add(rawOptions.pick[pi]);
    }
  }

  var header = source.session && typeof source.session === "object" ? source.session : {};
  var meta = {
    id: str(header.id || header.sessionId),
    cwd: str(header.cwd),
    preset: str(header.agentPreset),
    createdAt: header.createdAt,
  };

  var resultsByCallId = new Map();
  var usedResults = new Set();
  for (var r = 0; r < events.length; r++) {
    var resultEvent = events[r];
    if (!resultEvent || resultEvent.type !== "tool/result") continue;
    var resultData = resultEvent.data || {};
    var resultMessage = resultData.message || {};
    var resultCallId = str(resultMessage.toolCallId || resultData.toolCallId ||
      (resultMessage.source && resultMessage.source.callId));
    if (resultCallId && !resultsByCallId.has(resultCallId)) resultsByCallId.set(resultCallId, resultEvent);
  }
  for (var c = 0; c < events.length; c++) {
    var callEvent = events[c];
    if (!callEvent || callEvent.type !== "tool/call") continue;
    var callId = str((callEvent.data || {}).callId);
    if (callId && resultsByCallId.has(callId)) usedResults.add(resultsByCallId.get(callId));
  }

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
  var pickedEntries = 0;
  var unpairedResults = 0;
  var unknownBlocks = new Map();
  var sessionTitle = "";
  var firstUserText = "";

  function openGroup(turn) {
    current = {
      turn: turn == null ? "" : str(turn),
      messages: [],
      contexts: [],
      reasonings: [],
      reasoningCount: 0,
      tools: [],
    };
    groups.push(current);
    return current;
  }

  function cell() {
    return current || openGroup("");
  }

  for (var i = 0; i < events.length; i++) {
    var event = events[i];
    if (!event || typeof event !== "object") continue;
    var type = str(event.type);
    var data = event.data && typeof event.data === "object" ? event.data : {};

    if (type === "session") {
      if (!meta.id) meta.id = str(event.id || event.sessionId);
      if (!meta.cwd) meta.cwd = str(event.cwd);
      if (!meta.preset) meta.preset = str(event.agentPreset);
      if (meta.createdAt == null) meta.createdAt = event.createdAt;
      continue;
    }
    if (type === "session/title") {
      if (typeof data.title === "string" && data.title.trim()) sessionTitle = data.title.trim();
      continue;
    }
    if (type === "turn/start") {
      openGroup(data.turn);
      continue;
    }
    if (type === "tool/result") {
      if (!usedResults.has(event)) {
        unpairedResults += 1;
        counts.set("tool/result（未配对）", (counts.get("tool/result（未配对）") || 0) + 1);
      }
      continue;
    }
    if (type === "user/message") {
      var userBlocks = blocksOf(data);
      var userSpeech = [];
      for (var ub = 0; ub < userBlocks.length; ub++) {
        var userBlock = userBlocks[ub];
        var userType = str(userBlock.type);
        if (userType === "text" || userType === "") {
          var userText = str(userBlock.text);
          if (userText.trim()) userSpeech.push(userText);
        } else {
          unknownBlocks.set("user:" + (userType || "(none)"), (unknownBlocks.get("user:" + userType) || 0) + 1);
        }
      }
      userMessages += 1;
      var speechText = userSpeech.join("\n");
      var reason = speechText ? contextReason(data, speechText) : "";
      if (reason) {
        contextMessages += 1;
        cell().contexts.push({ reason: reason, text: speechText });
        continue;
      }
      var userMessageId = messageId(event, i);
      if (pickActive && !pickIds.has(userMessageId)) continue;
      pickedEntries += 1;
      if (!firstUserText && speechText) firstUserText = compact(speechText, 200);
      if (speechText.trim()) {
        cell().messages.push({
          id: userMessageId,
          role: "user",
          name: "你",
          markdown: redact(speechText),
        });
      }
      continue;
    }
    if (type === "assistant/message") {
      var assistantBlocks = blocksOf(data.message);
      var assistantCell = cell();
      var assistantTexts = [];
      for (var ab = 0; ab < assistantBlocks.length; ab++) {
        var assistantBlock = assistantBlocks[ab];
        var assistantType = str(assistantBlock.type);
        if (assistantType === "reasoning" || assistantType === "thinking") {
          assistantCell.reasoningCount += 1;
          reasoningBlocks += 1;
          if (reasoningMode === "full") {
            var reasoningText = str(assistantBlock.text);
            if (reasoningText.trim()) assistantCell.reasonings.push(reasoningText);
          }
        } else if (assistantType === "text" || assistantType === "") {
          var assistantText = str(assistantBlock.text);
          if (assistantText.trim()) assistantTexts.push(assistantText);
        } else if (assistantType === "tool-call") {
          continue;
        } else {
          unknownBlocks.set("assistant:" + (assistantType || "(none)"), (unknownBlocks.get("assistant:" + assistantType) || 0) + 1);
        }
      }
      assistantMessages += 1;
      if (!assistantTexts.length) continue;
      var assistantMessageId = messageId(event, i);
      if (pickActive && !pickIds.has(assistantMessageId)) continue;
      pickedEntries += 1;
      assistantCell.messages.push({
        id: assistantMessageId,
        role: "assistant",
        name: "DeepSeek",
        markdown: redact(assistantTexts.join("\n\n")),
      });
      continue;
    }
    if (type === "tool/call") {
      var toolCallId = str(data.callId);
      var matched = toolCallId && resultsByCallId.has(toolCallId) ? resultsByCallId.get(toolCallId) : null;
      toolCalls += 1;
      cell().tools.push({
        name: cleanName(data.name, "tool"),
        rawArgs: data.arguments,
        resultEvent: matched,
        isError: !!(matched && matched.data && matched.data.message && matched.data.message.isError),
      });
      continue;
    }
    var bucket = type || "(无 type)";
    counts.set(bucket, (counts.get(bucket) || 0) + 1);
  }

  unknownBlocks.forEach(function (count, key) {
    counts.set("block:" + key, count);
  });

  var turns = [];
  for (var gi = 0; gi < groups.length; gi++) {
    var group = groups[gi];
    if (pickActive && !group.messages.length) continue;
    var apparatus = [];
    var contextIndex = 0;
    var reasoningIndex = 0;
    var toolIndex = 0;

    for (var ci = 0; ci < group.contexts.length; ci++) {
      var context = group.contexts[ci];
      var contextText = redact(context.text);
      contextIndex += 1;
      apparatus.push({
        id: "ctx-" + gi + "-" + contextIndex,
        type: "context",
        index: contextIndex,
        chars: contextText.length,
        reason: context.reason,
        text: contextText,
      });
    }
    if (group.reasoningCount) {
      if (reasoningMode === "full") {
        for (var ri = 0; ri < group.reasonings.length; ri++) {
          var reasoningText = redact(group.reasonings[ri]);
          reasoningIndex += 1;
          apparatus.push({
            id: "reason-" + gi + "-" + reasoningIndex,
            type: "reasoning",
            index: reasoningIndex,
            chars: reasoningText.length,
            markdown: reasoningText,
          });
        }
        collapsedBlocks += 1;
        topLevelBlocks += 1;
      } else if (reasoningMode === "count") {
        reasoningRows += 1;
      }
    }
    if (group.tools.length) {
      for (var ti = 0; ti < group.tools.length; ti++) {
        var tool = group.tools[ti];
        var argsSource = tool.rawArgs == null ? "" : prettyArguments(tool.rawArgs);
        var argsPretty = argsSource ? redact(argsSource) : "";
        var resultRaw = tool.resultEvent ? redact(resultTextOf(tool.resultEvent)) : "";
        var summary = tool.resultEvent ? (summarize(resultRaw, 60) || "（空结果）") : "无结果记录";
        var argsClip = argsPretty.trim() ? clip(argsPretty, ARGS_LIMIT) : null;
        var resultClip = tool.resultEvent ? clip(resultRaw, RESULT_LIMIT) : null;
        toolIndex += 1;
        apparatus.push({
          id: "tool-" + gi + "-" + toolIndex,
          type: "tool",
          index: toolIndex,
          name: tool.name,
          summary: summary,
          meta: summary + (tool.resultEvent ? " · " + lineCount(resultRaw) + " 行" : ""),
          error: Boolean(tool.isError),
          args: argsClip ? argsClip.text : null,
          result: resultClip ? resultClip.text : null,
          argsTruncated: argsClip && argsClip.truncated
            ? { shown: argsClip.text.length, original: argsPretty.length }
            : null,
          resultTruncated: resultClip && resultClip.truncated
            ? { shown: resultClip.text.length, original: resultRaw.length }
            : null,
          noResult: !tool.resultEvent,
        });
      }
      collapsedBlocks += 1;
      topLevelBlocks += 1;
    }
    if (group.contexts.length) {
      collapsedBlocks += 1;
      topLevelBlocks += 1;
    }
    if (!group.messages.length && !apparatus.length) continue;

    var rawTurnNumber = finiteNumber(group.turn, NaN);
    var number = Number.isFinite(rawTurnNumber) && rawTurnNumber > 0 ? rawTurnNumber : turns.length + 1;
    turns.push({
      id: "turn-" + (turns.length + 1),
      number: number,
      label: "第 " + (number < 10 ? "0" + number : String(number)) + " 轮",
      messages: group.messages,
      apparatus: apparatus,
      reasoningOmitted: reasoningMode === "count" && group.reasoningCount
        ? { count: group.reasoningCount }
        : null,
    });
  }

  if (reasoningMode === "full") collapsedBlocks += reasoningBlocks;
  collapsedBlocks += toolCalls;

  var generatedAtIso = new Date(rawOptions.now == null ? Date.now() : rawOptions.now).toISOString();
  var title = typeof rawOptions.title === "string" && rawOptions.title.trim()
    ? rawOptions.title.trim()
    : (sessionTitle || compact(firstUserText, USER_TITLE_LEN) || "DSH 会话记录");

  var internalEntries = [];
  var internalTotal = 0;
  counts.forEach(function (count, key) {
    internalEntries.push({ type: key, count: count });
    internalTotal += count;
  });
  internalEntries.sort(function (a, b) {
    return b.count - a.count || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0);
  });

  var userSpeechCount = userMessages - contextMessages;
  var emptySelection = pickActive && pickedEntries === 0;
  var warnings = [];
  if (badLines > 0) warnings.push(badLines + " 行事件无法解析，已在发布时跳过。");
  if (emptySelection) warnings.push("这份快照没有选中任何消息。");

  return {
    schemaVersion: SCHEMA_VERSION,
    title: redact(title),
    source: {
      generator: "DSH session share",
      pluginVersion: VERSION,
      sessionId: meta.id ? redact(meta.id) : null,
      generatedAt: formatTimestamp(rawOptions.now),
      generatedAtIso: generatedAtIso,
      sessionCreatedAt: meta.createdAt == null ? null : String(meta.createdAt),
      preset: meta.preset ? redact(meta.preset) : null,
      cwd: meta.cwd ? redact(meta.cwd) : null,
      reasoning: reasoningMode,
      redacted: redactEnabled,
    },
    counts: {
      turns: turns.length,
      userMessages: userSpeechCount,
      contextMessages: contextMessages,
      assistantMessages: assistantMessages,
      toolCalls: toolCalls,
      collapsedBlocks: collapsedBlocks,
      redactions: redactor.redactedCount,
      badLines: badLines,
      events: events.length,
      picked: pickedEntries,
      totalEntries: totalEntries,
    },
    turns: turns,
    internal: internalTotal > 0
      ? {
        count: internalTotal,
        events: internalEntries,
        note: "调度、流式与目录类事件不承载对话正文，这里只保留类型计数。",
      }
      : null,
    emptySelection: emptySelection,
    warnings: warnings,
  };
}

/** The wire shape posted by the plugin: a schema tag plus the immutable document. */
export function buildShareBundle(input) {
  return {
    schema: SNAPSHOT_SCHEMA,
    document: buildShareSnapshot(input),
  };
}

function collectEntries(events, redactor) {
  var turns = [];
  var current = null;
  function open(turn) {
    current = { turn: turn == null ? "" : str(turn), drafts: [], context: 0, tools: 0 };
    turns.push(current);
    return current;
  }
  function cell() {
    return current || open("");
  }
  for (var i = 0; i < events.length; i++) {
    var event = events[i];
    if (!event || typeof event !== "object") continue;
    var type = str(event.type);
    var data = event.data && typeof event.data === "object" ? event.data : {};
    if (type === "turn/start") {
      open(data.turn);
      continue;
    }
    if (type === "tool/call") {
      cell().tools += 1;
      continue;
    }
    if (type === "user/message") {
      var userBlocks = blocksOf(data);
      var speech = [];
      for (var b = 0; b < userBlocks.length; b++) {
        var blockType = str(userBlocks[b].type);
        if (blockType !== "text" && blockType !== "") continue;
        var blockText = str(userBlocks[b].text);
        if (blockText.trim()) speech.push(blockText);
      }
      var text = speech.join("\n");
      if (text && contextReason(data, text)) {
        cell().context += 1;
        continue;
      }
      var userId = messageId(event, i);
      cell().drafts.push({
        kind: "user",
        id: userId,
        seq: Number(userId.slice(1)),
        time: eventTime(event),
        raw: text,
      });
      continue;
    }
    if (type === "assistant/message") {
      var messageBlocks = blocksOf(data.message);
      var parts = [];
      for (var a = 0; a < messageBlocks.length; a++) {
        var messageType = str(messageBlocks[a].type);
        if (messageType !== "text" && messageType !== "") continue;
        var messageText = str(messageBlocks[a].text);
        if (messageText.trim()) parts.push(messageText);
      }
      if (!parts.length) continue;
      var assistantId = messageId(event, i);
      cell().drafts.push({
        kind: "assistant",
        id: assistantId,
        seq: Number(assistantId.slice(1)),
        time: eventTime(event),
        raw: parts.join("\n"),
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
        label: plainMarkdown(redacted).slice(0, 80),
        chars: redacted.length,
      });
    }
  }
  return { entries: entries, total: entries.length };
}
