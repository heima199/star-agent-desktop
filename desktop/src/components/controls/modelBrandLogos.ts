import { publicAssetPath } from '@/lib/publicAsset'

/**
 * Official logos of the model brands the STAR catalog sells, shipped with the
 * app (lobe-icons, MIT: public/model-brands/LICENSE.lobe-icons). `mono` logos
 * are single-color marks drawn in the text color, so they read on both grounds.
 */
export type ModelBrandLogo = { src: string; mono: boolean }

const BRANDS: ReadonlyArray<{ pattern: RegExp; file: string; mono?: boolean }> = [
  { pattern: /claude|anthropic/i, file: 'claude-color' },
  { pattern: /gemini|google/i, file: 'gemini-color' },
  { pattern: /chatgpt|openai|\bgpt/i, file: 'openai', mono: true },
  { pattern: /grok|\bxai\b|x\.ai/i, file: 'grok', mono: true },
  { pattern: /deepseek|深度求索/i, file: 'deepseek-color' },
  { pattern: /智谱|zhipu|chatglm|\bglm/i, file: 'zhipu-color' },
  { pattern: /通义|千问|qwen|tongyi|qwq/i, file: 'qwen-color' },
  { pattern: /minimax|海螺|\babab/i, file: 'minimax-color' },
  { pattern: /kimi|moonshot|月之暗面/i, file: 'kimi', mono: true },
  { pattern: /mimo|小米|xiaomi/i, file: 'xiaomimimo', mono: true },
  { pattern: /豆包|doubao|字节|bytedance/i, file: 'doubao-color' },
]

/** The logo for the first name that names a known brand (brand name, then id, then model id). */
export function modelBrandLogo(...names: ReadonlyArray<string | null | undefined>): ModelBrandLogo | null {
  for (const name of names) {
    if (!name?.trim()) continue
    const hit = BRANDS.find(brand => brand.pattern.test(name))
    if (hit) return { src: publicAssetPath(`model-brands/${hit.file}.svg`), mono: Boolean(hit.mono) }
  }
  return null
}
