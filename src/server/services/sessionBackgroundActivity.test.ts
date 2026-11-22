import { afterEach, expect, spyOn, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { activeAgentTasks, activeNonAgentTasks } from '../ws/agentTaskState.js'
import { MAX_BACKGROUND_OUTPUT_BYTES, projectSessionBackgroundActivity, readSessionBackgroundTaskOutput } from './sessionBackgroundActivity.js'
import type { MessageEntry } from './sessionService.js'
import { sanitizePath } from '../../utils/sessionStoragePortable.js'
import { _setSystemLegacyDecoderForTest, legacyDecoderFor } from '../../utils/shell/outputEncoding.js'

test('activity uses session-owned runtime truth, hides nested tasks and keeps terminal output', () => {
  const id = 'fixture-activity'
  activeNonAgentTasks.set(id, new Map([
    ['live', { taskId: 'live', toolUseId: 'bash', taskType: 'local_bash', description: 'build' }],
    ['child', { taskId: 'child', toolUseId: 'nested', ownerAgentId: 'agent' }],
    ['stopping', { taskId: 'stopping', toolUseId: 'stop', localStopConfirmed: true }],
  ]))
  activeAgentTasks.set('other-host-session', new Map())
  try {
    const rows = projectSessionBackgroundActivity(id, [{ id: 'm', type: 'assistant', timestamp: '2026-10-24T00:00:00Z', content: [{ type: 'tool_use', id: 'bash', name: 'Bash', input: { command: 'bun run build' } }] }], [
      { taskId: 'done', toolUseId: 'agent', status: 'completed', result: 'actual result' },
      { taskId: 'child-done', toolUseId: 'child', ownerAgentId: 'agent', status: 'completed' },
    ])
    expect(rows.map(row => row.taskId)).toEqual(['done', 'live', 'stopping'])
    expect(rows.find(row => row.taskId === 'live')).toMatchObject({ status: 'running', description: 'build', startedAt: '2026-10-24T00:00:00Z' })
    expect(rows.find(row => row.taskId === 'stopping')?.status).toBe('stopped')
    expect(rows[0]?.result).toBe('actual result')
    expect(projectSessionBackgroundActivity('unknown', [], [])).toEqual([])
  } finally { activeNonAgentTasks.delete(id); activeAgentTasks.delete('other-host-session') }
})

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true })
})

async function outputFixture(content: string | Buffer = 'server listening\n') {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'task-output-service-')))
  directories.push(root)
  const cwd = path.join(root, 'work')
  const target = path.join(root, sanitizePath(cwd), 'session-a', 'tasks', 'shell-task.output')
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content)
  const messages: MessageEntry[] = [
    { id: 'use', type: 'tool_use', cwd, timestamp: '2026-10-24T00:00:00Z', content: [{ type: 'tool_use', id: 'bash-use', name: 'Bash', input: { command: 'bun run server.ts', run_in_background: true } }] },
    { id: 'result', type: 'tool_result', cwd, timestamp: '2026-10-24T00:00:01Z', toolUseResult: { backgroundTaskId: 'shell-task' }, content: [{ type: 'tool_result', tool_use_id: 'bash-use', content: `Command running in background with ID: shell-task. Output is being written to: ${target}` }] },
  ]
  const read = (signal?: AbortSignal, session = 'session-a', task = 'shell-task') => readSessionBackgroundTaskOutput(session, task, messages, signal, root)
  return { root, cwd, target, messages, read }
}

test('shell output reads the session-owned stdout/stderr file while its task is still running', async () => {
  const f = await outputFixture('listening\nstderr: diagnostic\n')
  expect(await f.read()).toEqual({ taskId: 'shell-task', state: 'available', text: 'listening\nstderr: diagnostic\n', totalBytes: 29, truncated: false })
  await fs.appendFile(f.target, 'request complete\n')
  expect((await f.read()).text).toEndWith('request complete\n')
})

