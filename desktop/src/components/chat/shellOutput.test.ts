import { describe, expect, it } from 'vitest'
import {
  capOutputText,
  formatDuration,
  isNoOutputMarker,
  isShellTool,
  OUTPUT_EXPANDED_CHARS,
  prepareShellOutput,
  resolveShellOutputKind,
  sanitizeShellOutput,
  SHELL_OUTPUT_COLLAPSED_CHARS,
} from './ToolCallBlock'
import { toolCallDurationMs } from './ToolCallGroup'

describe('isShellTool', () => {
  it('covers both shell tools that carry a command input', () => {
    expect(isShellTool('Bash')).toBe(true)
    expect(isShellTool('PowerShell')).toBe(true)
  })

  it('excludes tools whose results are not command output', () => {
    for (const toolName of ['Read', 'Edit', 'Write', 'Grep', 'Agent']) {
      expect(isShellTool(toolName)).toBe(false)
    }
  })
})

describe('prepareShellOutput', () => {
  it('returns empty output for a command that printed nothing', () => {
    expect(prepareShellOutput('', false)).toEqual({
      visible: '',
      full: '',
      hiddenLines: 0,
      hiddenChars: 0,
      collapsible: false,
      truncated: false,
    })
  })

  it('treats whitespace-only output as empty', () => {
    expect(prepareShellOutput('\n\n   \n', false).visible).toBe('')
  })

  it('shows short output whole, with no toggle offered', () => {
    const result = prepareShellOutput('pypdf available\npdfplumber available', false)

    expect(result.visible).toBe('pypdf available\npdfplumber available')
    expect(result.hiddenLines).toBe(0)
    expect(result.collapsible).toBe(false)
  })

  it('keeps the head and reports the remainder when collapsed', () => {
    const text = Array.from({ length: 40 }, (_, index) => `line-${index + 1}`).join('\n')
    const result = prepareShellOutput(text, false)

    expect(result.visible).toBe(Array.from({ length: 12 }, (_, i) => `line-${i + 1}`).join('\n'))
    expect(result.hiddenLines).toBe(28)
    // `full` always carries everything so Copy yields the real output.
    expect(result.full).toBe(text)
  })

  it('reveals everything when expanded but STAYS collapsible', () => {
    const text = Array.from({ length: 40 }, (_, index) => `line-${index + 1}`).join('\n')
    const result = prepareShellOutput(text, true)

    expect(result.visible).toBe(text)
    expect(result.hiddenLines).toBe(0)
    // Regression guard: gating the toggle on hiddenLines alone made "Show less"
    // unreachable, because expanding unmounted the button that collapses it.
    expect(result.collapsible).toBe(true)
  })

  it('honours a custom collapsed window', () => {
    const text = 'a\nb\nc\nd\ne'

    expect(prepareShellOutput(text, false, 2)).toMatchObject({
      visible: 'a\nb',
      hiddenLines: 3,
    })
  })

  it('does not count a hidden line when output ends with a trailing newline', () => {
    // Shell output almost always ends in EOL; a naive split would report a
    // phantom extra line and offer a "1 more line" button revealing nothing.
    const result = prepareShellOutput('a\nb\n', false, 2)

    expect(result.visible).toBe('a\nb')
    expect(result.hiddenLines).toBe(0)
  })

  it('strips ANSI colour codes the desktop cannot render', () => {
    const result = prepareShellOutput('[32mpassed[0m', false)

    expect(result.visible).toBe('passed')
  })

  it('collapses one very long line by characters, not lines', () => {
    // Minified JSON or base64 is a single line, so the 12-line window alone
    // never closed and the whole blob rendered collapsed.
    const text = 'x'.repeat(10_000)
    const result = prepareShellOutput(text, false)

    expect(result.visible).toHaveLength(SHELL_OUTPUT_COLLAPSED_CHARS)
    expect(result.hiddenLines).toBe(0)
    expect(result.hiddenChars).toBe(10_000 - SHELL_OUTPUT_COLLAPSED_CHARS)
    expect(result.collapsible).toBe(true)
    expect(result.truncated).toBe(false)
    expect(result.full).toBe(text)
  })

  it('caps expanded output and says so, while full keeps everything for Copy', () => {
    const text = 'y'.repeat(OUTPUT_EXPANDED_CHARS + 5_000)
    const result = prepareShellOutput(text, true)

    expect(result.visible).toHaveLength(OUTPUT_EXPANDED_CHARS)
    expect(result.truncated).toBe(true)
    expect(result.collapsible).toBe(true)
    expect(result.full).toBe(text)
  })

  it('counts only the lines expanding actually reveals', () => {
    // Past the expanded cap the rest lives in the copy only, so the toggle must
    // not promise lines it will never show.
    const text = Array.from({ length: 5_000 }, (_, index) => `row-${String(index).padStart(5, '0')}`).join('\n')
    const collapsed = prepareShellOutput(text, false)
    const expanded = prepareShellOutput(text, true)

    expect(expanded.truncated).toBe(true)
    expect(collapsed.hiddenLines).toBe(expanded.visible.split('\n').length - 12)
  })

  it('gives errors no line window but still the character window', () => {
    const lines = Array.from({ length: 40 }, (_, index) => `error-${index + 1}`).join('\n')
    expect(prepareShellOutput(lines, false, null)).toMatchObject({
      visible: lines,
      collapsible: false,
    })

    // Ten 1,000-character lines: the cut backs up to the line break inside
    // the window instead of splitting the fourth line.
    const longLines = Array.from({ length: 10 }, (_, index) => String(index).repeat(1_000)).join('\n')
    const result = prepareShellOutput(longLines, false, null)

    expect(result.visible).toBe(longLines.split('\n').slice(0, 3).join('\n'))
    expect(result.hiddenLines).toBe(7)
    expect(result.hiddenChars).toBe(0)
    expect(result.collapsible).toBe(true)
  })

  it('never cuts between the halves of a surrogate pair', () => {
    const text = 'a'.repeat(SHELL_OUTPUT_COLLAPSED_CHARS - 1) + '😀' + 'b'.repeat(100)
    const result = prepareShellOutput(text, false)

    expect(result.visible).toBe('a'.repeat(SHELL_OUTPUT_COLLAPSED_CHARS - 1))
    expect(result.hiddenChars).toBe(text.length - (SHELL_OUTPUT_COLLAPSED_CHARS - 1))
  })
})

