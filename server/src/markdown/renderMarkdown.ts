import 'katex/dist/katex.min.css'
import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'
import katex from 'katex'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import sql from 'highlight.js/lib/languages/sql'
import yaml from 'highlight.js/lib/languages/yaml'
import markdown from 'highlight.js/lib/languages/markdown'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import diff from 'highlight.js/lib/languages/diff'
import plaintext from 'highlight.js/lib/languages/plaintext'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('json', json)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('diff', diff)
hljs.registerLanguage('plaintext', plaintext)

const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  html: 'xml',
  svg: 'xml',
  vue: 'xml',
  yml: 'yaml',
  md: 'markdown',
  rs: 'rust',
  text: 'plaintext',
  txt: 'plaintext',
}

const MATH_LANGS = new Set(['math', 'latex', 'tex'])

function renderMath(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
      output: 'html',
    })
  } catch {
    const escaped = md.utils.escapeHtml(tex)
    return `<code class="math-error" title="LaTeX 渲染失败">${escaped}</code>`
  }
}

function mathPlugin(instance: MarkdownIt): void {
  instance.inline.ruler.before('escape', 'math_inline_dollar', (state, silent) => {
    const start = state.pos
    const src = state.src
    if (src[start] !== '$' || src[start + 1] === '$') return false
    if (start > 0 && src[start - 1] === '\\') return false
    if (/\s/.test(src[start + 1] ?? '')) return false
    let pos = start + 1
    let end = -1
    while (pos < src.length) {
      const next = src.indexOf('$', pos)
      if (next === -1) break
      if (src[next - 1] !== '\\') {
        end = next
        break
      }
      pos = next + 1
    }
    if (end === -1) return false
    const content = src.slice(start + 1, end)
    if (!content.trim() || content.includes('\n')) return false
    if (!silent) {
      const token = state.push('math_inline', 'math', 0)
      token.content = content
      token.markup = '$'
    }
    state.pos = end + 1
    return true
  })

  instance.inline.ruler.before('escape', 'math_inline_paren', (state, silent) => {
    const start = state.pos
    const src = state.src
    if (src.slice(start, start + 2) !== '\\(') return false
    const end = src.indexOf('\\)', start + 2)
    if (end === -1) return false
    const content = src.slice(start + 2, end)
    if (!content.trim()) return false
    if (!silent) {
      const token = state.push('math_inline', 'math', 0)
      token.content = content
      token.markup = '\\('
    }
    state.pos = end + 2
    return true
  })

  const blockMath = (state: any, startLine: number, endLine: number, silent: boolean): boolean => {
    const start = state.bMarks[startLine] + state.tShift[startLine]
    const max = state.eMarks[startLine]
    const firstLine = state.src.slice(start, max)
    const open = firstLine.startsWith('$$') ? '$$' : firstLine.startsWith('\\[') ? '\\[' : ''
    if (!open) return false
    const close = open === '$$' ? '$$' : '\\]'
    const afterOpen = firstLine.slice(open.length)
    let content = ''
    let nextLine = startLine + 1

    if (afterOpen.includes(close)) {
      content = afterOpen.slice(0, afterOpen.indexOf(close))
    } else {
      content = afterOpen
      let found = false
      for (; nextLine < endLine; nextLine += 1) {
        const lineStart = state.bMarks[nextLine] + state.tShift[nextLine]
        const lineEnd = state.eMarks[nextLine]
        const line = state.src.slice(lineStart, lineEnd)
        const closeAt = line.indexOf(close)
        if (closeAt !== -1) {
          content += `\n${line.slice(0, closeAt)}`
          found = true
          nextLine += 1
          break
        }
        content += `\n${line}`
      }
      if (!found) return false
    }

    if (silent) return true
    const token = state.push('math_block', 'math', 0)
    token.block = true
    token.content = content.trim()
    token.map = [startLine, nextLine]
    state.line = nextLine
    return true
  }

  instance.block.ruler.before('fence', 'math_block', blockMath, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  })

  instance.renderer.rules.math_inline = (tokens, idx) => renderMath(tokens[idx].content, false)
  instance.renderer.rules.math_block = (tokens, idx) => {
    return `<div class="math-display">${renderMath(tokens[idx].content, true)}</div>`
  }
}

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
  highlight(code, language) {
    const requested = (language || '').trim().toLowerCase()
    const lang = LANGUAGE_ALIASES[requested] ?? requested
    try {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
      }
    } catch {
      // fall through to escaped text
    }
    return md.utils.escapeHtml(code)
  },
})

