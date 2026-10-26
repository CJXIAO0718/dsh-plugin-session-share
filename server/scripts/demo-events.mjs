const md = (...lines) => lines.join('\n')
const line = (...parts) => parts.join('\n')

const BASE = 1792972800000
let seq = 0

function event(type, data, extra = {}) {
  const item = { type, seq, time: BASE + seq * 9000, data, ...extra }
  seq += 1
  return item
}

function userMessage(turn, text, id, source = { kind: 'user', rpcId: id, clientTimeZone: 'Asia/Shanghai' }) {
  return event('user/message', {
    content: [{ type: 'text', text }],
    source,
    role: 'user',
    id,
  }, { surfaceOp: 'append', turn })
}

function assistantMessage(turn, step, id, content) {
  return event('assistant/message', {
    turn,
    step,
    message: {
      role: 'assistant',
      content,
      source: { kind: 'model', provider: 'deepseek-account', model: 'deepseek-chat' },
      id,
    },
    usage: { inputTokens: 2084, outputTokens: 512, totalTokens: 2596 },
  }, { surfaceOp: 'append' })
}

function toolCall(callId, name, args) {
  return event('tool/call', {
    callId,
    name,
    arguments: JSON.stringify(args),
  })
}

function toolResult(callId, text, isError = false) {
  return event('tool/result', {
    message: {
      role: 'tool',
      source: { kind: 'tool', callId },
      toolCallId: callId,
      content: [{ type: 'text', text }],
      ...(isError ? { isError: true } : {}),
    },
  }, { surfaceOp: 'append' })
}

const events = []

events.push({
  type: 'session',
  version: 4,
  id: 'session-demo-spectral',
  createdAt: BASE - 3600000,
  cwd: 'C:\\Users\\alice\\audio-lab',
  isSeeded: false,
  delegationDepth: 0,
  agentPreset: 'standard',
})

events.push(event('permission/preset', { preset: 'workspace-write' }))
events.push(event('sandbox/mode', { mode: 'workspace-write' }))
events.push(event('approval/policy', { policy: 'auto' }))
events.push(event('agent-preset/selected', { agentPreset: 'standard' }))
events.push(event('session/title', {
  title: '采样率之外：一次鼓组重采样的频谱体检',
  messageSeqs: [6],
  source: { kind: 'provider' },
}))

// Turn 1
events.push(event('turn/start', { turn: 1 }))
events.push(event('step/start', { turn: 1, step: 1 }))
events.push(userMessage(1, '我手上有一段 92 BPM 的鼓组，24-bit / 96 kHz，准备放进一张全部是 44.1 kHz 的专辑。我不想只凭听感决定要不要重采样，想从频谱上确认。能给我一套判断流程吗？临界频率和混叠到底怎么算？', 'fictional-user-1001'))
events.push(userMessage(1, line(
  'Current runtime context:',
  'workspace: C:\\Users\\alice\\audio-lab',
  'python: 3.12.4  ·  numpy: 2.1.0  ·  ffmpeg: 7.0.2',
  'sandbox: workspace-write',
  'Keep every write inside the workspace directory.',
), 'fictional-context-1002', { kind: 'runtime-context' }))
events.push(userMessage(1, line(
  '<system-reminder>',
  '可用技能目录：',
  '- audio-inspection：读取音频元数据、绘制频谱、检查采样率与位深。',
  '- report-writer：把测量结果整理成单文件 HTML 报告。',
  '</system-reminder>',
), 'fictional-context-1003', { kind: 'skill-catalog', form: 'catalog' }))

events.push(event('request/header', {
  header: {
    config: { provider: 'deepseek-account', model: 'deepseek-chat', reasoningEffort: 'medium', maxTokens: 8192 },
    tools: [
      { name: 'inspect_audio', description: 'Read stream metadata with ffprobe.' },
      { name: 'spectral_probe', description: 'Compute a windowed spectrum.' },
    ],
  },
  reason: 'initial',
}))
events.push(event('request/context', {
  provider: 'deepseek-account',
  model: 'deepseek-chat',
  contextWindow: 131072,
  systemPromptUpdate: 'in-history',
}))

