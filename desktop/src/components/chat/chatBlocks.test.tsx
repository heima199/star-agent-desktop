import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { StarMediaTask } from '../../api/star'
import { useStarStore } from '../../stores/starStore'
import { UNMATCHED_TASK_POLLS } from '../star/StarChatMediaBlock'
import { mcpHtmlUi, sanitizeSnapshotHtml, withSnapshotBridge } from '../../lib/mcpHtmlUi'
import { ChatSessionIdProvider } from './chatSessionContext'

const snapshotMocks = vi.hoisted(() => ({ request: vi.fn(), render: vi.fn() }))
vi.mock('@/lib/mcpUiSnapshot', () => ({
  requestFrameSnapshot: snapshotMocks.request,
  renderHtmlSnapshot: snapshotMocks.render,
}))
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallBlock } from './ToolCallBlock'
import { ToolCallGroup } from './ToolCallGroup'
import { PermissionDialog } from './PermissionDialog'
import { findDestructiveCommandRisks, type CommandShell } from './destructiveCommand'
import { getDestructiveCommandWarning as bashCliWarning } from '../../../../src/tools/BashTool/destructiveCommandWarning'
import { getDestructiveCommandWarning as powerShellCliWarning } from '../../../../src/tools/PowerShellTool/destructiveCommandWarning'
import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import type { UIMessage } from '../../types/chat'