describe('capOutputText', () => {
  it('leaves text under the cap whole', () => {
    expect(capOutputText('short failure')).toEqual({ text: 'short failure', truncated: false })
  })

  it('cuts text over the cap and reports it', () => {
    const text = 'z'.repeat(OUTPUT_EXPANDED_CHARS + 1)

    expect(capOutputText(text)).toEqual({ text: 'z'.repeat(OUTPUT_EXPANDED_CHARS), truncated: true })
    expect(capOutputText('abcdef', 4)).toEqual({ text: 'abcd', truncated: true })
  })
})

describe('sanitizeShellOutput', () => {
  it('strips non-SGR CSI sequences, not just colours', () => {
    // Erase-line + cursor-up, as emitted by pip/npm progress rendering. Stripping
    // only the `m` colour codes left these to print as literal junk.
    expect(sanitizeShellOutput('[2K[1AReticulating')).toBe('Reticulating')
  })

  it('strips OSC window-title strings terminated by BEL or ST', () => {
    expect(sanitizeShellOutput(']0;my titledone')).toBe('done')
    expect(sanitizeShellOutput(']0;my title\\done')).toBe('done')
  })

  it('resolves carriage-return overwrites the way a terminal would', () => {
    // A progress line rewrites itself in place; only its final state is real.
    expect(sanitizeShellOutput('Downloading\r 10%\r100%')).toBe('100%')
  })

  it('normalises CRLF instead of leaving stray CRs', () => {
    expect(sanitizeShellOutput('line-1\r\nline-2\r\nline-3')).toBe('line-1\nline-2\nline-3')
  })

  it('leaves output without control characters untouched', () => {
    expect(sanitizeShellOutput('plain\noutput')).toBe('plain\noutput')
  })

  it('trims a long whitespace run in linear time', () => {
    // `.replace(/\s+$/, '')` backtracks catastrophically when the whitespace run
    // is NOT at the end — and BashTool's own "... [N lines truncated] ..." suffix
    // guarantees exactly that shape. Measured 318ms at the 30k Bash cap and 8.3s
    // at the 150k env ceiling; .trimEnd() is ~0.08ms.
    const pathological = ' '.repeat(30_000) + '... [12 lines truncated] ...'

    const started = performance.now()
    const result = sanitizeShellOutput(pathological)
    const elapsed = performance.now() - started

    expect(result).toBe(pathological.trimEnd())
    expect(elapsed).toBeLessThan(50)
  })

  it('trims thousands of blank lines in linear time', () => {
    // \s matches \n, so `yes '' | head -30000` hits the same path.
    const pathological = '\n'.repeat(30_000) + 'done'

    const started = performance.now()
    sanitizeShellOutput(pathological)

    expect(performance.now() - started).toBeLessThan(50)
  })
})

