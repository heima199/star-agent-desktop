import { getStarBrandName } from '../../stores/starBrandStore'
import type { StarMode } from '../../stores/starStore'

/**
 * Hero copy of the new-session page in the STAR modes. Code mode keeps the
 * localised upstream question about the project, so it has no entry here.
 * The texts name the console's product name when read: the pages showing
 * them translate with `useTranslation()`, which re-renders on a new name.
 */
export const STAR_HERO_COPY: Record<Exclude<StarMode, 'code'>, { readonly title: string; readonly subtitle: string }> = {
  work: {
    get title() { return `Work with ${getStarBrandName()}` },
    subtitle: '交代一项工作：写文档、做 PPT、分析数据、联网研究、识别文件，或生成图片和视频。',
  },
  design: {
    get title() { return `Design with ${getStarBrandName()}` },
    get subtitle() { return `描述想要的画面或视频，${getStarBrandName()} 帮你生成；也可以上传参考图、参考视频。` },
  },
}
