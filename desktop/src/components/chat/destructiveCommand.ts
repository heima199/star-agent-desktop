import type { TranslationKey } from '../../i18n'

/**
 * What a shell command waiting for permission may destroy, so its card can say
 * so before anyone allows it.
 *
 * The patterns mirror the CLI's tables, src/tools/BashTool/destructiveCommandWarning.ts
 * and src/tools/PowerShellTool/destructiveCommandWarning.ts, instead of
 * importing them: those stop at the first match and return one English
 * sentence, while the card lists every finding with a translated reason and
 * impact, and checks a few commands the CLI does not (chmod -R 777, raw disk
 * writes, piped installers, shutdown, the registry). When either CLI table
 * changes, change this one too, and add the new command to the samples in
 * chatBlocks.test.tsx: that test fails when a sample the CLI warns about finds
 * nothing here.
 *
 * Informational only: nothing here changes what is allowed.
 */

export type CommandShell = 'bash' | 'powershell'

export type DestructiveFinding = {
  /** One finding per kind, so this is unique within a command's findings. */
  id: string
  /** Translated with `{ command }`. */
  reason: TranslationKey
  impact: TranslationKey
  /** The command the reason names, as it is usually typed. */
  command: string
}

type Pattern = readonly [pattern: RegExp, command: string]

type Rule = {
  kind: string
  reason: TranslationKey
  impact: TranslationKey
  patterns: Partial<Record<CommandShell, readonly Pattern[]>>
}

/** The shell a permission request runs its command in, when it is a shell tool. */
export function commandShellForTool(toolName: string): CommandShell | null {
  if (toolName === 'Bash') return 'bash'
  if (toolName === 'PowerShell') return 'powershell'
  return null
}

const both = (patterns: readonly Pattern[]): Rule['patterns'] => ({ bash: patterns, powershell: patterns })

type DeleteStrength = 'recursiveForce' | 'recursive' | 'force'

const DELETE_FINDINGS: Record<DeleteStrength, Pick<DestructiveFinding, 'reason' | 'impact'>> = {
  recursiveForce: {
    reason: 'permission.destructive.reason.deleteRecursiveForce',
    impact: 'permission.destructive.impact.permanentDelete',
  },
  recursive: {
    reason: 'permission.destructive.reason.deleteRecursive',
    impact: 'permission.destructive.impact.folderContents',
  },
  force: {
    reason: 'permission.destructive.reason.deleteForce',
    impact: 'permission.destructive.impact.permanentDelete',
  },
}

/**
 * `rm` where a statement starts, or behind a command runner. Anchored like the
 * CLI so `git rm` and `echo "rm -rf"` are not read as deleting anything.
 */