test('missing and empty files are distinct from recorded output', async () => {
  const f = await outputFixture('')
  expect((await f.read()).state).toBe('empty')
  await fs.unlink(f.target)
  expect((await f.read()).state).toBe('missing')
})

test('terminal shell notifications retain the shell output reader after runtime cleanup', async () => {
  const f = await outputFixture()
  const rows = projectSessionBackgroundActivity('session-a', f.messages, [{ taskId: 'shell-task', toolUseId: 'bash-use', status: 'stopped' }])
  expect(rows[0]).toMatchObject({ taskType: 'local_bash', status: 'stopped' })
  expect((await f.read()).text).toBe('server listening\n')
})

test('reads a bounded tail without breaking the leading UTF-8 code point', async () => {
  const f = await outputFixture('a'.repeat(MAX_BACKGROUND_OUTPUT_BYTES) + '中文\n')
  const result = await f.read()
  expect(result.truncated).toBe(true)
  expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(MAX_BACKGROUND_OUTPUT_BYTES)
  expect(result.text).toEndWith('中文\n')
  await fs.writeFile(f.target, '中'.repeat(MAX_BACKGROUND_OUTPUT_BYTES))
  const multibyte = await f.read()
  expect(multibyte.text).not.toContain('\ufffd')
  expect(Buffer.byteLength(multibyte.text)).toBeLessThanOrEqual(MAX_BACKGROUND_OUTPUT_BYTES)
})

test('reads what a command wrote in the system code page', async () => {
  // The first line of a ping on a Chinese Windows, in its code page (GBK).
  const ping = Buffer.from('d5fdd4da2050696e67203132372e302e302e3120bedfd3d020333220d7d6bddab5c4cafdbedd3a0d0a', 'hex')
  const text = '正在 Ping 127.0.0.1 具有 32 字节的数据:\r\n'
  _setSystemLegacyDecoderForTest(legacyDecoderFor(936))
  try {
    const f = await outputFixture(ping)
    expect(await f.read()).toEqual({ taskId: 'shell-task', state: 'available', text, totalBytes: ping.length, truncated: false })
    // A bounded tail that starts on the second byte of 正 marks the half that is left of it.
    const rest = 'a'.repeat(MAX_BACKGROUND_OUTPUT_BYTES - ping.length + 1)
    await fs.writeFile(f.target, Buffer.concat([ping, Buffer.from(rest)]))
    const tail = await f.read()
    expect(tail.truncated).toBe(true)
    expect(tail.text).toBe(`\ufffd${text.slice(1)}${rest}`)
    // Where the system has no such code page the bytes are read as UTF-8, as before.
    _setSystemLegacyDecoderForTest(null)
    await fs.writeFile(f.target, ping)
    expect((await f.read()).text).toBe(ping.toString('utf8'))
  } finally {
    _setSystemLegacyDecoderForTest(undefined)
  }
})

test('requires an exact successful root shell tool/result pair and never adopts unrelated text', async () => {
  const f = await outputFixture()
  const original = structuredClone(f.messages)
  const deny = async (mutate: () => void) => {
    f.messages.splice(0, f.messages.length, ...structuredClone(original))
    mutate()
    await expect(f.read()).rejects.toMatchObject({ statusCode: 404 })
  }
  await deny(() => { f.messages.pop() })
  await deny(() => { (f.messages[1]!.content as any[])[0].tool_use_id = 'other-use' })
  await deny(() => { (f.messages[0]!.content as any[])[0].name = 'Read' })
  await deny(() => { f.messages[0]!.isSidechain = true })
  await deny(() => { f.messages[1]!.parentToolUseId = 'agent' })
  await deny(() => { (f.messages[1]!.content as any[])[0].is_error = true })
  await deny(() => { f.messages[1]!.toolUseResult = { backgroundTaskId: 'other-task' } })
  await deny(() => { (f.messages[1]!.content as any[]).push({ type: 'tool_result', tool_use_id: 'other-use' }) })
})

