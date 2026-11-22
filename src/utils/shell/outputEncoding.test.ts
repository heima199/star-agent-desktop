import { describe, expect, test } from 'bun:test'
import { decodeShellOutput, legacyDecoderFor } from './outputEncoding.js'

const hex = (text: string) => Buffer.from(text, 'hex')
const utf8 = (text: string) => Buffer.from(text, 'utf8')
const gbk = legacyDecoderFor(936)!

// What a Chinese Windows writes, in its code page (GBK).
const PING_TEXT = '正在 Ping 127.0.0.1 具有 32 字节的数据:'
const PING = hex('d5fdd4da2050696e67203132372e302e302e3120bedfd3d020333220d7d6bddab5c4cafdbedd3a')
const LAST_TEXT = '    最短 = 0ms，最长 = 0ms，平均 = 0ms'
const LAST = hex('20202020d7eeb6cc203d20306d73a3acd7eeb3a4203d20306d73a3acc6bdbef9203d20306d73')
const NEW_FILE = hex('d0c2cec4bcfe') // 新文件
const THANKS = hex('d0bbd0bb') // 谢谢 - these bytes are also valid UTF-8: "лл"
const CRLF = utf8('\r\n')

describe('decodeShellOutput', () => {
  test('reads what a command of a Chinese Windows wrote', () => {
    const output = Buffer.concat([CRLF, PING, CRLF, LAST, CRLF])
    expect(output.toString('utf8')).toContain('\ufffd')
    expect(decodeShellOutput(output, gbk)).toBe(`\r\n${PING_TEXT}\r\n${LAST_TEXT}\r\n`)
  })

  test('leaves UTF-8 output as it is', () => {
    const text = 'On branch main\n新文件：  说明.md\n© 2026 · done ✓\n'
    expect(decodeShellOutput(utf8(text), gbk)).toBe(text)
  })

  test('reads each line in its own encoding when programs of both kinds wrote', () => {
    const output = Buffer.concat([utf8('git: 新文件 说明.md\n'), PING, CRLF, utf8('done ✓\n')])
    expect(decodeShellOutput(output, gbk)).toBe(`git: 新文件 说明.md\n${PING_TEXT}\r\ndone ✓\n`)
  })

  test('a line that is text both ways goes with the rest of the output', () => {
    // Among lines of the code page it is the code page ...
    expect(decodeShellOutput(Buffer.concat([NEW_FILE, CRLF, THANKS, CRLF]), gbk)).toBe('新文件\r\n谢谢\r\n')
    // ... next to a line that can only be UTF-8 it is UTF-8 ...
    expect(decodeShellOutput(Buffer.concat([utf8('名称 лл\n'), THANKS, utf8('\n'), hex('ff0a')]), gbk)).toBe('名称 лл\nлл\n\ufffd\n')
    // ... and on its own, or between lines of both kinds, it stays UTF-8, as it always was.
    expect(decodeShellOutput(THANKS, gbk)).toBe('лл')
    expect(decodeShellOutput(Buffer.concat([utf8('说明\n'), NEW_FILE, utf8('\n'), THANKS, utf8('\n')]), gbk)).toBe('说明\n新文件\nлл\n')
  })

  test('a stray byte in a UTF-8 line stays a stray byte', () => {
    // A name cut off inside a character. As GBK these bytes are text too.
    const line = Buffer.concat([utf8('文件'), hex('e995'), utf8('...\n')])
    expect(() => gbk.decode(line)).not.toThrow()
    expect(decodeShellOutput(line, gbk)).toBe(line.toString('utf8'))
    expect(decodeShellOutput(line, gbk)).toStartWith('文件\ufffd')
  })

  test('code-page characters that happen to hold a UTF-8 sequence stay code page', () => {
    // Two GBK characters whose last three bytes read 中 as UTF-8.
    const line = hex('d6e4b8ad')
    const text = gbk.decode(line)
    expect(text).toHaveLength(2)
    expect(decodeShellOutput(line, gbk)).toBe(text)
    expect(decodeShellOutput(Buffer.concat([PING, CRLF, line, CRLF]), gbk)).toBe(`${PING_TEXT}\r\n${text}\r\n`)
  })

  test('a read from inside the file may start or end on half a character', () => {
    const output = Buffer.concat([PING, CRLF, LAST, CRLF])
    // A tail that starts on the second byte of 正.
    expect(decodeShellOutput(output.subarray(1), gbk, { startsMidway: true })).toBe(`\ufffd在 Ping 127.0.0.1 具有 32 字节的数据:\r\n${LAST_TEXT}\r\n`)
    // A read that ends on the first byte of 均.
    const cut = output.subarray(0, output.length - CRLF.length - ' = 0ms'.length - 1)
    expect(decodeShellOutput(cut, gbk, { endsMidway: true })).toBe(`${PING_TEXT}\r\n    最短 = 0ms，最长 = 0ms，平\ufffd`)
    // The same when the command is still writing and its last line has stopped there.
    expect(decodeShellOutput(cut, gbk)).toBe(`${PING_TEXT}\r\n    最短 = 0ms，最长 = 0ms，平\ufffd`)
    // UTF-8 cut the same way loses only the half character.
    const text = utf8('中文输出\n第二行\n')
    expect(decodeShellOutput(text.subarray(1), gbk, { startsMidway: true })).toBe('文输出\n第二行\n')
    expect(decodeShellOutput(text.subarray(0, text.length - 3), gbk, { endsMidway: true })).toBe('中文输出\n第二')
  })

  test('bytes that are text in neither come out as they always did', () => {
    const bytes = hex('fffe00018020ff0a61ff0a')
    expect(decodeShellOutput(bytes, gbk)).toBe(bytes.toString('utf8'))
  })

  test('without a code page everything is UTF-8', () => {
    const output = Buffer.concat([PING, CRLF, utf8('完成\n')])
    expect(decodeShellOutput(output, null)).toBe(output.toString('utf8'))
    const text = utf8('中文输出\n')
    expect(decodeShellOutput(text.subarray(1), null)).toBe(text.subarray(1).toString('utf8'))
    expect(decodeShellOutput(text.subarray(1), null, { startsMidway: true })).toBe('文输出\n')
  })
})

describe('legacyDecoderFor', () => {
  test('knows the East Asian code pages and leaves the others alone', () => {
    expect(legacyDecoderFor(936)!.decode(hex('d6d0cec4'))).toBe('中文')
    expect(legacyDecoderFor(950)!.decode(hex('b4fab8d5'))).toBe('測試')
    expect(legacyDecoderFor(932)!.decode(hex('836583588367'))).toBe('テスト')
    for (const page of [0, 437, 850, 1252, 65001]) expect(legacyDecoderFor(page)).toBeNull()
  })

  test('refuses bytes that are not text in the code page', () => {
    expect(() => gbk.decode(hex('d6d0ff'))).toThrow()
    expect(() => gbk.decode(hex('d620'))).toThrow()
  })
})
