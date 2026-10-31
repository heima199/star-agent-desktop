/**
 * Claude Code 桌面端合并 sidecar 入口。
 *
 * 历史上 server / cli / IM adapters 是各自独立的进程。每个 bun-compile
 * 二进制都要带一份 ~55MB 的 bun runtime，光这一项就重复占了 100MB+。
 * 把所有运行模式合并到同一个二进制里，runtime 只保留一份；调用方通过
 * 第一个 positional 参数选择模式：
 *
 *   claude-sidecar server   --app-root <path> --host 127.0.0.1 --port 12345
 *   claude-sidecar cli      --app-root <path> [其它 CLI 参数...]
 *   claude-sidecar adapters --app-root <path> [--feishu] [--telegram] [--wechat]
 *                           [--dingtalk] [--whatsapp] [--wecom] [--qq] [--slack]
 *
 * 任何模式都必须先做 process.env / process.argv 设置，再 await 进入相应的
 * 子模块树。原因：src/server/index.ts、src/entrypoints/cli.tsx、以及
 * adapters/feishu/index.ts 等顶层都会立即读 process.argv / process.env，
 * 必须在它们求值前 splice 掉 --app-root、mode 和各 adapter 的 flag 这些
 * launcher-only 参数。
 */

import { parseLauncherArgs, resolveSidecarInvocation } from './launcherRouting'
import { ADAPTER_REQUIREMENTS } from '../../adapters/common/adapter-requirements.ts'

// The compiled Computer Use runtime relaunches this executable directly. Its
// isolated worker has no app-root and must not load preload, CLI configuration,
// providers, or any desktop mode before serving the JSON-only kernel protocol.
if (process.argv[2] === '--computer-use-repl-worker') {
  const { runComputerUseReplWorker } = await import('../../src/utils/computerUse/replWorker')
  await runComputerUseReplWorker()
  process.exit(0)
}

// Local speech recognition runs in this same executable, relaunched by the
// server's voice recognizer. Like the worker above it must stay isolated: it
// reads its private configuration from the environment, loads the downloaded
// sherpa-onnx runtime by absolute path, and needs none of the desktop modes.
if (process.argv[2] === '--voice-worker') {
  const { runVoiceWorker } = await import('../../src/server/services/voice/sensevoice/worker')
  await runVoiceWorker()
  process.exit(0)
}

type AdapterConfigShape = Awaited<
  ReturnType<typeof import('../../adapters/common/config.ts')['loadConfig']>
>

/**
 * How to start each IM adapter: a side-effect import of its module. Its CLI
 * flag, its label and how to tell whether it is configured live in
 * adapters/common/adapter-requirements.ts, which the desktop host reads too
 * (it spawns no adapter process for a platform nobody set up).
 *
 * Every adapter previously carried its own copy of the flag parse, the
 * credential gate and the side-effect import. That is exactly the shape where
 * the next copy forgets the gate — and a missing gate lets one unconfigured
 * adapter's `process.exit(1)` take down every other adapter in the sidecar.
 *
 * Declared above the mode dispatch on purpose: `runAdapters` is hoisted and
 * runs at module top level, so a table declared below it would still be in its
 * temporal dead zone when the adapters mode reads it.
 */
const ADAPTER_STARTS: Record<(typeof ADAPTER_REQUIREMENTS)[number]['flag'], () => Promise<unknown>> = {
  // 副作用 import：feishu/index.ts 顶层会自动 new WSClient + start()
  '--feishu': () => import('../../adapters/feishu/index.ts'),
  '--telegram': () => import('../../adapters/telegram/index.ts'),
  '--wechat': () => import('../../adapters/wechat/index.ts'),
  '--dingtalk': () => import('../../adapters/dingtalk/index.ts'),
  '--whatsapp': () => import('../../adapters/whatsapp/index.ts'),
  '--wecom': () => import('../../adapters/wecom/index.ts'),
  '--qq': () => import('../../adapters/qq/index.ts'),
  '--slack': () => import('../../adapters/slack/index.ts'),
}

const ADAPTERS: ReadonlyArray<{
  flag: string
  label: string
  missingCredentials: string
  isConfigured: (config: AdapterConfigShape) => boolean | Promise<boolean>
  start: () => Promise<unknown>
}> = ADAPTER_REQUIREMENTS.map((requirement) => ({ ...requirement, start: ADAPTER_STARTS[requirement.flag] }))

