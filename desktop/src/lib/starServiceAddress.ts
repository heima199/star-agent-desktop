/**
 * The STAR service's own address stays off the screen: an error that quotes it
 * reads 「STAR 服务」 instead. The STAR store registers where its status keeps
 * the address; until then nothing is rewritten.
 */
let source: () => string | null | undefined = () => null

export function setStarServiceAddressSource(next: () => string | null | undefined): void {
  source = next
}

export function hideStarServiceAddress(text: string): string {
  let host = ''
  try {
    const base = source()
    host = base ? new URL(base).host : ''
  } catch {
    host = ''
  }
  if (!host || !text) return text
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text
    .replace(new RegExp(`https?://${escaped}[^\\s"'）)，。]*`, 'gi'), 'STAR 服务')
    .replace(new RegExp(escaped, 'gi'), 'STAR 服务')
}
