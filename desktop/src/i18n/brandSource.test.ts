// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * 「star需要跟随后台设置的名称来展示」（只替换品牌词）: the STAR pages name the
 * product the console sets — useStarBrand() in React, getStarBrandName()
 * elsewhere, or a `{brand}` placeholder filled where the text is shown — so no
 * text under components/star or pages/star spells the brand out. The locale
 * files have their own check in brand.test.tsx.
 *
 * Only text counts: string literals, template parts and JSX text. Comments,
 * identifiers (STAR_STUDIO_TAB_ID, star-image) and markers such as STAR-DEBUG
 * are not text. What has to keep the word is listed below with the reason.
 */

const srcRoot = path.resolve(import.meta.dirname, '..')
const STAR_DIRECTORIES = ['components/star', 'pages/star']

/** The brand as a word: not part of an identifier, a path, a placeholder or a marker. */
const BRAND_WORD = /(?<![A-Za-z0-9_\-./{])STAR(?![A-Za-z0-9_-])/g

/** Texts that keep the word, by file: the phrase that starts where the word stands, and why. */
const KEPT: Record<string, Array<{ phrase: string; why: string }>> = {
  'components/star/StarLoginScreen.tsx': [
    { phrase: 'STAR Work', why: 'the separate STAR Work app whose sign-in is reused; its name does not follow the console' },
  ],
  'pages/star/market/skillCatalogB.ts': [
    { phrase: 'STAR 法则', why: 'the STAR interview method (Situation, Task, Action, Result), not the product' },
    { phrase: 'STAR 框架', why: 'the same interview method' },
  ],
}

type Mention = { file: string; line: number; text: string; phrase: string }

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : []
  })
}

function isText(node: ts.Node): node is ts.LiteralLikeNode {
  return ts.isStringLiteral(node)
    || ts.isNoSubstitutionTemplateLiteral(node)
    || ts.isTemplateHead(node)
    || ts.isTemplateMiddle(node)
    || ts.isTemplateTail(node)
    || ts.isJsxText(node)
}

/** Every place a text in the file spells the brand word. */
function brandMentions(file: string, code: string): Mention[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, kind)
  const found: Mention[] = []
  const visit = (node: ts.Node): void => {
    if (isText(node)) {
      for (const match of node.text.matchAll(BRAND_WORD)) {
        found.push({
          file,
          line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          text: node.text.replace(/\s+/g, ' ').trim(),
          phrase: node.text.slice(match.index, match.index + 16),
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

function isKept(mention: Mention): boolean {
  return KEPT[mention.file]?.some((kept) => mention.phrase.startsWith(kept.phrase)) ?? false
}

const files = STAR_DIRECTORIES.flatMap((directory) => sourceFiles(path.join(srcRoot, directory)))
// Keyed with forward slashes on every platform, like the table above.
const mentions = files.flatMap((file) => brandMentions(path.relative(srcRoot, file).split(path.sep).join('/'), readFileSync(file, 'utf8')))

describe('the STAR pages do not spell the brand out', () => {
  it('reads texts and leaves comments, identifiers, markers and placeholders alone', () => {
    const fixture = [
      '// STAR in a comment',
      '/** STAR in a doc comment */',
      "const STAR_TAB = 'star-image'",
      "const marker = 'STAR-DEBUG'",
      "const placeholder = '{brand} 绘图'",
      "export const title = 'STAR 绘图'",
      'export const label = `Work with STAR ${placeholder}`',
      'export const View = () => <p title="和 STAR 一起创作">交给 STAR{/* STAR */}</p>',
    ].join('\n')

    expect(brandMentions('Fixture.tsx', fixture).map((mention) => mention.text)).toEqual([
      'STAR 绘图',
      'Work with STAR',
      '和 STAR 一起创作',
      '交给 STAR',
    ])
  })

  it('reads the source tree it is guarding', () => {
    // A scan that found nothing would pass the rule below.
    expect(files.length).toBeGreaterThan(60)
    expect(files.some((file) => file.endsWith('StarComposerTray.tsx'))).toBe(true)
    expect(files.some((file) => file.endsWith('pluginCatalog.ts'))).toBe(true)
  })

  it('names the product with the console name instead of a typed STAR', () => {
    const spelled = mentions.filter((mention) => !isKept(mention)).map((mention) => `${mention.file}:${mention.line}  ${mention.text}`)

    // Use useStarBrand() / getStarBrandName(), or `{brand}` formatted where the text is shown.
    expect(spelled).toEqual([])
  })

  it('keeps no exemption the source no longer needs', () => {
    const stale = Object.entries(KEPT).flatMap(([file, kept]) => kept
      .filter((entry) => !mentions.some((mention) => mention.file === file && mention.phrase.startsWith(entry.phrase)))
      .map((entry) => `${file}  ${entry.phrase}`))

    expect(stale).toEqual([])
  })
})