describe('prepareShellOutput on Windows line endings', () => {
  it('does not leave a dangling CR at the collapse boundary', () => {
    // Slicing to the nth \n kept the preceding \r, and CSS white-space:pre-wrap
    // treats a lone CR as a segment break — one extra blank line on Windows,
    // which is exactly the platform the #1149 reporter is on.
    const crlf = Array.from({ length: 20 }, (_, index) => `line-${index + 1}`).join('\r\n')
    const result = prepareShellOutput(crlf, false, 3)

    expect(result.visible).toBe('line-1\nline-2\nline-3')
    expect(result.visible.endsWith('\r')).toBe(false)
    expect(result.hiddenLines).toBe(17)
  })
})

describe('isNoOutputMarker', () => {
  it('recognises the marker the CLI substitutes for empty results', () => {
    // src/utils/toolResultStorage.ts replaces empty content with this string, so
    // the desktop never actually receives '' (inc-4586).
    expect(isNoOutputMarker('(Bash completed with no output)', 'Bash')).toBe(true)
    expect(isNoOutputMarker('(PowerShell completed with no output)', 'PowerShell')).toBe(true)
  })

  it('tolerates surrounding whitespace', () => {
    expect(isNoOutputMarker('\n(Bash completed with no output)\n', 'Bash')).toBe(true)
  })

  it('does not match a different tool name', () => {
    expect(isNoOutputMarker('(Read completed with no output)', 'Bash')).toBe(false)
  })

  it('does not match real command output that merely mentions output', () => {
    expect(isNoOutputMarker('no output produced', 'Bash')).toBe(false)
  })
})

describe('resolveShellOutputKind', () => {
  it('reads the CLI no-output marker as empty', () => {
    expect(resolveShellOutputKind('(Bash completed with no output)', 'Bash')).toEqual({ kind: 'empty' })
  })

  it('treats a genuinely empty payload as empty', () => {
    expect(resolveShellOutputKind('', 'Bash')).toEqual({ kind: 'empty' })
    expect(resolveShellOutputKind(null, 'Bash')).toEqual({ kind: 'empty' })
    expect(resolveShellOutputKind([], 'Bash')).toEqual({ kind: 'empty' })
  })

  it('returns text for ordinary output', () => {
    expect(resolveShellOutputKind('pypdf available', 'Bash')).toEqual({
      kind: 'text',
      text: 'pypdf available',
    })
  })

  it('reads text blocks out of an array payload', () => {
    expect(resolveShellOutputKind([{ type: 'text', text: 'hello' }], 'Bash')).toEqual({
      kind: 'text',
      text: 'hello',
    })
  })

  it('marks an image-only result opaque rather than empty', () => {
    // extractTextContent flattens image blocks to '', which must NOT be reported
    // as "the command printed nothing".
    expect(resolveShellOutputKind([{ type: 'image', source: { data: 'x' } }], 'Bash')).toEqual({
      kind: 'opaque',
    })
  })

  it('treats output that sanitizes down to nothing as empty', () => {
    // A payload of pure control sequences leaves no renderable text.
    expect(resolveShellOutputKind('[2K[1A', 'Bash')).toEqual({ kind: 'empty' })
  })
})

describe('formatDuration', () => {
  it('renders sub-second durations in milliseconds', () => {
    expect(formatDuration(524)).toBe('524ms')
  })

  it('renders seconds with one decimal below ten seconds', () => {
    expect(formatDuration(1598)).toBe('1.6s')
  })

  it('drops the decimal once past ten seconds', () => {
    expect(formatDuration(27_000)).toBe('27s')
  })

  it('never emits an impossible seconds part', () => {
    // Math.floor(minutes) disagreed with Math.round(seconds % 60), printing
    // '1m60s' for 119.6s. Round once to whole seconds, then derive the parts.
    expect(formatDuration(119_600)).toBe('2m0s')
    expect(formatDuration(59_500)).toBe('1m0s')
  })

  it('does not keep a decimal after rounding up to ten seconds', () => {
    expect(formatDuration(9999)).toBe('10s')
  })

  it('promotes to hours instead of counting past sixty minutes', () => {
    expect(formatDuration(3_600_000)).toBe('1h0m')
  })

  it('switches to minutes for long commands', () => {
    expect(formatDuration(125_000)).toBe('2m5s')
  })
})

describe('toolCallDurationMs', () => {
  it('is undefined while the tool is still running', () => {
    expect(toolCallDurationMs({ timestamp: 1000 }, undefined)).toBeUndefined()
  })

  it('measures the gap between tool_use and tool_result', () => {
    expect(toolCallDurationMs({ timestamp: 1000 }, { timestamp: 1524 })).toBe(524)
  })

  it('discards a negative gap rather than rendering nonsense', () => {
    // Replayed / reordered transcripts can land a result before its call.
    expect(toolCallDurationMs({ timestamp: 2000 }, { timestamp: 1000 })).toBeUndefined()
  })
})