const BASH_RM =
  /(?:^|[;&|\n(`{]|(?:\b(?:sudo|doas|xargs|nohup|time)|[ \t]-exec(?:dir)?)[ \t])[ \t]*(?:\/(?:usr\/)?bin\/)?rm[ \t]+([^;&|\n]*)/g

const BASH_DELETE_COMMANDS: Record<DeleteStrength, string> = {
  recursiveForce: 'rm -rf',
  recursive: 'rm -r',
  force: 'rm -f',
}

/**
 * Remove-Item and its aliases where a statement or block starts. As in the CLI,
 * `)` does not end the arguments: `Remove-Item (Join-Path $r "tmp") -Recurse -Force`
 * is still one command with both flags.
 */
const POWERSHELL_REMOVE = /(?:^|[|;&\n({])[ \t]*(?:Remove-Item|rm|del|erase|rd|rmdir|ri)\b([^|;&\n}]*)/gi
/** `-Recurse` or a prefix of it; `-r` is unambiguous on Remove-Item. */
const POWERSHELL_RECURSE = /(?:^|\s)-r(?:e(?:c(?:u(?:r(?:s(?:e)?)?)?)?)?)?(?=$|[\s:])/i
/** `-Force` or a prefix of it from `-fo`; `-f` alone is ambiguous with -Filter. */
const POWERSHELL_FORCE = /(?:^|\s)-fo(?:r(?:c(?:e)?)?)?(?=$|[\s:])/i

const POWERSHELL_DELETE_COMMANDS: Record<DeleteStrength, string> = {
  recursiveForce: 'Remove-Item -Recurse -Force',
  recursive: 'Remove-Item -Recurse',
  force: 'Remove-Item -Force',
}

/** cmd.exe's tree deletes, usually reached through `cmd /c`. */
const CMD_TREE_DELETES: readonly Pattern[] = [
  [/\b(?:rd|rmdir)\s+(?:\/[a-z]\s+)*\/s\b/i, 'rd /s'],
  [/\b(?:del|erase)\s+(?:\/[a-z]\s+)*\/s\b/i, 'del /s'],
]

function strengthOf(recursive: boolean, force: boolean): DeleteStrength | null {
  if (recursive && force) return 'recursiveForce'
  if (recursive) return 'recursive'
  return force ? 'force' : null
}

function bashDeleteStrength(args: string): DeleteStrength | null {
  let recursive = false
  let force = false
  for (const token of args.trim().split(/\s+/)) {
    if (token === '--') break
    if (token === '--recursive') recursive = true
    else if (token === '--force') force = true
    else if (/^-[a-zA-Z]+$/.test(token)) {
      if (/[rR]/.test(token)) recursive = true
      if (token.includes('f')) force = true
    }
  }
  return strengthOf(recursive, force)
}

function deletions(command: string, shell: CommandShell): Array<{ strength: DeleteStrength; command: string }> {
  const found: Array<{ strength: DeleteStrength; command: string }> = []
  if (shell === 'bash') {
    for (const match of command.matchAll(BASH_RM)) {
      const strength = bashDeleteStrength(match[1] ?? '')
      if (strength) found.push({ strength, command: BASH_DELETE_COMMANDS[strength] })
    }
  } else {
    for (const match of command.matchAll(POWERSHELL_REMOVE)) {
      const args = match[1] ?? ''
      const strength = strengthOf(POWERSHELL_RECURSE.test(args), POWERSHELL_FORCE.test(args))
      if (strength) found.push({ strength, command: POWERSHELL_DELETE_COMMANDS[strength] })
    }
  }
  for (const [pattern, label] of CMD_TREE_DELETES) {
    if (pattern.test(command)) found.push({ strength: 'recursive', command: label })
  }
  // The strongest reading speaks for the rest: `rm -rf` already says what `rm -r` would.
  return found.some((entry) => entry.strength === 'recursiveForce')
    ? found.filter((entry) => entry.strength === 'recursiveForce')
    : found
}

/** Runs where a bash statement starts, or behind sudo. */
const BASH_STATEMENT = String.raw`(?:^|[;&|\n(\x60{]|\b(?:sudo|doas)[ \t])[ \t]*`
/** Runs where a PowerShell statement or block starts. */
const POWERSHELL_STATEMENT = String.raw`(?:^|[|;&\n({])[ \t]*`

const RULES: readonly Rule[] = [
  {
    kind: 'clearContent',
    reason: 'permission.destructive.reason.clearContent',
    impact: 'permission.destructive.impact.contentErased',
    patterns: { powershell: [[/\bClear-Content\b[^|;&\n]*\*/i, 'Clear-Content *']] },
  },
  {
    kind: 'recycleBin',
    reason: 'permission.destructive.reason.recycleBin',
    impact: 'permission.destructive.impact.recycleBinGone',
    patterns: { powershell: [[/\bClear-RecycleBin\b/i, 'Clear-RecycleBin']] },
  },
  {
    kind: 'diskFormat',
    reason: 'permission.destructive.reason.diskFormat',
    impact: 'permission.destructive.impact.diskErased',
    patterns: {
      bash: [[new RegExp(`${BASH_STATEMENT}(?:mkfs(?:\\.\\w+)?|mke2fs)\\b`), 'mkfs']],
      powershell: [
        [/\bFormat-Volume\b/i, 'Format-Volume'],
        [new RegExp(`${POWERSHELL_STATEMENT}format(?:\\.com)?[ \\t]+[A-Za-z]:`, 'i'), 'format'],
      ],
    },
  },
  {
    kind: 'diskWipe',
    reason: 'permission.destructive.reason.diskWipe',
    impact: 'permission.destructive.impact.diskErased',
    patterns: {
      bash: [
        [/\bdd\b[^;&|\n]*\bof=\/dev\/(?!(?:null|zero|stdout|stderr)\b)/, 'dd of=/dev/…'],
        [new RegExp(`${BASH_STATEMENT}wipefs\\b`), 'wipefs'],
      ],
      powershell: [[/\bClear-Disk\b/i, 'Clear-Disk']],
    },
  },
  // Git, from either shell. PowerShell compares case-insensitively, as the CLI does.
  {
    kind: 'gitResetHard',
    reason: 'permission.destructive.reason.gitResetHard',
    impact: 'permission.destructive.impact.uncommittedLost',
    patterns: {
      bash: [[/\bgit\s+reset\s+--hard\b/, 'git reset --hard']],
      powershell: [[/\bgit\s+reset\s+--hard\b/i, 'git reset --hard']],
    },
  },
  {
    kind: 'gitDiscardChanges',
    reason: 'permission.destructive.reason.gitDiscardChanges',
    impact: 'permission.destructive.impact.uncommittedLost',
    patterns: {
      bash: [
        [/\bgit\s+checkout\s+(--\s+)?\.[ \t]*($|[;&|\n])/, 'git checkout -- .'],
        [/\bgit\s+restore\s+(--\s+)?\.[ \t]*($|[;&|\n])/, 'git restore .'],
      ],
      powershell: [
        [/\bgit\s+checkout\s+(--\s+)?\.[ \t]*($|[;&|\n])/i, 'git checkout -- .'],
        [/\bgit\s+restore\s+(--\s+)?\.[ \t]*($|[;&|\n])/i, 'git restore .'],
      ],
    },
  },
  {
    kind: 'gitClean',
    reason: 'permission.destructive.reason.gitClean',
    impact: 'permission.destructive.impact.untrackedLost',
    patterns: {
      bash: [[/\bgit\s+clean\b(?![^;&|\n]*(?:-[a-zA-Z]*n|--dry-run))[^;&|\n]*-[a-zA-Z]*f/, 'git clean -f']],
      powershell: [[/\bgit\s+clean\b(?![^|;&\n]*(?:-[a-zA-Z]*n|--dry-run))[^|;&\n]*-[a-zA-Z]*f/i, 'git clean -f']],
    },
  },
  {
    kind: 'gitPushForce',
    reason: 'permission.destructive.reason.gitPushForce',
    impact: 'permission.destructive.impact.remoteHistory',
    patterns: {
      bash: [[/\bgit\s+push\b[^;&|\n]*[ \t](--force|--force-with-lease|-f)\b/, 'git push --force']],
      powershell: [[/\bgit\s+push\b[^|;&\n]*\s+(--force|--force-with-lease|-f)\b/i, 'git push --force']],
    },
  },
  {
    kind: 'gitStashDrop',
    reason: 'permission.destructive.reason.gitStashDrop',
    impact: 'permission.destructive.impact.stashLost',
    patterns: {
      bash: [
        [/\bgit\s+stash[ \t]+drop\b/, 'git stash drop'],
        [/\bgit\s+stash[ \t]+clear\b/, 'git stash clear'],
      ],
      powershell: [
        [/\bgit\s+stash\s+drop\b/i, 'git stash drop'],
        [/\bgit\s+stash\s+clear\b/i, 'git stash clear'],
      ],
    },
  },
  {
    kind: 'gitBranchForceDelete',
    reason: 'permission.destructive.reason.gitBranchForceDelete',
    impact: 'permission.destructive.impact.branchCommitsLost',
    // Case-sensitive in PowerShell too: `-d` is the safe delete.
    patterns: both([[/\bgit\s+branch\s+(-D[ \t]|--delete\s+--force|--force\s+--delete)\b/, 'git branch -D']]),
  },
  {
    kind: 'gitAmend',
    reason: 'permission.destructive.reason.gitAmend',
    impact: 'permission.destructive.impact.historyRewritten',
    patterns: {
      bash: [[/\bgit\s+commit\b[^;&|\n]*--amend\b/, 'git commit --amend']],
      powershell: [[/\bgit\s+commit\b[^|;&\n]*--amend\b/i, 'git commit --amend']],
    },
  },
  {
    kind: 'gitNoVerify',
    reason: 'permission.destructive.reason.gitNoVerify',
    impact: 'permission.destructive.impact.hooksSkipped',
    patterns: {
      bash: [[/\bgit\s+(commit|push|merge)\b[^;&|\n]*--no-verify\b/, '--no-verify']],
      powershell: [[/\bgit\s+(commit|push|merge)\b[^|;&\n]*--no-verify\b/i, '--no-verify']],
    },
  },
  // Databases, through a client in either shell.
  {
    kind: 'sqlDropTruncate',
    reason: 'permission.destructive.reason.sqlDropTruncate',
    impact: 'permission.destructive.impact.databaseData',
    patterns: both([[/\b(DROP|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA)\b/i, 'DROP / TRUNCATE']]),
  },
  {
    kind: 'sqlDeleteAll',
    reason: 'permission.destructive.reason.sqlDeleteAll',
    impact: 'permission.destructive.impact.databaseData',
    patterns: both([[/\bDELETE\s+FROM\s+\w+[ \t]*(;|"|'|\n|$)/i, 'DELETE FROM']]),
  },
  {
    kind: 'kubectlDelete',
    reason: 'permission.destructive.reason.kubectlDelete',
    impact: 'permission.destructive.impact.clusterResources',
    patterns: both([[/\bkubectl\s+delete\b/, 'kubectl delete']]),
  },
  {
    kind: 'terraformDestroy',
    reason: 'permission.destructive.reason.terraformDestroy',
    impact: 'permission.destructive.impact.infrastructure',
    patterns: both([[/\bterraform\s+destroy\b/, 'terraform destroy']]),
  },
  {
    kind: 'chmodWorldWritable',
    reason: 'permission.destructive.reason.chmodWorldWritable',
    impact: 'permission.destructive.impact.permissions',
    patterns: {
      bash: [[/\bchmod\s+(?:-[a-zA-Z]*R[a-zA-Z]*\s+|--recursive\s+)+(?:0?777|[ugoa]*\+rwx)(?=$|[\s;&|)])/, 'chmod -R 777']],
    },
  },
  {
    kind: 'remoteScript',
    reason: 'permission.destructive.reason.remoteScript',
    impact: 'permission.destructive.impact.remoteCode',
    patterns: {
      bash: [
        [/\b(?:curl|wget)\b[^;&\n]*\|[ \t]*(?:sudo[ \t]+(?:-\S+[ \t]+)*)?(?:ba|z|k|da|fi)?sh\b/, 'curl | sh'],
        [/\b(?:ba|z)?sh\b[^;&|\n]*(?:<\(|\$\()[ \t]*(?:curl|wget)\b/, 'sh <(curl …)'],
      ],
      powershell: [
        [/\b(?:Invoke-WebRequest|Invoke-RestMethod|iwr|irm|curl|wget)\b[^;\n]*\|[ \t]*(?:Invoke-Expression|iex)\b/i, 'iwr | iex'],
        [/\b(?:Invoke-Expression|iex)\b[^|;\n]*\b(?:DownloadString|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b/i, 'iex (iwr …)'],
      ],
    },
  },
  {
    kind: 'shutdown',
    reason: 'permission.destructive.reason.shutdown',
    impact: 'permission.destructive.impact.shutdown',
    patterns: {
      bash: [
        // `shutdown -c` cancels a pending shutdown.
        [new RegExp(`${BASH_STATEMENT}(?:shutdown\\b(?![ \\t]+-c\\b)|poweroff\\b|halt\\b)`), 'shutdown'],
        [new RegExp(`${BASH_STATEMENT}reboot\\b`), 'reboot'],
      ],
      powershell: [
        [/\bStop-Computer\b/i, 'Stop-Computer'],
        [/\bRestart-Computer\b/i, 'Restart-Computer'],
        [new RegExp(`${POWERSHELL_STATEMENT}shutdown(?:\\.exe)?[ \\t]+[/-][srp]\\b`, 'i'), 'shutdown'],
      ],
    },
  },
  {
    kind: 'registryDelete',
    reason: 'permission.destructive.reason.registryDelete',
    impact: 'permission.destructive.impact.registry',
    patterns: {
      bash: [[/\breg(?:\.exe)?\s+delete\b/i, 'reg delete']],
      powershell: [
        [/\breg(?:\.exe)?\s+delete\b/i, 'reg delete'],
        [/\b(?:Remove-Item|Remove-ItemProperty|ri|rp|rm|del|erase|rd|rmdir)\b[^|;&\n]*(?:\b(?:HKLM|HKCU|HKCR|HKU|HKCC):|\bRegistry::)/i, 'Remove-Item HKLM:'],
      ],
    },
  },
]

/**
 * Every destructive operation `command` may perform in `shell`, one finding per
 * kind, deletions first and the rest in table order.
 */
export function findDestructiveCommandRisks(command: string, shell: CommandShell): DestructiveFinding[] {
  const findings: DestructiveFinding[] = []
  const add = (id: string, reason: TranslationKey, impact: TranslationKey, label: string) => {
    if (!findings.some((finding) => finding.id === id)) findings.push({ id, reason, impact, command: label })
  }

  for (const deletion of deletions(command, shell)) {
    const { reason, impact } = DELETE_FINDINGS[deletion.strength]
    add(`delete-${deletion.strength}`, reason, impact, deletion.command)
  }
  for (const rule of RULES) {
    const match = rule.patterns[shell]?.find(([pattern]) => pattern.test(command))
    if (match) add(rule.kind, rule.reason, rule.impact, match[1])
  }
  return findings
}