mathPlugin(md)

md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]
  const info = token.info.trim()
  const language = info.split(/\s+/)[0]?.toLowerCase() ?? ''
  if (MATH_LANGS.has(language)) {
    return `<div class="math-display">${renderMath(token.content, true)}</div>`
  }
  const displayLang = language || 'text'
  const alias = LANGUAGE_ALIASES[language] ?? language
  let highlighted: string
  try {
    highlighted =
      alias && hljs.getLanguage(alias)
        ? hljs.highlight(token.content, { language: alias, ignoreIllegals: true }).value
        : md.utils.escapeHtml(token.content)
  } catch {
    highlighted = md.utils.escapeHtml(token.content)
  }
  return [
    `<figure class="code-block" data-lang="${md.utils.escapeHtml(displayLang)}">`,
    '<figcaption class="code-head">',
    `<span class="code-lang">${md.utils.escapeHtml(displayLang)}</span>`,
    '<button class="code-copy" type="button" data-copy>复制</button>',
    '</figcaption>',
    `<pre class="code-pre"><code class="hljs">${highlighted}</code></pre>`,
    '</figure>',
  ].join('')
}

md.renderer.rules.table_open = () => '<div class="table-scroll"><table class="md-table">'
md.renderer.rules.table_close = () => '</table></div>'

md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  const token = tokens[idx]
  const href = token.attrGet('href') ?? ''
  if (/^https?:/i.test(href)) {
    token.attrSet('target', '_blank')
    token.attrSet('rel', 'noreferrer noopener')
    token.attrJoin('class', 'md-link is-external')
  } else {
    token.attrJoin('class', 'md-link')
  }
  return self.renderToken(tokens, idx, options)
}

md.renderer.rules.link_close = (tokens, idx, options, _env, self) => {
  const open = tokens[idx - 1]
  const external = open?.type === 'link_open' && /^https?:/i.test(open.attrGet('href') ?? '')
  return `${external ? '<span class="ext-mark" aria-hidden="true">↗</span>' : ''}${self.renderToken(tokens, idx, options)}`
}

md.renderer.rules.image = (tokens, idx) => {
  const token = tokens[idx]
  const src = token.attrGet('src') ?? ''
  const alt = token.content || '图片'
  if (/^data:image\//i.test(src)) {
    return `<img class="md-image" src="${md.utils.escapeHtml(src)}" alt="${md.utils.escapeHtml(alt)}" loading="lazy" decoding="async">`
  }
  return `<span class="blocked-image" role="note"><span class="blocked-image-label">外部图片已省略</span><span class="blocked-image-src">${md.utils.escapeHtml(src)}</span></span>`
}

export function renderMarkdown(source: string): string {
  if (!source.trim()) return ''
  return md.render(source)
}

export function escapeHtml(value: string): string {
  return md.utils.escapeHtml(value)
}

export interface MarkdownHeading {
  id: string
  level: number
  text: string
}

/** Extract h2/h3 headings so long replies can offer a small in-place outline. */
export function extractHeadings(source: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = []
  const tokens = md.parse(source, {})
  const seen = new Map<string, number>()
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token.type !== 'heading_open') continue
    const level = Number(token.tag.slice(1))
    if (level < 2 || level > 3) continue
    const inline = tokens[i + 1]
    const text = inline?.content?.replace(/\s+/g, ' ').trim() ?? ''
    if (!text) continue
    const base = text
      .toLowerCase()
      .replace(/[\s`~!@#$%^&*()+=[\]{};:'",.<>/?\\|，。！？；：、“”‘’（）【】《》—…·]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'section'
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    headings.push({ id: count ? `${base}-${count}` : base, level, text })
  }
  return headings
}