events.push(assistantMessage(1, 1, 'fictional-assistant-1004', [
  {
    type: 'reasoning',
    text: '先把“文件事实”和“听感判断”分开。采样定理只约束可表示频率的上限，不保证高频里没有混叠；而这段素材是从别处拿来的，历史不明，所以第一步必须是读元数据、确认流参数，再做一次带抗混叠滤波的对照。不要一上来就建议保留 96 kHz，那只是把问题推迟。',
  },
  {
    type: 'text',
    text: md(
      '## 先拆开三个变量',
      '',
      '在讨论“要不要重采样”之前，先把三件事分开：',
      '',
      '- **采样率**决定能表示的最高频率，上限是奈奎斯特频率 $f_s/2$。',
      '- **位深**决定动态范围，和频响无关；24-bit 不会因为降到 44.1 kHz 而变差。',
      '- **源文件的历史**决定高频里到底是音乐，还是已经折叠进来的混叠。',
      '',
      '> 96 kHz 不是“更清楚”的同义词。它买到的是 20 kHz 以上的余量，以及给后续处理留出的空间；代价是文件体积和某些插件的重采样开销。',
      '',
      '对这段鼓组，我建议按下面的顺序检查，而不是直接听一遍就决定：',
      '',
      '1. 读出真实的采样率、位深和时长，确认没有“容器写 96 kHz、流却是 48 kHz”的情况。',
      '2. 看 20–40 kHz 区间有没有音乐性内容，还是只有底噪和超声残留。',
      '3. 做一次带抗混叠滤波的 44.1 kHz 离线重采样，对比 22.05 kHz 以下是否出现新的拍频或“沙砾感”。',
      '4. 只在这个对比有差异时，才讨论保留高采样率母版。',
    ),
  },
  {
    type: 'tool-call',
    id: 'call_demo_meta_01',
    name: 'inspect_audio',
    arguments: JSON.stringify({ path: 'C:\\Users\\alice\\audio-lab\\sessions\\kit-92bpm.wav', ffprobe: true }),
  },
  {
    type: 'tool-call',
    id: 'call_demo_probe_02',
    name: 'spectral_probe',
    arguments: JSON.stringify({ path: 'C:\\Users\\alice\\audio-lab\\sessions\\kit-92bpm.wav', window: 'hann', fft: 262144 }),
  },
]))

events.push(toolCall('call_demo_meta_01', 'inspect_audio', {
  path: 'C:\\Users\\alice\\audio-lab\\sessions\\kit-92bpm.wav',
  ffprobe: true,
}))
events.push(toolResult('call_demo_meta_01', JSON.stringify({
  file: 'C:\\Users\\alice\\audio-lab\\sessions\\kit-92bpm.wav',
  codec: 'pcm_s24le',
  sample_rate: 96000,
  channels: 2,
  duration_seconds: 18.42,
  bit_depth: 24,
  peak_dbfs: -1.8,
  cache_dir: 'C:\\Users\\alice\\.cache\\audio-lab',
  api_key: 'sk-live-demo-7f3a91c2e8b4',
  notes: 'container metadata matches stream; no hidden resample detected',
}, null, 2)))

events.push(toolCall('call_demo_probe_02', 'spectral_probe', {
  path: 'C:\\Users\\alice\\audio-lab\\sessions\\kit-92bpm.wav',
  window: 'hann',
  fft: 262144,
}))
events.push(toolResult('call_demo_probe_02', md(
  'ModuleNotFoundError: No module named \'scipy\'',
  'Traceback (most recent call last):',
  '  File "probe.py", line 3, in <module>',
  '    from scipy.signal import welch',
), true))

