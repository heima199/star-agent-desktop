import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileRange, tailFile } from './fsOperations.js'
import { _setSystemLegacyDecoderForTest, legacyDecoderFor } from './shell/outputEncoding.js'

const hex = (text: string) => Buffer.from(text, 'hex')
const CRLF = Buffer.from('\r\n')

// Two lines of a ping on a Chinese Windows, in its code page (GBK).
const PING_TEXT = '正在 Ping 127.0.0.1 具有 32 字节的数据:'
const PING = hex('d5fdd4da2050696e67203132372e302e302e3120bedfd3d020333220d7d6bddab5c4cafdbedd3a')
const LAST_TEXT = '    最短 = 0ms，最长 = 0ms，平均 = 0ms'
const LAST = hex('20202020d7eeb6cc203d20306d73a3acd7eeb3a4203d20306d73a3acc6bdbef9203d20306d73')
const OUTPUT = Buffer.concat([PING, CRLF, LAST, CRLF])

let directory: string
let file: string

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'task-output-encoding-'))
  file = join(directory, 'task.output')
})
afterEach(() => _setSystemLegacyDecoderForTest(undefined))
afterAll(() => rm(directory, { recursive: true, force: true }))

describe('task output a command wrote in the system code page', () => {
  test('readFileRange reads it as text and counts bytes as before', async () => {
    _setSystemLegacyDecoderForTest(legacyDecoderFor(936))
    await writeFile(file, OUTPUT)
    expect(await readFileRange(file, 0, 1024)).toEqual({
      content: `${PING_TEXT}\r\n${LAST_TEXT}\r\n`,
      bytesRead: OUTPUT.length,
      bytesTotal: OUTPUT.length,
    })
  })

  test('readFileRange marks the half characters at the edges of a range', async () => {
    _setSystemLegacyDecoderForTest(legacyDecoderFor(936))
    await writeFile(file, OUTPUT)
    // From the second byte of 正 to the first byte of 具.
    expect(await readFileRange(file, 1, 20)).toEqual({
      content: '\ufffd在 Ping 127.0.0.1 \ufffd',
      bytesRead: 20,
      bytesTotal: OUTPUT.length,
    })
  })

  test('tailFile reads a tail that starts inside a character', async () => {
    _setSystemLegacyDecoderForTest(legacyDecoderFor(936))
    await writeFile(file, OUTPUT)
    // The tail starts on the second byte of the first 最.
    const maxBytes = LAST.length + CRLF.length - 5
    expect(await tailFile(file, maxBytes)).toEqual({
      content: '\ufffd短 = 0ms，最长 = 0ms，平均 = 0ms\r\n',
      bytesRead: maxBytes,
      bytesTotal: OUTPUT.length,
    })
    expect((await tailFile(file, 1024)).content).toBe(`${PING_TEXT}\r\n${LAST_TEXT}\r\n`)
  })

  test('UTF-8 output stays what it was on such a system', async () => {
    _setSystemLegacyDecoderForTest(legacyDecoderFor(936))
    const text = 'On branch main\n新文件：  说明.md\ndone ✓\n'
    await writeFile(file, text)
    expect((await readFileRange(file, 0, 1024))!.content).toBe(text)
    expect((await tailFile(file, 1024)).content).toBe(text)
    // A range that cuts 新 and 说 in half loses only those halves.
    const bytes = Buffer.from(text)
    const from = bytes.indexOf(Buffer.from('新')) + 1
    const to = bytes.indexOf(Buffer.from('说')) + 2
    expect((await readFileRange(file, from, to - from))!.content).toBe('文件：  ')
  })

  test('on a system without such a code page everything is UTF-8, as before', async () => {
    _setSystemLegacyDecoderForTest(null)
    await writeFile(file, OUTPUT)
    expect((await readFileRange(file, 0, 1024))!.content).toBe(OUTPUT.toString('utf8'))
    expect((await tailFile(file, 1024)).content).toBe(OUTPUT.toString('utf8'))
  })
})
