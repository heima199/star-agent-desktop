import { isUtf8 } from 'node:buffer'
import { execFile } from 'node:child_process'

/**
 * Shell output is the bytes of whatever the command ran. On Windows the
 * programs that come with the system (ping, ipconfig, dir, net ...) and many
 * others write the system code page - 936 (GBK) on a Chinese system - not
 * UTF-8. Read as UTF-8 their text is all U+FFFD: the user cannot read it and
 * the model makes its answer up (2026-11-22: asked for the last line of a
 * ping, it invented one).
 *
 * decodeShellOutput reads each line as UTF-8 where it is UTF-8 and as the
 * system code page where it is not, so both kinds of program come out right,
 * also mixed in one output.
 */

/**
 * The Windows code pages this module reads: the East Asian ones, where the
 * console and the "ANSI" code page are the same, so one decoder fits every
 * program. Single-byte systems differ between the two and stay as they were.
 */
const LABELS: Record<number, string> = { 936: 'gbk', 54936: 'gb18030', 950: 'big5', 932: 'shift_jis', 949: 'euc-kr' }

/** Decodes bytes of one code page and throws on bytes that are not text in it. */
export type LegacyDecoder = { decode(bytes: Uint8Array): string }

/** A strict decoder for a Windows code page; null for the code pages left alone. */
export function legacyDecoderFor(codePage: number): LegacyDecoder | null {
  const label = LABELS[codePage]
  if (!label) return null
  try {
    return new TextDecoder(label, { fatal: true })
  } catch {
    return null
  }
}

let system: Promise<LegacyDecoder | null> | undefined

/**
 * The decoder for this system's code page, asked for once. Null off Windows,
 * on a system set to UTF-8, and where the code page is not an East Asian one.
 */
export function systemLegacyDecoder(): Promise<LegacyDecoder | null> {
  system ??= systemCodePage().then(legacyDecoderFor, () => null)
  return system
}

/** Test helper - forces the answer of systemLegacyDecoder; undefined makes it ask the system again. */
export function _setSystemLegacyDecoderForTest(decoder: LegacyDecoder | null | undefined): void {
  system = decoder === undefined ? undefined : Promise.resolve(decoder)
}