events.push(assistantMessage(1, 2, 'fictional-assistant-1005', [
  {
    type: 'reasoning',
    text: '元数据确认了 96 kHz、24-bit，探针失败只是环境缺包，不能把缺包误判成“没有高频”。下一步应该先用 numpy 做一次不依赖 scipy 的粗略检查，再把结论限定在可验证的范围内。混叠公式要写成折叠到目标采样率的绝对差，避免只给一个 22.05 kHz 的口号。',
  },
  {
    type: 'text',
    text: md(
      '### 读数说明',
      '',
      '文件本身没有问题：`96 kHz / 24-bit`，18.42 秒，立体声，峰值 -1.8 dBFS。频谱探针因为环境里没有 `scipy` 失败了，这反而说明第一步应该把依赖固定下来，而不是先相信一张图。',
      '',
      '我把 20–40 kHz 分成三段看：',
      '',
      '| 频段 | 能量形态 | 更像是 | 处理建议 |',
      '| --- | --- | --- | --- |',
      '| 20–24 kHz | 随频率缓慢下降 | 房间底噪与镲片空气感 | 保留，重采样时用线性相位低通 |',
      '| 24–32 kHz | 接近平坦 | 超声残留 | 可滤除，听感几乎无影响 |',
      '| 32–40 kHz | 周期性尖峰 | 可能是时钟谐波或设备噪声 | 先查录音链路，别急着当音乐内容 |',
      '',
      '判断混叠是否发生，关键不是看“有没有高频”，而是看**高频折叠后是否落在可听带内**。若原信号在 $f$ 处有能量，而 $f > f_s/2$，重采样后它会出现在：',
      '',
      '$$',
      'f_{\\text{alias}} = \\left| f - k f_s \\right|, \\quad k = \\operatorname{round}\\left(\\frac{f}{f_s}\\right)',
      '$$',
      '',
      '以 44.1 kHz 为目标时，$f_s/2 = 22.05\\ \\text{kHz}$。一个 24.3 kHz 的窄带分量会折叠到 $44.1 - 24.3 = 19.8\\ \\text{kHz}$，正好落在人耳敏感区。这就是为什么“先低通再降采样”不是可选项。',
    ),
  },
]))

// Turn 2
events.push(event('turn/start', { turn: 2 }))
events.push(event('step/start', { turn: 2, step: 1 }))
events.push(userMessage(2, '如果我只保留 48 kHz 版本，22 kHz 附近这条抬升是混叠还是原本就有的？我该怎么用一次对照实验排除它？', 'fictional-user-2001'))

events.push(assistantMessage(2, 1, 'fictional-assistant-2002', [
  {
    type: 'reasoning',
    text: '单变量对照的关键是只改重采样路径。A/B/C 三轨分别隔离“原始”“一次降采样”“往返”，比较 22.05 kHz 以下的差异和瞬态。先给可执行的结构，再给判据；不要让用户同时换插件和抖动。',
  },
  {
    type: 'text',
    text: md(
      '先做一个**单变量对照**：同一段音频、同一段时长、同一个分析窗，只改变重采样路径。不要同时换插件、换抖动和换音量，否则你无法把差异归因。',
      '',
      '实验分三轨：',
      '',
      '1. `A`：原始 96 kHz，不做任何处理。',
      '2. `B`：96 → 48 kHz，使用带抗混叠滤波的离线重采样（推荐 `soxr` 的 VHQ）。',
      '3. `C`：96 → 48 → 96 kHz 往返，用来观察滤波器群延迟和相位变化。',
      '',
      '对比时只看三样东西：22.05 kHz 以下的频谱差、瞬态包络、以及左右声道的相关性。若 `B` 在 22 kHz 附近出现新的抬升，而 `C` 往返后抬升位置不变，更像是重采样滤波器的过渡带，而不是原始混叠。',
      '',
      '```python',
      'import numpy as np',
      'from scipy.signal import welch',
      '',
      'def band_energy(x, sr, lo, hi):',
      '    f, pxx = welch(x, fs=sr, nperseg=1 << 16)',
      '    mask = (f >= lo) & (f < hi)',
      '    return float(np.trapezoid(pxx[mask], f[mask]))',
      '',
      'for name, path, sr in tracks:',
      '    x = load_wav(path)',
      '    print(name, band_energy(x, sr, 20_000, 22_050))',
      '```',
    ),
  },
  {
    type: 'tool-call',
    id: 'call_demo_resample_03',
    name: 'run_code',
    arguments: JSON.stringify({
      description: 'Compare band energy across resample paths',
      code: 'python tools/band_compare.py --input sessions/kit-92bpm.wav --target 48000',
    }),
  },
]))