describe('chat blocks', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    useTabStore.setState({ activeTabId: 'active-tab', tabs: [{ sessionId: 'active-tab', title: 'Test', type: 'session' as const, status: 'idle' }] })
    useChatStore.setState({ sessions: {} })
  })

  it.each(['card', 'row'] as const)('marks a located %s by its tool id, on the chrome the highlight style keys off', (chrome) => {
    const { container, rerender } = render(
      <ToolCallBlock chrome={chrome} toolName="Bash" input={{ command: 'ls' }} result={{ content: 'a', isError: false }} toolUseId="toolu_mark" navigationHighlighted />,
    )
    const root = container.querySelector('[data-tool-use-id="toolu_mark"]')!
    expect(root.getAttribute('data-tool-call-chrome')).toBe(chrome)
    expect(root.className).toContain('chat-tool-navigation-target')

    rerender(<ToolCallBlock chrome={chrome} toolName="Bash" input={{ command: 'ls' }} result={{ content: 'a', isError: false }} toolUseId="toolu_mark" />)
    expect(container.querySelector('[data-tool-use-id="toolu_mark"]')!.className).not.toContain('chat-tool-navigation-target')
  })

  it.each(['card', 'row'] as const)('names the %s output copy action in the interface language', (chrome) => {
    // Regression: tool output copy buttons fell back to CopyButton's English "Copy".
    useSettingsStore.setState({ locale: 'zh' })
    const { container } = render(
      <ToolCallBlock chrome={chrome} toolName="Bash" input={{ command: 'ls' }} result={{ content: 'a.txt', isError: false }} />,
    )
    fireEvent.click(container.querySelector('[data-chat-disclosure="true"]')!)
    expect(screen.getAllByRole('button', { name: '复制' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull()
  })

  it('keeps thinking collapsed by default', () => {
    const { container } = render(<ThinkingBlock content="this is a long internal reasoning trace" isActive />)

    expect(screen.getByText(/Thinking/)).toBeTruthy()
    // The row previews the reasoning; what stays shut is the full block. A
    // label with nothing beside it was the old standalone form, and it made the
    // opening thought of a turn — usually the substantial one — the least
    // informative thing on screen.
    expect(container.querySelector('[data-thinking-content="expanded"]')).toBeNull()
    expect(container.querySelector('.thinking-cursor')).toBeNull()
  })

  it('does not animate inactive historical thinking blocks', () => {
    const { container } = render(<ThinkingBlock content="old reasoning" isActive={false} />)

    fireEvent.click(screen.getByRole('button', { name: /Thought/ }))

    expect(container.textContent).toContain('old reasoning')
    expect(container.querySelector('.thinking-cursor')).toBeNull()
  })

  it('allocates one live image placeholder per requested output', () => {
    render(
      <ToolCallBlock
        toolName="ImageGen"
        input={{ prompt: 'Two fox poster variations', count: 2, aspect_ratio: '16:9' }}
        isPending
      />,
    )

    expect(screen.getAllByTestId('image-generation-slot')).toHaveLength(2)
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true')
    expect(screen.getAllByText('Generating 2 images')).toHaveLength(2)
  })

  it('labels a referenced-image turn as editing while keeping output placeholders', () => {
    render(
      <ToolCallBlock
        toolName="ImageEdit"
        input={{
          prompt: 'Change only the scarf color',
          count: 2,
          referenced_image_paths: ['/staged/fox.png'],
        }}
        isPending
      />,
    )

    expect(screen.getAllByTestId('image-generation-slot')).toHaveLength(2)
    expect(screen.getAllByText('Editing 2 image variations')).toHaveLength(2)
  })

  it('keeps image placeholders visible when deferred tool search shares the group', () => {
    const toolCalls: Array<Extract<UIMessage, { type: 'tool_use' }>> = [
      {
        id: 'search-use',
        type: 'tool_use',
        toolName: 'ToolSearch',
        toolUseId: 'search-1',
        input: { query: 'image generation' },
        timestamp: 1,
      },
      {
        id: 'image-use',
        type: 'tool_use',
        toolName: 'ImageGen',
        toolUseId: 'image-1',
        input: { prompt: 'Two fox posters', count: 2 },
        timestamp: 2,
        isPending: true,
      },
    ]

    render(
      <ToolCallGroup
        toolCalls={toolCalls}
        resultMap={new Map()}
        childToolCallsByParent={new Map()}
        agentTaskNotifications={{}}
        isStreaming
      />,
    )

    expect(screen.getAllByTestId('image-generation-slot')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /ToolSearch \(1\), ImageGen \(1\)/ })).toBeNull()
  })

  it('keeps image editing outside a mixed deferred-tool summary', () => {
    const toolCalls: Array<Extract<UIMessage, { type: 'tool_use' }>> = [
      {
        id: 'search-use',
        type: 'tool_use',
        toolName: 'ToolSearch',
        toolUseId: 'search-1',
        input: { query: 'image editing' },
        timestamp: 1,
      },
      {
        id: 'edit-use',
        type: 'tool_use',
        toolName: 'ImageEdit',
        toolUseId: 'edit-1',
        input: {
          prompt: 'Change only the scarf color',
          count: 1,
          referenced_image_paths: ['/staged/fox.png'],
        },
        timestamp: 2,
        isPending: true,
      },
    ]

    render(
      <ToolCallGroup
        toolCalls={toolCalls}
        resultMap={new Map()}
        childToolCallsByParent={new Map()}
        agentTaskNotifications={{}}
        isStreaming
      />,
    )

    expect(screen.getAllByTestId('image-generation-slot')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /ToolSearch \(1\), ImageEdit \(1\)/ })).toBeNull()
  })

  it('keeps post-image thinking visible and live after the image result arrives', () => {
    const imageCall: Extract<UIMessage, { type: 'tool_use' }> = {
      id: 'image-use',
      type: 'tool_use',
      toolName: 'ImageGen',
      toolUseId: 'image-1',
      input: { prompt: 'A quiet mountain study' },
      timestamp: 1,
    }
    const thinking: Extract<UIMessage, { type: 'thinking' }> = {
      id: 'thinking-after-image',
      type: 'thinking',
      content: 'Check whether the generated image matches the requested composition.',
      timestamp: 3,
    }

    render(
      <ToolCallGroup
        toolCalls={[imageCall]}
        steps={[
          { kind: 'tool', toolCall: imageCall },
          { kind: 'thinking', message: thinking },
        ]}
        resultMap={new Map([[
          'image-1',
          {
            id: 'image-result',
            type: 'tool_result' as const,
            toolUseId: 'image-1',
            content: JSON.stringify({ type: 'image_generation_result', images: [] }),
            isError: false,
            timestamp: 2,
          },
        ]])}
        childToolCallsByParent={new Map()}
        agentTaskNotifications={{}}
        activeThinkingId="thinking-after-image"
      />,
    )

    const thinkingRow = screen.getByRole('button', { name: /Thinking/ })
    expect(thinkingRow).toBeTruthy()
    expect(thinkingRow.querySelector('.thinking-dots')).not.toBeNull()
  })

  it('replaces every image placeholder with the saved tool result', () => {
    const content = JSON.stringify({
      type: 'image_generation_result',
      providerId: 'grok-official',
      providerKind: 'grok_oauth',
      model: 'grok-imagine-image-quality',
      prompt: 'Two fox poster variations',
      durationMs: 1200,
      images: [
        { path: '/tmp/generated-one.jpg', mimeType: 'image/jpeg' },
        { path: '/tmp/generated-two.jpg', mimeType: 'image/jpeg' },
      ],
    })

    render(
      <ToolCallBlock
        toolName="ImageGen"
        input={{ prompt: 'Two fox poster variations', count: 2 }}
        result={{ content, isError: false }}
      />,
    )

    const images = screen.getAllByRole('img')
    expect(images).toHaveLength(2)
    expect(images[0]?.getAttribute('src')).toContain(encodeURIComponent('/tmp/generated-one.jpg'))
    expect(images[1]?.getAttribute('src')).toContain(encodeURIComponent('/tmp/generated-two.jpg'))
    expect(screen.queryByRole('status')).toBeNull()

    const block = screen.getByTestId('image-generation-block')
    expect(block.getAttribute('data-layout')).toBe('thumbnail-rail')
    expect(block.className).not.toContain('border')
    expect(screen.queryByText('ImageGen')).toBeNull()
    expect(screen.queryByText('grok-imagine-image-quality')).toBeNull()
    expect(screen.queryByText('grok-official')).toBeNull()
  })

  it('keeps concurrent image calls in one thumbnail rail and opens the completed set as one gallery', () => {
    const toolCalls: Array<Extract<UIMessage, { type: 'tool_use' }>> = Array.from(
      { length: 4 },
      (_, index) => ({
        id: `image-use-${index + 1}`,
        type: 'tool_use' as const,
        toolName: 'ImageGen',
        toolUseId: `image-${index + 1}`,
        input: { prompt: `Fox poster ${index + 1}`, count: 1 },
        timestamp: index + 1,
        isPending: true,
      }),
    )
    const childToolCallsByParent = new Map<
      string,
      Extract<UIMessage, { type: 'tool_use' }>[]
    >()
    const { rerender } = render(
      <ToolCallGroup
        toolCalls={toolCalls}
        resultMap={new Map()}
        childToolCallsByParent={childToolCallsByParent}
        agentTaskNotifications={{}}
        isStreaming
      />,
    )

    const rail = screen.getByTestId('image-generation-rail')
    expect(rail.firstElementChild?.className).toContain('grid-flow-col')
    expect(screen.getAllByTestId('image-generation-slot')).toHaveLength(4)
    expect(screen.getAllByText('Generating 4 images')).toHaveLength(2)

    const resultMap = new Map<string, Extract<UIMessage, { type: 'tool_result' }>>(
      toolCalls.map((toolCall, index) => [
        toolCall.toolUseId,
        {
          id: `image-result-${index + 1}`,
          type: 'tool_result' as const,
          toolUseId: toolCall.toolUseId,
          content: JSON.stringify({
            type: 'image_generation_result',
            providerId: 'openai-official',
            providerKind: 'openai_oauth',
            model: 'gpt-image-2',
            prompt: `Fox poster ${index + 1}`,
            durationMs: 1200 + index,
            images: [{ path: `/tmp/generated-${index + 1}.png`, mimeType: 'image/png' }],
          }),
          isError: false,
          timestamp: 20 + index,
        },
      ]),
    )

    rerender(
      <ToolCallGroup
        toolCalls={toolCalls.map((toolCall) => ({ ...toolCall, isPending: false }))}
        resultMap={resultMap}
        childToolCallsByParent={childToolCallsByParent}
        agentTaskNotifications={{}}
      />,
    )

    const completedImages = screen.getAllByRole('img')
    expect(completedImages).toHaveLength(4)
    expect(screen.getAllByTestId('image-generation-slot')).toHaveLength(4)
    fireEvent.click(completedImages[2]!)
    expect(screen.getByText('3 / 4')).toBeTruthy()
  })

  it('keeps every requested slot visible when image generation fails', () => {
    render(
      <ToolCallBlock
        toolName="ImageGen"
        input={{ prompt: 'Two fox poster variations', count: 2 }}
        result={{ content: 'Provider quota exhausted', isError: true }}
      />,
    )

    const slots = screen.getAllByTestId('image-generation-slot')
    expect(slots).toHaveLength(2)
    expect(slots.every((slot) => slot.getAttribute('data-error') === 'true')).toBe(true)
    expect(screen.getAllByText('Provider quota exhausted')).toHaveLength(2)
  })

  it('renders thinking content as markdown only after expanding', () => {
    const { container } = render(<ThinkingBlock content={'**important**\n\n- item one'} />)

    // The preview is plain text with the markdown stripped — never rendered
    // markup, which on one line would show as literal `**` / `-` noise.
    expect(container.querySelector('strong')).toBeNull()
    expect(container.querySelector('li')).toBeNull()
    expect(container.textContent).not.toContain('item one')

    fireEvent.click(screen.getByRole('button', { name: /Thought/ }))

    expect(container.querySelector('strong')?.textContent).toBe('important')
    expect(container.querySelector('li')?.textContent).toBe('item one')
  })

  it('hides full thinking content until expanded', () => {
    const content = Array.from({ length: 12 }, (_, index) => `line-${index + 1}`).join('\n')
    const { container } = render(<ThinkingBlock content={content} />)

    // Collapsed shows the opening line only; the body stays shut.
    expect(container.textContent).toContain('line-1')
    expect(container.textContent).not.toContain('line-11')
    expect(container.querySelector('[data-thinking-content="expanded"]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Thought/ }))

    expect(container.textContent).toContain('line-1')
    expect(container.textContent).toContain('line-11')
    expect(container.textContent).toContain('line-12')
  })

  it('shows tool previews only after expanding the tool block', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Read"
        input={{ file_path: '/tmp/example.ts', limit: 20 }}
        result={{ content: 'const answer = 42\nconsole.log(answer)', isError: false }}
      />,
    )

    expect(container.textContent).toContain('Read')
    expect(container.textContent).not.toContain('const answer = 42')

    fireEvent.click(screen.getByRole('button'))

    expect(container.textContent).toContain('Tool Input')
    expect(container.textContent).not.toContain('const answer = 42')
  })

  it('keeps expanded row input and output inline instead of nesting detail cards', () => {
    const { container } = render(
      <ToolCallBlock
        chrome="row"
        toolName="TaskCreate"
        input={{ subject: 'Inspect activity UI', description: 'Find the nested card treatment' }}
        result={{ content: 'Task #1 created successfully', isError: false }}
      />,
    )

    const row = container.querySelector('[data-tool-call-chrome="row"]')
    const disclosure = row?.querySelector<HTMLButtonElement>('[data-chat-disclosure="true"]')
    expect(disclosure).toBeTruthy()
    fireEvent.click(disclosure!)

    const details = container.querySelector('[data-tool-call-details="inline"]')
    expect(details).toBeTruthy()
    expect(details?.className).not.toContain('rounded-')

    const viewers = [...container.querySelectorAll('[data-code-viewer-chrome]')]
    expect(viewers).toHaveLength(2)
    expect(viewers.every((viewer) => viewer.getAttribute('data-code-viewer-chrome') === 'embedded')).toBe(true)
    // Each section owns one compact header and one copy action. The previous
    // nested Tool Output -> PLAINTEXT and Tool Input -> JSON cards doubled both.
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(2)
    expect((details?.textContent?.match(/Tool Output/g) ?? [])).toHaveLength(1)
    expect((details?.textContent?.match(/Tool Input/g) ?? [])).toHaveLength(1)
  })

  // #1149: bash stdout used to be dropped entirely — the card showed the command
  // three times and the result zero times. Output is now echoed into the terminal.
  it('echoes bash stdout into the terminal card when expanded', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Bash"
        input={{ command: 'ls -la', description: 'List files' }}
        result={{ content: 'file-a\nfile-b\nfile-c', isError: false }}
      />,
    )

    // A described command is named by its description; the raw tool name and
    // the command stay in the tooltip.
    expect(container.textContent).toContain('List files')
    expect(screen.getByRole('button').getAttribute('title')).toBe('Bash · ls -la')
    expect(container.textContent).not.toContain('file-a')

    fireEvent.click(screen.getByRole('button'))

    expect(container.textContent).toContain('ls -la')
    expect(container.textContent).toContain('file-a')
    expect(container.textContent).toContain('file-c')
  })

  // The whole point of #1149 is that things stop appearing twice. Deleting the
  // shell guard in getVisibleResultText makes BOTH the terminal body and the
  // generic result box render the same stdout, and every `toContain` assertion
  // stays green through it — so assert the count, not the presence.
  it('renders shell stdout exactly once', () => {
    // Multi-line on purpose: the collapsed header summarises multi-line output as
    // "N lines output" rather than echoing it, so the body is the only place the
    // text may legitimately appear. (Single-line output DOES also show in the
    // header — that is the deliberate "see the result without expanding" affordance.)
    const { container } = render(
      <ToolCallBlock
        toolName="Bash"
        input={{ command: 'ls -la', description: 'List files' }}
        result={{ content: 'UNIQUE_STDOUT_MARKER\nsecond line', isError: false }}
      />,
    )

    fireEvent.click(screen.getByRole('button'))

    const occurrences = (container.textContent?.match(/UNIQUE_STDOUT_MARKER/g) ?? []).length
    expect(occurrences).toBe(1)
  })

  it('renders a shell error body exactly once, and never truncates it', () => {
    // #625 made full tool error output visible; the success-path 12-line window
    // must not quietly start applying to failures.
    const error = Array.from({ length: 25 }, (_, index) => `detail line ${index + 1}`).join('\n')
    const { container } = render(
      <ToolCallBlock
        toolName="Bash"
        input={{ command: 'make', description: 'Build' }}
        result={{ content: error, isError: true }}
      />,
    )

    fireEvent.click(screen.getByRole('button'))

    // Scoped to the output block, not the whole card: the header also carries a
    // one-line summary of the failure, which is not a duplicated body. Counting
    // over `container.textContent` only ever passed by accident — the old
    // material glyph rendered the literal text "error" straight after the
    // summary, and that killed the `\b` the regex depends on.
    const errorBodies = [...container.querySelectorAll('pre')].filter(
      (block) => block.textContent?.includes('detail line 1'),
    )
    expect(errorBodies).toHaveLength(1)
    expect(errorBodies[0]?.textContent).toContain('detail line 25')
    expect(screen.queryByRole('button', { name: /more lines/ })).toBeNull()
  })

  it('drops the duplicate Tool Input JSON when the command is already echoed', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Bash"
        input={{ command: 'ls -la', description: 'List files' }}
        result={{ content: 'file-a', isError: false }}
      />,
    )

    fireEvent.click(screen.getByRole('button'))

    expect(container.textContent).toContain('ls -la')
    expect(container.textContent).not.toContain('Tool Input')
  })

  // ~20% of real Bash calls carry a `timeout`. Suppressing the JSON block only
  // when command+description were the ONLY keys put the command back on screen
  // three times for exactly those calls — the reported symptom, unfixed.
  it('shows the extra shell input keys without re-printing the command', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Bash"
        input={{ command: 'sleep 30', description: 'Wait', timeout: 60000 }}
        result={{ content: 'done', isError: false }}
      />,
    )

    fireEvent.click(screen.getByRole('button'))

    expect(container.textContent).toContain('Tool Input')
    expect(container.textContent).toContain('timeout')
    // The command appears once (the `$` line), never inside the JSON block.
    expect(container.querySelector('[data-code-viewer-content]')?.textContent)
      .not.toContain('sleep 30')
  })

  // The CLI substitutes `(<Tool> completed with no output)` for empty results
  // (src/utils/toolResultStorage.ts, inc-4586) — the desktop never sees ''. Real
  // payload here, not a hand-built empty string.
  it('reports no output for a command that printed nothing', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Bash"
        input={{ command: 'mv a b', description: 'Move' }}
        result={{ content: '(Bash completed with no output)', isError: false }}
      />,
    )

    // Visible collapsed, so the row never reads as "never ran".
    expect(container.textContent).toContain('No output')
    // The model-facing marker itself must never reach the user.
    expect(container.textContent).not.toContain('completed with no output')

    fireEvent.click(screen.getByRole('button'))

    expect(container.textContent).toContain('mv a b')
    expect(container.textContent).toContain('No output')
    expect(container.textContent).not.toContain('completed with no output')
  })

  it('does not label an image-only shell result as having no output', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Bash"
        input={{ command: 'python plot.py', description: 'Plot' }}
        result={{ content: [{ type: 'image', source: { data: 'x' } }], isError: false }}
      />,
    )

    fireEvent.click(screen.getByRole('button'))

    // Nothing to print is not the same as the command printing nothing.
    expect(container.textContent).toContain('python plot.py')
    expect(container.textContent).not.toContain('No output')
  })

  it('keeps rendering the error body for a shell call whose input lacks a command', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Bash"
        input={{}}
        result={{ content: 'InputValidationError: command is required', isError: true }}
      />,
    )

    fireEvent.click(screen.getByRole('button'))

    // Without the terminal card there is no echo, so the generic result box has
    // to take over — otherwise the expanded panel is blank.
    expect(container.textContent).toContain('InputValidationError: command is required')
  })

  it('does not claim "no output" for a shell call that has not finished', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Bash"
        input={{ command: 'sleep 5', description: 'Wait' }}
        isPending
      />,
    )

    // A pending call has no result at all — that is not the same as a result
    // whose output happened to be empty.
    expect(container.textContent).not.toContain('No output')
    expect(container.textContent).toContain('Preparing tool')
  })

  it('echoes PowerShell output through the same shell path', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="PowerShell"
        input={{ command: 'Get-ChildItem', description: 'List files' }}
        result={{ content: 'Mode  Name\n----  ----', isError: false }}
      />,
    )

    // Collapsed header must say what the command is for, same as Bash — a
    // real-machine walkthrough caught PowerShell falling through to a bare tool
    // name, and the row still has to carry more than that.
    expect(container.textContent).toContain('List files')

    fireEvent.click(screen.getByRole('button'))

    // The command itself is not lost, it moves to the terminal where it ran.
    expect(container.textContent).toContain('Get-ChildItem')
    expect(container.textContent).toContain('Mode  Name')
    expect(container.textContent).not.toContain('Tool Input')
  })

  // Read stays out of the shell path: file content is not command output, and it
  // is by far the bulkiest tool output — see #1149.
  it('keeps Read file contents suppressed', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Read"
        input={{ file_path: '/tmp/example.ts' }}
        result={{ content: 'const answer = 42\nconsole.log(answer)', isError: false }}
      />,
    )

    fireEvent.click(screen.getByRole('button'))

    expect(container.textContent).not.toContain('const answer = 42')
    expect(container.textContent).not.toContain('console.log(answer)')
  })

  it('collapses long shell output to a head window and expands on demand', () => {
    const output = Array.from({ length: 40 }, (_, index) => `line-${index + 1}`).join('\n')
    const { container } = render(
      <ToolCallBlock
        toolName="Bash"
        input={{ command: 'seq 40', description: 'Count' }}
        result={{ content: output, isError: false }}
      />,
    )

    fireEvent.click(screen.getByRole('button'))

    // Head kept, tail withheld behind an explicit affordance.
    expect(container.textContent).toContain('line-1')
    expect(container.textContent).toContain('line-12')
    expect(container.textContent).not.toContain('line-13')

    fireEvent.click(screen.getByRole('button', { name: /28 more lines/ }))

    expect(container.textContent).toContain('line-40')

    // Regression: the toggle used to render only while lines were hidden, so
    // expanding removed the control and the output could never be collapsed.
    const collapseButton = screen.getByRole('button', { name: /Show less/ })
    fireEvent.click(collapseButton)

    expect(container.textContent).toContain('line-12')
    expect(container.textContent).not.toContain('line-13')
  })

  it('renders shell output as plain preformatted text, not through CodeViewer', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Bash"
        input={{ command: 'ls', description: 'List' }}
        result={{ content: 'file-a\nfile-b', isError: false }}
      />,
    )

    fireEvent.click(screen.getByRole('button'))

    // Shell output has no language; routing it through CodeViewer would tokenize
    // it twice (Prism, then Shiki) for nothing.
    expect(container.querySelector('[data-shell-output]')).toBeTruthy()
    expect(container.querySelector('[data-highlight-engine]')).toBeNull()
  })

  it('resolves terminal control sequences instead of printing them', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Bash"
        input={{ command: 'pip install x', description: 'Install' }}
        result={{ content: 'Downloading\r 10%\r100%\n\x1b[2K\x1b[1ADone', isError: false }}
      />,
    )

    fireEvent.click(screen.getByRole('button'))

    const output = container.querySelector('[data-shell-output]')?.textContent ?? ''
    expect(output).toContain('100%')
    expect(output).toContain('Done')
    expect(output).not.toContain('[2K')
    expect(output).not.toContain('Downloading')
  })

  it('shows the tool duration once a result has landed', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Bash"
        input={{ command: 'ls', description: 'List' }}
        result={{ content: 'a', isError: false }}
        durationMs={1598}
      />,
    )

    expect(container.textContent).toContain('1.6s')
  })

  it('shows pending Write tool calls while input is still streaming', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Write"
        input={{ file_path: '/private/tmp/ai-code-novel.md' }}
        isPending
        partialInput={'{"file_path":"/private/tmp/ai-code-novel.md","content":"第一章'}
      />,
    )

    expect(container.textContent).toContain('Create')
    expect(screen.getByRole('button').getAttribute('title')).toContain('Write')
    expect(container.textContent).toContain('ai-code-novel.md')
    expect(container.textContent).toContain('Generating content')
  })

  it('shows pending Write line and character progress in the collapsed header', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Write"
        input={{ file_path: '/private/tmp/ai-code-novel.md' }}
        isPending
        partialInput={'{"file_path":"/private/tmp/ai-code-novel.md","content":"alpha\\nbeta'}
      />,
    )

    expect(container.textContent).toContain('Generating content')
    expect(container.textContent).toContain('2 lines')
    expect(container.textContent).toContain('10 chars')
    expect(container.textContent).not.toContain('latest')
  })

  it('expands pending Write tool calls into a live writer preview instead of raw JSON', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Write"
        input={{ file_path: '/private/tmp/ai-code-novel.md' }}
        isPending
        partialInput={'{"file_path":"/private/tmp/ai-code-novel.md","content":"# 第一章\\n\\n正文正在生成'}
      />,
    )

    fireEvent.click(screen.getByRole('button'))

    expect(container.textContent).toContain('Writer')
    expect(container.textContent).toContain('# 第一章')
    expect(container.textContent).toContain('正文正在生成')
    expect(container.textContent).not.toContain('"content"')
  })

  it('formats and wraps pending Bash partial JSON input when expanded', () => {
    const partialInput = [
      '{"command":"cat << \'HTMLEOF\' > /tmp/index.html\\n<!DOCTYPE html>\\n<html lang=\\"zh-CN\\">",',
      '"description":"Create HTML shell command"}',
    ].join('')
    const { container } = render(
      <ToolCallBlock
        toolName="Bash"
        input={{ command: 'cat << \'HTMLEOF\' > /tmp/index.html', description: 'Create HTML shell command' }}
        isPending
        partialInput={partialInput}
      />,
    )

    fireEvent.click(screen.getByRole('button'))

    expect(container.textContent).toContain('Partial input')
    expect(container.textContent).toContain('json')
    expect(container.textContent).toContain('4 lines')
    expect(container.textContent).not.toContain('1 line')

    const contentWrapper = container.querySelector('[data-code-viewer-content]') as HTMLElement | null
    expect(contentWrapper?.style.whiteSpace).toBe('pre-wrap')
    expect(contentWrapper?.style.wordBreak).toBe('break-word')
  })

  it('shows non-windowed Writer preview stats before the 120-line limit', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Write"
        input={{ file_path: '/private/tmp/generated.ts' }}
        isPending
        partialInput={'{"file_path":"/private/tmp/generated.ts","content":"alpha\\nbeta\\ngamma'}
      />,
    )

    fireEvent.click(screen.getByRole('button'))

    expect(container.textContent).toContain('Writer')
    expect(container.textContent).toContain('3 lines')
    expect(container.textContent).toContain('16 chars')
    expect(container.textContent).not.toContain('latest')
  })

  it('shows pending Edit replacement character progress in the collapsed header', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Edit"
        input={{ file_path: '/tmp/example.ts' }}
        isPending
        partialInput={'{"file_path":"/tmp/example.ts","old_string":"const ready = false","new_string":"const ready = true'}
      />,
    )

    expect(container.textContent).toContain('Preparing edit')
    expect(container.textContent).toContain('1 line')
    expect(container.textContent).toContain('18 chars')
  })

  it('windows long pending Write previews to the latest content', () => {
    const lines = Array.from({ length: 180 }, (_, index) => `line-${index + 1}`)
    const escapedContent = lines.join('\\n')
    const { container } = render(
      <ToolCallBlock
        toolName="Write"
        input={{ file_path: '/private/tmp/generated.ts' }}
        isPending
        partialInput={`{"file_path":"/private/tmp/generated.ts","content":"${escapedContent}`}
      />,
    )

    fireEvent.click(screen.getByRole('button'))

    expect(container.textContent).toContain('latest')
    expect(container.textContent).toContain('line-180')
    expect(container.textContent).not.toContain('line-30')
  })

  it('shows a collapsed error summary for failed bash commands', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Bash"
        input={{ command: 'git show 5016bc0 --no-stat', description: 'Show full diff of latest commit' }}
        result={{ content: 'fatal: unrecognized argument: --no-stat\nExit code 128', isError: true }}
      />,
    )

    expect(container.textContent).toContain('Show full diff of latest commit')
    expect(container.textContent).toContain('fatal: unrecognized argument: --no-stat')
    expect(container.querySelector('[data-tool-status]')?.getAttribute('data-tool-status')).toBe('error')
  })

  it('shows full bash error output when the tool block is expanded', () => {
    const lines = Array.from({ length: 8 }, (_, index) => `detail line ${index + 1}`)
    const fullError = [
      '<tool_use_error>InputValidationError: Bash failed due to the following issues: The required parameter `description` is missing.',
      ...lines,
      'final remediation hint: provide a concise command description.',
    ].join('\n')
    const { container } = render(
      <ToolCallBlock
        toolName="Bash"
        input={{ command: 'bun run check:server' }}
        result={{ content: fullError, isError: true }}
      />,
    )

    expect(container.textContent).toContain('InputValidationError')
    expect(container.textContent).not.toContain('final remediation hint')

    fireEvent.click(screen.getByRole('button'))

    // A failed command reads as failed in the terminal head — no exit code is
    // recoverable from this payload, so the pill says so instead of guessing 1.
    expect(container.querySelector('[data-shell-exit]')?.textContent).toBe('Failed')
    expect(container.textContent).toContain('detail line 8')
    expect(container.textContent).toContain('final remediation hint')
  })

  it('shows read tool validation errors when the tool block is expanded', () => {
    const fullError = [
      '<tool_use_error>InputValidationError: Read failed due to the following issues:',
      'The required parameter `file_path` is missing.',
      'The provided limit must be greater than 0.',
    ].join('\n')
    const { container } = render(
      <ToolCallBlock
        toolName="Read"
        input={{}}
        result={{ content: fullError, isError: true }}
      />,
    )

    expect(container.textContent).toContain('Read')
    expect(container.textContent).not.toContain('file_path')

    fireEvent.click(screen.getByRole('button'))

    expect(container.textContent).toContain('Error Output')
    expect(container.textContent).toContain('file_path')
    expect(container.textContent).toContain('limit must be greater than 0')
  })

  it('keeps edit previews while showing edit tool error output when expanded', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Edit"
        input={{
          file_path: '/tmp/example.ts',
          old_string: 'const enabled = false',
          new_string: 'const enabled = true',
        }}
        result={{
          content: [
            'InputValidationError: Edit failed due to the following issues:',
            'The provided old_string was not found in the file.',
          ].join('\n'),
          isError: true,
        }}
      />,
    )

    expect(container.textContent).toContain('Edit')
    expect(container.textContent).not.toContain('old_string was not found')

    fireEvent.click(screen.getByRole('button'))

    expect(container.textContent).toContain('example.ts')
    expect(container.textContent).toContain('Error Output')
    expect(container.textContent).toContain('old_string was not found')
  })

  it('expands tool errors so full Computer Use gate messages are readable', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="mcp__computer-use__left_click"
        input={{ coordinate: [120, 220] }}
        result={{
          content: '"Claude Code Haha" is not in the allowed applications and is currently in front. Take a new screenshot — it may have appeared since your last one.',
          isError: true,
        }}
      />,
    )

    expect(container.textContent).toContain('mcp__computer-use__left_click')
    expect(container.textContent).not.toContain('Take a new screenshot')

    fireEvent.click(screen.getByRole('button'))

    expect(container.textContent).toContain('Take a new screenshot')
    expect(container.textContent).toContain('allowed applications')
  })

  it('shows a diff preview for edit permission requests', async () => {
    useChatStore.setState({
      sessions: {
        'active-tab': {
          messages: [],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: {
            requestId: 'perm-1',
            toolName: 'Edit',
            input: {
              file_path: '/tmp/example.ts',
              old_string: 'const count = 1',
              new_string: 'const count = 2',
            },
          },
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          streamingResponseChars: 0,
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    let container!: HTMLElement
    await act(async () => {
      container = render(
        <PermissionDialog
          requestId="perm-1"
          toolName="Edit"
          input={{
            file_path: '/tmp/example.ts',
            old_string: 'const count = 1',
            new_string: 'const count = 2',
          }}
        />,
      ).container
      await Promise.resolve()
    })

    expect(container.textContent).toContain('/tmp/example.ts')
    expect(container.textContent).toContain('Allow')
    // react-diff-viewer-continued uses styled-components tables that don't
    // fully render in jsdom, so we verify the DiffViewer wrapper is mounted
    expect(container.querySelector('[class*="rounded-[var(--radius-lg)]"]')).toBeTruthy()
  })

  it('keeps every concurrent permission request actionable', () => {
    const firstPermission = {
      requestId: 'perm-read-1',
      toolName: 'Read',
      toolUseId: 'tool-read-1',
      input: { file_path: '/outside/one.ts' },
    }
    const secondPermission = {
      requestId: 'perm-read-2',
      toolName: 'Read',
      toolUseId: 'tool-read-2',
      input: { file_path: '/outside/two.ts' },
    }
    useChatStore.setState({
      sessions: {
        'active-tab': {
          messages: [],
          chatState: 'permission_pending',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: secondPermission,
          pendingPermissions: {
            [firstPermission.requestId]: firstPermission,
            [secondPermission.requestId]: secondPermission,
          },
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          streamingResponseChars: 0,
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    render(
      <>
        <PermissionDialog {...firstPermission} />
        <PermissionDialog {...secondPermission} />
      </>,
    )

    expect(screen.getAllByText('Awaiting approval')).toHaveLength(2)
    expect(screen.getByRole('group', { name: /\/outside\/one\.ts/ })).toBeTruthy()
    expect(screen.getByRole('group', { name: /\/outside\/two\.ts/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Allow: /outside/one.ts' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Allow: /outside/two.ts' })).toBeTruthy()
    expect(screen.queryByText('Responded')).toBeNull()
  })

  it('labels teammate permission prompts with the member name on the lead session', () => {
    const teammatePermission = {
      requestId: 'perm-teammate-1',
      toolName: 'Bash',
      toolUseId: 'tool-teammate-1',
      input: { command: 'ls' },
      displayName: 'researcher',
    }
    useChatStore.setState({
      sessions: {
        'active-tab': {
          messages: [],
          chatState: 'permission_pending',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: teammatePermission,
          pendingPermissions: {
            [teammatePermission.requestId]: teammatePermission,
          },
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          streamingResponseChars: 0,
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    render(<PermissionDialog {...teammatePermission} />)

    expect(screen.getByText('Allow researcher to run this command?')).toBeTruthy()
  })

  // MCP tools that answer with their own interface (MCP-UI `ui://` resources,
  // or a whole page) get it drawn in the conversation, in an isolated frame.
  it('draws an MCP tool\'s HTML interface in an isolated frame', () => {
    const html = '<!doctype html><html><body><button>+1</button></body></html>'
    const { container } = render(
      <ToolCallBlock toolName="mcp__demo__counter" input={{}} result={{ content: [{ type: 'text', text: `[Resource from demo at ui://demo/counter] ${html}` }], isError: false }} />,
    )
    fireEvent.click(container.querySelector('[data-chat-disclosure="true"]')!)

    const frame = screen.getByTitle('Interactive view')
    // The page as the tool sent it, with the snapshot bridge first in it.
    expect(frame.getAttribute('srcdoc')).toBe(withSnapshotBridge(html))
    expect(frame.getAttribute('srcdoc')).toContain('<body><button>+1</button></body>')
    // Scripts run, but with no same-origin access and no way to navigate the app.
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-forms')
    // Outside a conversation there is no composer to add a snapshot to.
    expect(screen.queryByRole('button', { name: 'Add snapshot to chat' })).toBeNull()
    expect(screen.getByText('ui://demo/counter')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
    expect(screen.queryByTitle('Interactive view')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(screen.getByTitle('Interactive view')).toBeTruthy()
  })

  // 动态 UI 快照: the view as the user left it goes into this conversation's
  // composer as a picture.
  it('adds a snapshot of the live MCP view to the conversation draft', async () => {
    const sessionId = 'mcp-snapshot-session'
    // queueComposerPrefill only writes to a session the store has.
    useChatStore.setState((state) => ({ sessions: { ...state.sessions, [sessionId]: { messages: [], composerPrefill: null } as never } }))
    snapshotMocks.request.mockResolvedValue({ html: '<!DOCTYPE html><html><body><b>count: 3</b></body></html>', width: 640, height: 900 })
    snapshotMocks.render.mockResolvedValue('data:image/png;base64,c25hcA==')
    const html = '<!doctype html><html><body><button>+1</button></body></html>'
    const { container } = render(
      <ChatSessionIdProvider value={sessionId}>
        <ToolCallBlock toolName="mcp__demo__counter" input={{}} result={{ content: [{ type: 'text', text: `[Resource from demo at ui://demo/counter] ${html}` }], isError: false }} />
      </ChatSessionIdProvider>,
    )
    fireEvent.click(container.querySelector('[data-chat-disclosure="true"]')!)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add snapshot to chat' }))
    })

    expect(snapshotMocks.request).toHaveBeenCalledWith(screen.getByTitle('Interactive view'))
    expect(snapshotMocks.render).toHaveBeenCalledWith('<!DOCTYPE html><html><body><b>count: 3</b></body></html>', expect.any(Number), 900)
    expect(useChatStore.getState().sessions[sessionId]?.composerPrefill).toMatchObject({
      mode: 'append',
      attachments: [{ type: 'image', name: 'mcp-ui-snapshot.png', mimeType: 'image/png', data: 'data:image/png;base64,c25hcA==' }],
    })

    // A page that does not answer is drawn as the tool sent it.
    snapshotMocks.request.mockResolvedValue(null)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add snapshot to chat' }))
    })
    expect(snapshotMocks.render).toHaveBeenLastCalledWith(html, expect.any(Number), expect.any(Number))
  })

  it('asks only its own frame for the page, and draws a snapshot without anything that runs', () => {
    const bridged = withSnapshotBridge('<!DOCTYPE html><html><head><title>t</title></head><body>x</body></html>')
    expect(bridged.indexOf('data-star-snapshot-bridge')).toBeGreaterThan(bridged.indexOf('<head>'))
    expect(bridged.indexOf('data-star-snapshot-bridge')).toBeLessThan(bridged.indexOf('<title>'))
    expect(bridged).toContain('e.source!==window.parent')
    // A fragment gets the bridge in front of it.
    expect(withSnapshotBridge('<div>card</div>')).toMatch(/^<script data-star-snapshot-bridge>[\s\S]*<\/script><div>card<\/div>$/)

    const clean = sanitizeSnapshotHtml('<html><head><base href="https://evil.test/"><meta http-equiv="refresh" content="0;url=https://evil.test"><script>alert(1)</script></head><body onload="alert(2)"><a href="javascript:alert(3)">a</a><img src="x.png" onerror="alert(4)"><iframe src="https://evil.test"></iframe><p style="color:red">kept</p></body></html>')
    expect(clean).not.toMatch(/<script|<base|http-equiv|onload|onerror|javascript:|<iframe/i)
    expect(clean).toContain('<p style="color:red">kept</p>')
    expect(clean).toContain('<img src="x.png">')
  })

  it('finds an MCP interface only where a tool meant one', () => {
    const page = '<!DOCTYPE html><html><body>hi</body></html>'
    expect(mcpHtmlUi('mcp__demo__page', page)).toEqual({ html: page, uri: null })
    expect(mcpHtmlUi('mcp__demo__ui', [{ type: 'text', text: '[Resource from demo at ui://demo/card] <div class="card">ok</div>' }])).toEqual({ html: '<div class="card">ok</div>', uri: 'ui://demo/card' })
    // A fragment is markup only when it came as a ui:// resource.
    expect(mcpHtmlUi('mcp__demo__ui', '[Resource from demo at https://x.test/a] <div>raw</div>')).toBeNull()
    expect(mcpHtmlUi('mcp__demo__text', 'plain answer <b>bold</b>')).toBeNull()
    expect(mcpHtmlUi('Bash', page)).toBeNull()
  })

  it('leaves HTML from other tools, and failed MCP calls, as text', () => {
    const page = '<!doctype html><html><body>hi</body></html>'
    const failed = render(<ToolCallBlock toolName="mcp__demo__page" input={{}} result={{ content: page, isError: true }} />)
    fireEvent.click(failed.container.querySelector('[data-chat-disclosure="true"]')!)
    expect(screen.queryByTitle('Interactive view')).toBeNull()
    failed.unmount()

    const read = render(<ToolCallBlock toolName="Read" input={{ file_path: '/w/index.html' }} result={{ content: page, isError: false }} />)
    fireEvent.click(read.container.querySelector('[data-chat-disclosure="true"]')!)
    expect(screen.queryByTitle('Interactive view')).toBeNull()
  })

  describe('a STAR media call still waiting for its result', () => {
    const STAR_IMAGE_TOOL = 'mcp__plugin_star-image_star__star_text_to_image'
    const agentTask = (status: StarMediaTask['status']): StarMediaTask => ({
      id: 'task-fox', kind: 'image', mode: 'text_to_image', model: 'm', prompt: 'a red fox', params: {},
      references: { images: [], videos: [] }, status, progress: 0, message: '', outputs: [],
      source: 'agent', createdAt: 1, updatedAt: 1,
    })
    let original: ReturnType<typeof useStarStore.getState>

    beforeEach(() => {
      original = useStarStore.getState()
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
      useStarStore.setState(original, true)
    })

    it('stops asking for a job it never finds, as a call cut off in history does', () => {
      const refreshTasks = vi.fn(async () => {})
      useStarStore.setState({ tasks: [], refreshTasks })
      render(<ToolCallBlock toolName={STAR_IMAGE_TOOL} input={{ prompt: 'a red fox' }} />)

      act(() => { vi.advanceTimersByTime(10 * 60_000) })

      expect(refreshTasks).toHaveBeenCalledTimes(UNMATCHED_TASK_POLLS)
    })

    it('keeps asking while its job is still running', () => {
      const refreshTasks = vi.fn(async () => {})
      useStarStore.setState({ tasks: [agentTask('running')], refreshTasks })
      render(<ToolCallBlock toolName={STAR_IMAGE_TOOL} input={{ prompt: 'a red fox' }} />)

      act(() => { vi.advanceTimersByTime(5 * 60_000) })

      expect(refreshTasks.mock.calls.length).toBeGreaterThan(UNMATCHED_TASK_POLLS)
    })
  })

  function renderPendingCommand(toolName: 'Bash' | 'PowerShell', command: string) {
    const permission = { requestId: `perm-${toolName}`, toolName, toolUseId: `tool-${toolName}`, input: { command } }
    useChatStore.setState({
      sessions: {
        'active-tab': {
          messages: [],
          chatState: 'permission_pending',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: permission,
          pendingPermissions: { [permission.requestId]: permission },
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          streamingResponseChars: 0,
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })
    return render(<PermissionDialog {...permission} />)
  }

  const findingIds = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('[data-destructive-finding]'), (node) => node.getAttribute('data-destructive-finding'))

  it('says what a destructive bash command does and what it costs, before it is allowed', () => {
    const { container } = renderPendingCommand('Bash', 'rm -rf build')

    const warning = screen.getByRole('note', { name: 'This command may be destructive' })
    expect(warning.textContent).toContain('Recursively force-deletes files (rm -rf)')
    expect(warning.textContent).toContain('Deleted files skip the trash and cannot be restored')
    expect(container.querySelector('pre')?.textContent).toBe('$ rm -rf build')
  })

  it('shows a PowerShell command under its own prompt and lists every finding in it', () => {
    const command = 'Remove-Item -Recurse -Force .\\dist; git push --force'
    const { container } = renderPendingCommand('PowerShell', command)

    expect(container.querySelector('pre')?.textContent).toBe(`PS> ${command}`)
    expect(findingIds(container)).toEqual(['delete-recursiveForce', 'gitPushForce'])
    expect(screen.getByRole('note').textContent).toContain('Recursively force-deletes files (Remove-Item -Recurse -Force)')
    expect(screen.getByRole('note').textContent).toContain('Force-pushes to the remote repository (git push --force)')
  })

  it('shows no warning for a command that destroys nothing', () => {
    renderPendingCommand('Bash', 'git status && ls -la')

    expect(screen.queryByRole('note', { name: 'This command may be destructive' })).toBeNull()
  })

  it('does not read a command that only mentions a destructive one as running it', () => {
    expect(findDestructiveCommandRisks('git rm --cached notes.txt', 'bash')).toEqual([])
    expect(findDestructiveCommandRisks('echo "rm -rf /"', 'bash')).toEqual([])
    expect(findDestructiveCommandRisks('git clean -n', 'bash')).toEqual([])
    expect(findDestructiveCommandRisks('git rm --force notes.txt', 'powershell')).toEqual([])
    expect(findDestructiveCommandRisks('Get-ChildItem -Recurse -Force', 'powershell')).toEqual([])
  })

  it('flags every sampled command the CLI warns about', () => {
    // destructiveCommand.ts copies the CLI tables instead of importing them, so
    // this is what notices when the copy falls behind.
    const samples: Array<[CommandShell, string]> = [
      ['bash', 'git reset --hard HEAD~1'],
      ['bash', 'git push origin main --force'],
      ['bash', 'git clean -fd'],
      ['bash', 'git checkout -- .'],
      ['bash', 'git restore .'],
      ['bash', 'git stash drop'],
      ['bash', 'git stash clear'],
      ['bash', 'git branch -D feature'],
      ['bash', 'git commit -m wip --no-verify'],
      ['bash', 'git commit --amend --no-edit'],
      ['bash', 'rm -rf build'],
      ['bash', 'rm -Rf build'],
      ['bash', 'rm -r build'],
      ['bash', 'rm -f build.log'],
      ['bash', 'cd app && rm -rf dist'],
      ['bash', 'psql -c "DROP TABLE users"'],
      ['bash', 'sqlite3 app.db "DELETE FROM users;"'],
      ['bash', 'kubectl delete pod web'],
      ['bash', 'terraform destroy -auto-approve'],
      ['powershell', 'Remove-Item -Recurse -Force .\\dist'],
      ['powershell', 'Remove-Item (Join-Path $r "tmp") -Force -Recurse'],
      ['powershell', 'Get-ChildItem *.log | Remove-Item -Recurse'],
      ['powershell', '{ rm -Force ./x }'],
      ['powershell', 'Clear-Content .\\logs\\*'],
      ['powershell', 'Format-Volume -DriveLetter D'],
      ['powershell', 'Clear-Disk -Number 1 -RemoveData'],
      ['powershell', 'git reset --hard'],
      ['powershell', 'git push -f'],
      ['powershell', 'git clean -xfd'],
      ['powershell', 'git stash clear'],
      ['powershell', 'sqlcmd -Q "TRUNCATE TABLE logs"'],
      ['powershell', 'Stop-Computer'],
      ['powershell', 'Restart-Computer -Force'],
      ['powershell', 'Clear-RecycleBin -Force'],
    ]

    for (const [shell, command] of samples) {
      const cliWarning = shell === 'bash' ? bashCliWarning(command) : powerShellCliWarning(command)
      expect(cliWarning, `the CLI should warn about ${shell}: ${command}`).not.toBeNull()
      expect(findDestructiveCommandRisks(command, shell), `${shell}: ${command}`).not.toHaveLength(0)
    }
  })
})
