/**
 * The interface an MCP tool hands back as HTML (MCP-UI's `ui://` resources,
 * or a whole page), to show in the conversation where the user can work it.
 *
 * The CLI turns an embedded resource into text that starts with
 * `[Resource from <server> at <uri>] ` (src/services/mcp/client.ts), so that
 * prefix is how a `ui://` resource is recognised here.
 */

const RESOURCE_PREFIX = /^\[Resource from (.+?) at (\S+)\] /
/** Markup that is a page, not text that happens to start with `<`. */
const HTML_DOCUMENT = /^\s*(?:<!doctype html|<html[\s>]|<head[\s>]|<body[\s>])/i
const MARKUP = /^\s*</
/** A bigger answer is shown as text only: drawing it would cost more than it shows. */
const MAX_HTML_CHARS = 2_000_000

export type McpHtmlUi = {
  html: string
  /** The resource's address, when the tool sent one. */
  uri: string | null
}

/** Message the conversation sends a live MCP view to ask for its current page. */
export const MCP_SNAPSHOT_REQUEST = 'star:mcp-ui-snapshot'
/** The view's answer: `{ type, id, html, width, height }`. */
export const MCP_SNAPSHOT_REPLY = 'star:mcp-ui-snapshot-reply'

/**
 * Runs inside the view's sandboxed frame, which the app cannot read from
 * outside. Asked by its parent (and only its parent), it sends back the page as
 * it is now: what scripts drew, what was typed into fields, canvases as
 * pictures. Plain ES5, so it runs whatever the page targets.
 */
const SNAPSHOT_BRIDGE = `<script data-star-snapshot-bridge>(function(){window.addEventListener('message',function(e){var d=e.data;if(!d||d.type!=='${MCP_SNAPSHOT_REQUEST}'||e.source!==window.parent)return;try{var root=document.documentElement.cloneNode(true);var live=document.querySelectorAll('input,textarea,select,canvas');var copy=root.querySelectorAll('input,textarea,select,canvas');for(var i=0;i<live.length&&i<copy.length;i++){var a=live[i],b=copy[i];if(a.tagName==='INPUT'){if(a.type==='checkbox'||a.type==='radio'){if(a.checked)b.setAttribute('checked','');else b.removeAttribute('checked')}else b.setAttribute('value',a.value)}else if(a.tagName==='TEXTAREA'){b.textContent=a.value}else if(a.tagName==='SELECT'){for(var j=0;j<a.options.length&&j<b.options.length;j++){if(a.options[j].selected)b.options[j].setAttribute('selected','');else b.options[j].removeAttribute('selected')}}else if(a.tagName==='CANVAS'){try{var img=document.createElement('img');img.src=a.toDataURL();img.width=a.width;img.height=a.height;img.style.cssText=a.style.cssText;b.parentNode.replaceChild(img,b)}catch(x){}}}window.parent.postMessage({type:'${MCP_SNAPSHOT_REPLY}',id:d.id,html:'<!DOCTYPE html>'+root.outerHTML,width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},'*')}catch(x){}})})();</script>`

/** `html` with the snapshot bridge first in its head, so a snapshot sees the page as it is. */
export function withSnapshotBridge(html: string): string {
  const head = /<head(?:\s[^>]*)?>/i.exec(html)
  if (head) return html.slice(0, head.index + head[0].length) + SNAPSHOT_BRIDGE + html.slice(head.index + head[0].length)
  const root = /<html(?:\s[^>]*)?>/i.exec(html)
  if (root) return html.slice(0, root.index + root[0].length) + SNAPSHOT_BRIDGE + html.slice(root.index + root[0].length)
  return SNAPSHOT_BRIDGE + html
}

/** Elements a snapshot is drawn without: anything that runs, embeds, navigates or rebases. */
const SNAPSHOT_STRIP = 'script, noscript, iframe, frame, frameset, object, embed, base, meta[http-equiv]'
const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'xlink:href'])

/**
 * A page from an MCP view, made safe to draw in the app's own origin: scripts,
 * embedded frames, event handlers and javascript: links are removed. The frame
 * that draws it does not run scripts either; this is the second lock.
 */
export function sanitizeSnapshotHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll(SNAPSHOT_STRIP).forEach(node => node.remove())
  for (const element of Array.from(doc.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith('on')) element.removeAttribute(attribute.name)
      else if (URL_ATTRIBUTES.has(name) && /^\s*javascript:/i.test(attribute.value)) element.removeAttribute(attribute.name)
    }
  }
  return `<!DOCTYPE html>${doc.documentElement.outerHTML}`
}

function textBlocks(content: unknown): string[] {
  if (typeof content === 'string') return [content]
  if (!Array.isArray(content)) return []
  return content.flatMap((block): string[] => {
    if (typeof block === 'string') return [block]
    if (block && typeof block === 'object' && (block as { type?: unknown }).type === 'text') {
      const text = (block as { text?: unknown }).text
      return typeof text === 'string' ? [text] : []
    }
    return []
  })
}

/** The HTML interface in an MCP tool's result, or null when there is none. */
export function mcpHtmlUi(toolName: string, content: unknown): McpHtmlUi | null {
  if (!toolName.startsWith('mcp__')) return null
  for (const text of textBlocks(content)) {
    const resource = RESOURCE_PREFIX.exec(text)
    const body = resource ? text.slice(resource[0].length) : text
    const uri = resource?.[2] ?? null
    if (body.length > MAX_HTML_CHARS) continue
    if (HTML_DOCUMENT.test(body) || (uri?.startsWith('ui://') && MARKUP.test(body))) return { html: body, uri }
  }
  return null
}