events.push(toolCall('call_demo_resample_03', 'run_code', {
  description: 'Compare band energy across resample paths',
  code: 'python tools/band_compare.py --input sessions/kit-92bpm.wav --target 48000',
}))
events.push(toolResult('call_demo_resample_03', line(
  'path          band 19.8–21.0k   band 21.0–22.05k    transients',
  'A 96k           -78.2 dBFS         -81.4 dBFS        reference',
  'B 48k           -77.8 dBFS         -80.5 dBFS        +0.9 dB @ 21.5k',
  'C 96k roundtrip -77.9 dBFS         -80.4 dBFS        +0.8 dB @ 21.5k',
  '',
  'note: all differences below 1 dB; no new narrow peaks under 22.05 kHz',
)))

// A user can interrupt while a turn is still running. Keep it as a real
// user/message event; the reader marks it as an interjection in speech order.
events.push(event('step/start', { turn: 2, step: 2 }))
events.push(userMessage(2, '插一句：底鼓轨道上还挂着一条 1176，压缩会改变瞬态但不应该改变频响。对照时要不要先 bypass？', 'fictional-user-2002'))

events.push(assistantMessage(2, 2, 'fictional-assistant-2003', [
  {
    type: 'reasoning',
    text: '结果差异小于 1 dB，且 B 和 C 形状一致，说明更像滤波器过渡带而不是新混叠。用户中途插话问压缩，需要先回答：旁通后再复测；压缩会改变瞬态包络，不制造 21.5 kHz 窄峰。结论要克制：对这张专辑没有实际影响，但不能外推成“所有 96 kHz 都不需要”。给三条判据，让用户能在别的素材上复用。',
  },
  {
    type: 'text',
    text: md(
      '先回答你插的那句：**先把 1176 旁通再复测**。压缩会改变瞬态包络，但不会在 21.5 kHz 制造窄峰，所以它不改变这次差异的归因；旁通只是让第三项“瞬态包络”的对照更干净。',
      '',
      '### 怎么读这个结果',
      '',
      '+0.9 dB 的能量差在 21.5 kHz 已经接近测量噪声，但它的形状很关键：如果差异是一条窄峰，优先怀疑源文件里的时钟谐波；如果是一条平缓抬升，更像滤波器的过渡带。',
      '',
      '用下面的判据收口：',
      '',
      '- 差异只在 20 kHz 以上，且 16 kHz 以下完全重合 → 对这张专辑没有实际影响，保留 48 kHz 工作版即可。',
      '- 差异在 18–21 kHz 形成可听拍频，或瞬态变软 → 回到 96 kHz 母版，换更长、更陡的线性相位滤波器再做一次。',
      '- 往返后差异扩大 → 检查是否发生了多次重采样，或者导出链里还有一次隐藏的采样率转换。',
      '',
      '> 不要用“高频更多”作为保留高采样率的理由。真正要保留的是**没有混叠、没有相位损伤**的那一版。',
    ),
  },
]))

// Turn 3
events.push(event('turn/start', { turn: 3 }))
events.push(event('step/start', { turn: 3, step: 1 }))
events.push(userMessage(3, '把这些判断写成一个能重复跑的脚本，输入一个 wav，输出一份包含频谱图和结论的 HTML 报告。不要依赖联网。', 'fictional-user-3001'))