test('supports legacy background results only for explicitly backgrounded shell calls', async () => {
  const f = await outputFixture()
  delete f.messages[1]!.toolUseResult
  expect((await f.read()).state).toBe('available')
  const result = (f.messages[1]!.content as any[])[0]
  result.content = `Command was manually backgrounded by user with ID: shell-task. Output is being written to: ${f.target}`
  expect((await f.read()).state).toBe('available')
  const use = (f.messages[0]!.content as any[])[0]
  use.input.run_in_background = false
  await expect(f.read()).rejects.toMatchObject({ statusCode: 404 })
})

test('the same task ID is isolated by session and output paths cannot escape the fixed task directory', async () => {
  const f = await outputFixture('session A')
  const other = path.join(f.root, sanitizePath(f.cwd), 'session-b', 'tasks', 'shell-task.output')
  await fs.mkdir(path.dirname(other), { recursive: true })
  await fs.writeFile(other, 'session B')
  expect((await f.read()).text).toBe('session A')
  await expect(f.read(undefined, 'session-b')).rejects.toMatchObject({ statusCode: 403 })
  const result = (f.messages[1]!.content as any[])[0]
  result.content = `Command running in background with ID: shell-task. Output is being written to: ${other}`
  expect((await f.read(undefined, 'session-b')).text).toBe('session B')
  await expect(f.read()).rejects.toMatchObject({ statusCode: 403 })
  result.content = `Command running in background with ID: shell-task. Output is being written to: ${path.join(f.root, 'settings.json')}`
  await expect(f.read()).rejects.toMatchObject({ statusCode: 403 })
  const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'other-task-output-root-')))
  directories.push(outside)
  const unrelated = path.join(outside, 'project', 'session-a', 'tasks', 'shell-task.output')
  await fs.mkdir(path.dirname(unrelated), { recursive: true })
  await fs.writeFile(unrelated, 'outside root fixture')
  result.content = `Command running in background with ID: shell-task. Output is being written to: ${unrelated}`
  await expect(f.read()).rejects.toMatchObject({ statusCode: 403 })
  result.content = 'Command running in background with ID: shell-task'
  expect((await f.read(undefined, 'session-c')).state).toBe('missing')
  for (const task of ['../secret', 'a/b', 'a\\b', '.env', 'x'.repeat(129)]) await expect(f.read(undefined, 'session-a', task)).rejects.toMatchObject({ statusCode: 400 })
})

test('reads the CLI original output location after cwd changes without trusting an arbitrary file', async () => {
  const f = await outputFixture()
  f.messages[0]!.cwd = path.join(f.cwd, 'nested-worktree')
  expect((await f.read()).text).toBe('server listening\n')
  const result = (f.messages[1]!.content as any[])[0]
  result.content = `Command exceeded the assistant-mode blocking budget (10s) and was moved to the background with ID: shell-task. It is still running — you will be notified when it completes. Output is being written to: ${f.target}. In assistant mode, delegate long-running work to a subagent.`
  expect((await f.read()).text).toBe('server listening\n')
})