function systemCodePage(): Promise<number> {
  if (process.platform !== 'win32') return Promise.resolve(0)
  const reg = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\reg.exe`
  return new Promise(resolve => {
    execFile(reg, ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage', '/v', 'OEMCP'], { windowsHide: true, timeout: 5000 }, (error, stdout) => {
      resolve(error ? 0 : Number(/OEMCP\s+REG_SZ\s+(\d+)/.exec(String(stdout))?.[1] ?? 0))
    })
  })
}

/** Whether the bytes were read from inside a file: such a read can cut a character in half at that end. */
export type OutputEdges = { startsMidway?: boolean; endsMidway?: boolean }

type Line = {
  bytes: Buffer
  /** Well-formed UTF-8 sequences of three bytes and more: those rarely come about by accident. */
  strong: number
  /** Stretches of bytes that are not UTF-8. */
  bad: number
  /** The line in the code page; null when it is not text in it, or holds no byte beyond ASCII. */
  legacy: string | null
}

/**
 * Shell output as text: UTF-8, and the lines that are not UTF-8 in the code
 * page of `legacy`. Without a decoder it is UTF-8 throughout, as it always was.
 */
export function decodeShellOutput(bytes: Buffer, legacy: LegacyDecoder | null, edges: OutputEdges = {}): string {
  const cutAtStart = edges.startsMidway === true
  const cutAtEnd = edges.endsMidway === true
  if (isUtf8(bytes)) return bytes.toString('utf8')
  if (!legacy) return utf8Part(bytes, cutAtStart, cutAtEnd).toString('utf8')

  const lines: Line[] = []
  let from = 0
  while (from < bytes.length) {
    const feed = bytes.indexOf(0x0a, from)
    const to = feed === -1 ? bytes.length : feed + 1
    lines.push(readLine(bytes.subarray(from, to), legacy, cutAtStart && from === 0, cutAtEnd && to === bytes.length))
    from = to
  }
  const utf8Lines = lines.some(line => line.strong > 0 && line.bad === 0)
  const legacyLines = lines.some(line => line.legacy !== null && line.strong === 0 && line.bad > 0)
  return lines
    .map((line, index) =>
      inLegacy(line, utf8Lines, legacyLines)
        ? line.legacy!
        : utf8Part(line.bytes, cutAtStart && index === 0, cutAtEnd && index === lines.length - 1).toString('utf8'),
    )
    .join('')
}

/** Whether a line is read in the code page. */
function inLegacy(line: Line, utf8Lines: boolean, legacyLines: boolean): boolean {
  if (line.legacy === null) return false
  if (line.strong === 0 && line.bad > 0) return true
  if (line.strong > 0 && line.bad === 0) return false
  // Text both ways (GBK "谢谢" is valid UTF-8, and so is a lone "©"), or UTF-8 with a stray byte that also
  // happens to be text in the code page: such a line goes with the rest of the output where that is of one kind.
  if (legacyLines !== utf8Lines) return legacyLines
  // On its own: UTF-8 with damage has more whole characters than damaged spots.
  return line.bad > 0 && line.strong <= line.bad
}

function readLine(bytes: Buffer, legacy: LegacyDecoder, cutAtStart: boolean, cutAtEnd: boolean): Line {
  if (bytes.every(byte => byte < 0x80)) return { bytes, strong: 0, bad: 0, legacy: null }
  const { strong, bad } = utf8Evidence(utf8Part(bytes, cutAtStart, cutAtEnd))
  return { bytes, strong, bad, legacy: strong > 0 && bad === 0 ? null : legacyText(bytes, legacy, cutAtStart, cutAtEnd) }
}

const continues = (byte: number | undefined): boolean => byte !== undefined && (byte & 0xc0) === 0x80

/** The length of the well-formed UTF-8 sequence that starts at `at`; 0 when there is none. */
function sequenceAt(bytes: Buffer, at: number): number {
  const lead = bytes[at]!
  const second = bytes[at + 1]
  if (lead >= 0xc2 && lead <= 0xdf) return continues(second) ? 2 : 0
  if (lead >= 0xe0 && lead <= 0xef) {
    if (!continues(second) || !continues(bytes[at + 2])) return 0
    // Not an overlong form, not a surrogate.
    return (lead === 0xe0 && second! < 0xa0) || (lead === 0xed && second! > 0x9f) ? 0 : 3
  }
  if (lead >= 0xf0 && lead <= 0xf4) {
    if (!continues(second) || !continues(bytes[at + 2]) || !continues(bytes[at + 3])) return 0
    return (lead === 0xf0 && second! < 0x90) || (lead === 0xf4 && second! > 0x8f) ? 0 : 4
  }
  return 0
}

function utf8Evidence(bytes: Buffer): { strong: number; bad: number } {
  let strong = 0
  let bad = 0
  let inBad = false
  let at = 0
  while (at < bytes.length) {
    const length = bytes[at]! < 0x80 ? 1 : sequenceAt(bytes, at)
    if (length >= 3) strong++
    if (!length && !inBad) bad++
    inBad = !length
    at += length || 1
  }
  return { strong, bad }
}

/** The bytes without a UTF-8 sequence that the edge of the read cut in half. */
function utf8Part(bytes: Buffer, cutAtStart: boolean, cutAtEnd: boolean): Buffer {
  let start = 0
  let end = bytes.length
  if (cutAtStart) while (start < end && start < 3 && continues(bytes[start])) start++
  if (cutAtEnd) {
    let lead = end - 1
    let following = 0
    while (lead >= start && following < 3 && continues(bytes[lead])) {
      lead--
      following++
    }
    if (lead >= start) {
      const byte = bytes[lead]!
      const announced = byte >= 0xf0 ? 3 : byte >= 0xe0 ? 2 : byte >= 0xc0 ? 1 : 0
      if (announced > following) end = lead
    }
  }
  return start === 0 && end === bytes.length ? bytes : bytes.subarray(start, end)
}

/**
 * The line in the code page, or null when it is not text in it. A cut edge may
 * have left half a character, and so may a command that is still writing: its
 * last line, not yet ended, can stop on the first byte of one.
 */
function legacyText(bytes: Buffer, legacy: LegacyDecoder, cutAtStart: boolean, cutAtEnd: boolean): string | null {
  const unfinished = bytes[bytes.length - 1] !== 0x0a
  for (const skip of cutAtStart ? [0, 1] : [0]) {
    for (const drop of cutAtEnd || unfinished ? [0, 1] : [0]) {
      if (skip + drop >= bytes.length) continue
      try {
        return (skip ? '\ufffd' : '') + legacy.decode(bytes.subarray(skip, bytes.length - drop)) + (drop ? '\ufffd' : '')
      } catch {
        // Not text with this cut.
      }
    }
  }
  return null
}