events.push(assistantMessage(3, 1, 'fictional-assistant-3002', [
  {
    type: 'reasoning',
    text: '用户要的是可重复，不是功能堆砌。依赖越少越能在离线机器上跑；频谱图用内联 SVG，不要把图片外链出去。24-bit PCM 用标准库读比较麻烦，脚本里要诚实标注这个限制，或者给一个明确的错误。报告结论必须由测量阈值生成，不能写死。',
  },
  {
    type: 'text',
    text: md(
      '可以。脚本只依赖 `numpy` 和标准库，频谱图用 SVG 内联，报告是单文件 HTML。',
      '',
      '```python',
      '# audio_report.py',
      'from pathlib import Path',
      'import json, wave',
      'import numpy as np',
      '',
      'def read_wav(path: Path):',
      '    with wave.open(str(path), "rb") as fh:',
      '        sr = fh.getframerate()',
      '        channels = fh.getnchannels()',
      '        width = fh.getsampwidth()',
      '        raw = fh.readframes(fh.getnframes())',
      '    dtype = {2: "<i2", 3: None, 4: "<i4"}[width]',
      '    if dtype is None:',
      '        raise ValueError("24-bit PCM needs an explicit unpacker")',
      '    return np.frombuffer(raw, dtype=dtype).reshape(-1, channels), sr',
      '',
      'def band_table(x, sr):',
      '    mono = x.mean(axis=1)',
      '    spec = np.abs(np.fft.rfft(mono * np.hanning(len(mono))))',
      '    freqs = np.fft.rfftfreq(len(mono), 1 / sr)',
      '    bands = [(20, 200), (200, 2000), (2000, 10000), (10000, 20000)]',
      '    return [',
      '        {"band": f"{lo}-{hi} Hz", "energy": float(spec[(freqs >= lo) & (freqs < hi)].mean())}',
      '        for lo, hi in bands',
      '    ]',
      '```',
      '',
      '报告结构固定为四段：文件事实、频段能量、混叠判据、建议。`--target 44100` 时额外跑一次低通对照，把差异写进结论，而不是只给一张图。',
    ),
  },
  {
    type: 'tool-call',
    id: 'call_demo_report_04',
    name: 'write_report',
    arguments: JSON.stringify({
      path: 'reports/kit-92bpm.html',
      embed: 'svg-inline',
      sections: ['file', 'bands', 'alias-check', 'verdict'],
    }),
  },
]))

events.push(toolCall('call_demo_report_04', 'write_report', {
  path: 'reports/kit-92bpm.html',
  embed: 'svg-inline',
  sections: ['file', 'bands', 'alias-check', 'verdict'],
}))
events.push(toolResult('call_demo_report_04', line(
  'wrote reports/kit-92bpm.html (38.4 KB)',
  'sections: file, bands, alias-check, verdict',
  'network requests: 0',
)))

events.push(assistantMessage(3, 2, 'fictional-assistant-3003', [
  {
    type: 'reasoning',
    text: '最后提醒验证方式：用已知频率的正弦确认频点，用一段静音确认没有满屏噪声，再看报告在断网时是否能完整打开。这三点比再加一个颜色图例更能证明脚本可信。',
  },
  {
    type: 'text',
    text: md(
      '脚本落在 `tools/audio_report.py`，报告输出到 `reports/<文件名>.html`。默认只读输入文件；`--target` 不传时不会做任何重采样。',
      '',
      '先在一段已知采样率的测试音上跑一遍，确认 1 kHz 正弦的峰值落在正确频点，再拿真实鼓组出报告。这样报告里的每条结论都能追溯到一次可重复的计算。',
    ),
  },
]))

events.push(event('session-log-deepseek/delivery-accepted', {
  sessionId: 'session-demo-spectral',
  sessionFormatVersion: 4,
  throughSeq: 28,
}))

export default events
export { BASE }
