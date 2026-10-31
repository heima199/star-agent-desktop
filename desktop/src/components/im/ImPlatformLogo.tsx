import { publicAssetPath } from '@/lib/publicAsset'

/**
 * Official app marks of the IM platforms the assistant connects to, drawn the
 * way each app shows itself: Feishu, WeCom and DingTalk use the brand files
 * already shipped for the connector market (`public/connectors/*.svg`);
 * WeChat, QQ, Telegram, WhatsApp and Slack use their glyphs from Simple Icons
 * (CC0) on the brand color. Brand colors are fixed on purpose: they are the
 * one place a theme must not recolor.
 */
export type ImPlatformId = 'feishu' | 'wechat' | 'wecom' | 'dingtalk' | 'qq' | 'telegram' | 'whatsapp' | 'slack'

const WECHAT = 'M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.03zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z'

const QQ = 'M21.395 15.035a39.548 39.548 0 0 0-.803-2.264l-1.079-2.695c.001-.032.014-.562.014-.836C19.526 4.632 17.351 0 12 0S4.474 4.632 4.474 9.241c0 .274.013.804.014.836l-1.08 2.695a38.97 38.97 0 0 0-.802 2.264c-1.021 3.283-.69 4.643-.438 4.673.54.065 2.103-2.472 2.103-2.472 0 1.469.756 3.387 2.394 4.771-.612.188-1.363.479-1.845.835-.434.32-.379.646-.301.778.343.578 5.883.369 7.482.189 1.6.18 7.14.389 7.483-.189.078-.132.132-.458-.301-.778-.483-.356-1.233-.646-1.846-.836 1.637-1.384 2.393-3.302 2.393-4.771 0 0 1.563 2.537 2.103 2.472.251-.03.581-1.39-.438-4.673zM12.662 4.846c.039-1.052.659-1.878 1.385-1.846s1.281.912 1.242 1.964c-.039 1.051-.659 1.878-1.385 1.846s-1.282-.912-1.242-1.964zM9.954 3c.725-.033 1.345.794 1.384 1.846.04 1.052-.517 1.931-1.242 1.963-.726.033-1.346-.794-1.385-1.845C8.672 3.912 9.228 3.033 9.954 3zM7.421 8.294c.194-.43 2.147-.908 4.566-.908h.026c2.418 0 4.372.479 4.566.908a.14.14 0 0 1 .014.061c0 .031-.01.059-.026.083-.163.238-2.333 1.416-4.553 1.416h-.026c-2.221 0-4.39-1.178-4.553-1.416a.136.136 0 0 1-.014-.144zm10.422 8.622c-.22 3.676-2.403 5.987-5.774 6.021h-.137c-3.37-.033-5.554-2.345-5.773-6.021-.081-1.35.001-2.496.147-3.43.318.063.638.122.958.176v3.506s1.658.334 3.318.103v-3.225c.488.027.96.04 1.406.034h.025c1.678.021 3.714-.204 5.683-.594.146.934.227 2.08.147 3.43zM10.48 5.804c.313-.041.542-.409.508-.825-.033-.415-.314-.72-.629-.679-.313.04-.541.409-.508.824.034.417.315.72.629.68zM14.479 5.156c.078.037.221.042.289-.146.035-.095.025-.165-.009-.214-.023-.033-.133-.118-.371-.176-.904-.22-1.341.384-1.405.499-.04.072-.012.176.056.227.067.051.139.037.179-.006.58-.628 1.21-.208 1.261-.184z'

const TELEGRAM = 'M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z'

const WHATSAPP = 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z'

/** Slack's mark in its four official colors (the Simple Icons glyph, split by quadrant). */
const SLACK: { fill: string; d: string }[] = [
  { fill: '#E01E5A', d: 'M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z' },
  { fill: '#36C5F0', d: 'M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z' },
  { fill: '#2EB67D', d: 'M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z' },
  { fill: '#ECB22E', d: 'M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z' },
]

export const IM_PLATFORM_NAMES: Record<ImPlatformId, string> = {
  feishu: '飞书',
  wechat: '微信',
  wecom: '企业微信',
  dingtalk: '钉钉',
  qq: 'QQ',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  slack: 'Slack',
}

export function isImPlatformId(value: string): value is ImPlatformId {
  return value in IM_PLATFORM_NAMES
}

/** A glyph centred on a colored tile, scaled to `inset` of the tile. */
function GlyphTile({ size, color, inset, children, label }: { size: number; color: string; inset: number; children: React.ReactNode; label?: string }) {
  const pad = (24 * (1 - inset)) / 2
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className="shrink-0">
      <rect width="24" height="24" rx="5.5" fill={color} />
      <g transform={`translate(${pad} ${pad}) scale(${inset})`}>{children}</g>
    </svg>
  )
}

/** Brand file from `public/connectors`, on a white tile so it reads on every theme. */
function FileTile({ size, file, inset, label }: { size: number; file: string; inset: number; label?: string }) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="inline-flex shrink-0 items-center justify-center bg-white shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]"
      style={{ width: size, height: size, borderRadius: size * 0.23 }}
    >
      <img src={publicAssetPath(file)} alt="" draggable={false} style={{ width: size * inset, height: size * inset }} />
    </span>
  )
}

export function ImPlatformLogo({ platform, size = 36, label }: { platform: ImPlatformId; size?: number; label?: string }) {
  switch (platform) {
    case 'feishu':
      return <FileTile size={size} file="connectors/feishu.svg" inset={0.72} label={label} />
    case 'wecom':
      return <FileTile size={size} file="connectors/wecom.svg" inset={0.7} label={label} />
    case 'dingtalk':
      return (
        <img
          src={publicAssetPath('connectors/dingtalk.svg')}
          alt={label ?? ''}
          aria-hidden={label ? undefined : true}
          draggable={false}
          className="shrink-0"
          style={{ width: size, height: size }}
        />
      )
    case 'wechat':
      return <GlyphTile size={size} color="#07C160" inset={0.7} label={label}><path d={WECHAT} fill="#fff" /></GlyphTile>
    case 'qq':
      return <GlyphTile size={size} color="#12B7F5" inset={0.68} label={label}><path d={QQ} fill="#fff" /></GlyphTile>
    case 'telegram':
      // The glyph is a disc with the plane cut out: a white disc behind it
      // turns the cut-out into a white plane on the blue tile.
      return (
        <GlyphTile size={size} color="#26A5E4" inset={0.86} label={label}>
          <circle cx="12" cy="12" r="10" fill="#fff" />
          <path d={TELEGRAM} fill="#26A5E4" />
        </GlyphTile>
      )
    case 'whatsapp':
      return <GlyphTile size={size} color="#25D366" inset={0.66} label={label}><path d={WHATSAPP} fill="#fff" /></GlyphTile>
    case 'slack':
      return (
        <span
          role={label ? 'img' : undefined}
          aria-label={label}
          aria-hidden={label ? undefined : true}
          className="inline-flex shrink-0 items-center justify-center bg-white shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]"
          style={{ width: size, height: size, borderRadius: size * 0.23 }}
        >
          <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" aria-hidden="true">
            {SLACK.map(part => <path key={part.fill} d={part.d} fill={part.fill} />)}
          </svg>
        </span>
      )
  }
}