test('reads an output file recorded under another spelling of the temporary root', async () => {
  // The CLI records the path as its own root is spelled. On Windows that is the
  // short (8.3) form of %TEMP% for a long user name, on macOS a symlinked /var;
  // only the real path expands either.
  let spelled = await fs.mkdtemp(path.join(os.tmpdir(), 'task-output-spelling-'))
  const real = await fs.realpath(spelled)
  directories.push(real)
  if (spelled === real) {
    spelled = `${real}-alias`
    await fs.symlink(real, spelled, 'junction')
    directories.push(spelled)
  }
  const cwd = path.join(real, 'work')
  const recorded = path.join(spelled, sanitizePath(cwd), 'session-a', 'tasks', 'shell-task.output')
  await fs.mkdir(path.dirname(recorded), { recursive: true })
  await fs.writeFile(recorded, 'server listening\n')
  const messages: MessageEntry[] = [
    { id: 'use', type: 'tool_use', cwd, timestamp: '2026-10-24T00:00:00Z', content: [{ type: 'tool_use', id: 'bash-use', name: 'Bash', input: { command: 'bun run server.ts', run_in_background: true } }] },
    { id: 'result', type: 'tool_result', cwd, timestamp: '2026-10-24T00:00:01Z', toolUseResult: { backgroundTaskId: 'shell-task' }, content: [{ type: 'tool_result', tool_use_id: 'bash-use', content: `Command running in background with ID: shell-task. Output is being written to: ${recorded}` }] },
  ]
  const read = () => readSessionBackgroundTaskOutput('session-a', 'shell-task', messages, undefined, spelled)
  expect((await read()).text).toBe('server listening\n')
  // The other spelling is no way out of the fixed task directory.
  const result = (messages[1]!.content as any[])[0]
  result.content = `Command running in background with ID: shell-task. Output is being written to: ${path.join(spelled, 'settings.json')}`
  await expect(read()).rejects.toMatchObject({ statusCode: 403 })
  result.content = `Command running in background with ID: shell-task. Output is being written to: ${path.join(spelled, '..', path.basename(real), sanitizePath(cwd), 'session-b', 'tasks', 'shell-task.output')}`
  await expect(read()).rejects.toMatchObject({ statusCode: 403 })
})

test.skipIf(process.platform === 'win32')('rejects final symlinks, ancestor redirection and hardlinks to protected data', async () => {
  const f = await outputFixture()
  const secret = path.join(f.root, 'settings.json')
  await fs.writeFile(secret, 'fake protected configuration')
  await fs.unlink(f.target)
  await fs.symlink(secret, f.target)
  await expect(f.read()).rejects.toMatchObject({ statusCode: 403 })
  await fs.unlink(f.target)
  await fs.link(secret, f.target)
  await expect(f.read()).rejects.toMatchObject({ statusCode: 403 })
  await fs.unlink(f.target)
  const outside = path.join(f.root, 'outside')
  await fs.mkdir(outside)
  await fs.writeFile(path.join(outside, 'shell-task.output'), 'outside fixture')
  await fs.rmdir(path.dirname(f.target))
  await fs.symlink(outside, path.dirname(f.target))
  await expect(f.read()).rejects.toMatchObject({ statusCode: 403 })
})

test.skipIf(process.platform === 'win32')('revalidates canonical location and FD identity after an ancestor swap during open', async () => {
  const f = await outputFixture()
  const outside = path.join(f.root, 'outside')
  await fs.mkdir(outside)
  await fs.writeFile(path.join(outside, 'shell-task.output'), 'outside fixture')
  const originalOpen = fs.open
  let closed = false
  const open = spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    if (args[0] === f.target) {
      await fs.rename(path.dirname(f.target), path.dirname(f.target) + '-old')
      await fs.symlink(outside, path.dirname(f.target))
    }
    const file = await originalOpen(...args)
    const close = file.close.bind(file)
    file.close = async () => { closed = true; await close() }
    return file
  })
  try {
    await expect(f.read()).rejects.toMatchObject({ statusCode: 403 })
    expect(closed).toBe(true)
  } finally { open.mockRestore() }
})

test('honors abort before access and after the bounded read, closing the FD', async () => {
  const f = await outputFixture()
  const controller = new AbortController()
  controller.abort()
  await expect(f.read(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  const during = new AbortController()
  const originalOpen = fs.open
  let closed = false
  const open = spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    const file = await originalOpen(...args)
    const read = file.read.bind(file)
    const close = file.close.bind(file)
    file.read = (async (...input: any[]) => {
      const result = await (read as any)(...input)
      during.abort()
      return result
    }) as typeof file.read
    file.close = async () => { closed = true; await close() }
    return file
  })
  try {
    await expect(f.read(during.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(closed).toBe(true)
  } finally { open.mockRestore() }
})