const rawArgs = process.argv.slice(2)
const invocation = resolveSidecarInvocation(rawArgs)
if (!invocation.mode) {
  console.error('claude-sidecar: missing mode argument (expected "server", "cli" or "adapters")')
  process.exit(2)
}
const mode = invocation.mode
const restArgs = invocation.restArgs

if (mode === 'adapters') {
  await runAdapters(restArgs)
} else {
  const { appRoot, args } = parseLauncherArgs(restArgs, invocation.defaultAppRoot)

  process.env.CLAUDE_APP_ROOT = appRoot
  process.env.CALLER_DIR ||= process.cwd()
  process.argv = [process.argv[0]!, process.argv[1]!, ...args]

  await import('../../preload.ts')

  if (mode === 'server') {
    console.log(`[claude-sidecar] starting server mode (${process.platform}/${process.arch})`)
    const { startServer } = await import('../../src/server/index.ts')
    startServer()
  } else if (mode === 'cli') {
    await import('../../src/entrypoints/cli.tsx')
  } else {
    console.error(`claude-sidecar: unknown mode "${mode}" (expected "server", "cli" or "adapters")`)
    process.exit(2)
  }
}

async function runAdapters(rawArgs: string[]): Promise<void> {
  // adapters 模式的参数解析独立于 server/cli —— 这里只接受 ADAPTERS 里的
  // flag 选择启用哪个适配器，再加可选的 --app-root（透传给
  // adapters/common/config.ts 内的 process.env 读取）。
  let appRoot: string | null = process.env.CLAUDE_APP_ROOT ?? null
  const enabled = new Set<string>()
  const knownFlags = new Set(ADAPTERS.map((adapter) => adapter.flag))

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]
    if (arg === '--app-root') {
      appRoot = rawArgs[i + 1] ?? null
      i += 1
      continue
    }
    if (arg && knownFlags.has(arg)) {
      enabled.add(arg)
      continue
    }
    console.warn(`claude-sidecar adapters: ignoring unknown arg "${arg}"`)
  }

  if (enabled.size === 0) {
    console.error(
      `claude-sidecar adapters: must enable at least one of ${[...knownFlags].join(' / ')}`,
    )
    process.exit(2)
  }

  if (appRoot) {
    process.env.CLAUDE_APP_ROOT = appRoot
  }
  process.env.CALLER_DIR ||= process.cwd()

  await import('../../preload.ts')

  // 在 import adapter 之前先用同一份 loadConfig() 检查凭据。adapter 的
  // top-level 代码里已经有 if (!cred) process.exit(1)，但那会把整个
  // 进程拖死 —— 包括另一个本来正常的 adapter。这里提前 gate 一下，
  // 缺凭据的 adapter 直接跳过、不 import。
  const { loadConfig } = await import('../../adapters/common/config.ts')
  const config = loadConfig()

  let started = 0
  for (const adapter of ADAPTERS) {
    if (!enabled.has(adapter.flag)) continue
    if (!(await adapter.isConfigured(config))) {
      console.warn(
        `[claude-sidecar] ${adapter.flag} requested but ${adapter.missingCredentials} in env or ~/.claude/adapters.json — skipping`,
      )
      continue
    }
    console.log(`[claude-sidecar] starting ${adapter.label} adapter`)
    await adapter.start()
    started += 1
  }

  if (started === 0) {
    if (process.env.CC_HAHA_MIGRATION_CONTROL === '1') {
      // No platform module was imported, so this process owns no adapter writes.
      // Publish that fact before exit: the host may already be requesting drain.
      process.stdout.write(JSON.stringify({ type: 'migration_adapter_inactive' }) + '\n', () => process.exit(0))
      return
    }
    console.error(
      '[claude-sidecar] no adapter could be started — check credentials in env or ~/.claude/adapters.json',
    )
    process.exit(1)
  }

  if (process.env.CC_HAHA_MIGRATION_CONTROL === '1' && process.env.CC_HAHA_LOCAL_ACCESS_TOKEN) {
    const { installAdapterMigrationControl } = await import('../../adapters/common/migration-control.js')
    installAdapterMigrationControl({ token: process.env.CC_HAHA_LOCAL_ACCESS_TOKEN })
  }

  // 每个 adapter 的 WebSocket / long-polling 持有 event loop，自然保持进程存活。
}
