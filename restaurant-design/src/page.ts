/** Sandboxed adaptation of the supplied restaurant viewer and its trusted Host bridge. */
import { readFileSync } from 'node:fs'
import type { Project } from './types.ts'

/** Initial project and polling cadence for the restaurant viewer. */
export interface RestaurantPageOptions {
  project: Project
  pollIntervalMs: number
  embedded?: boolean
  view?: 'plan' | 'scene'
}

const bridgeSource = readFileSync(new URL('../web/bridge.js', import.meta.url), 'utf8')
const stylesSource = readFileSync(new URL('../web/styles.css', import.meta.url), 'utf8')
const parentSource = readFileSync(new URL('../web/viewer-host.js', import.meta.url), 'utf8')

function scriptJson(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')
}

function replaceDeclaration(html: string, name: string, value: unknown, kind = 'const'): string {
  const declaration = new RegExp(`^${kind} ${name} = [^\\r\\n]*;`, 'm')
  if (!declaration.test(html)) throw new Error(`Restaurant viewer is missing ${name}`)
  return html.replace(declaration, () => `${kind} ${name} = ${scriptJson(value)};`)
}

function replaceRequired(html: string, pattern: RegExp, replacement: string, subject: string): string {
  if (!pattern.test(html)) throw new Error(`Restaurant viewer is missing ${subject}`)
  return html.replace(pattern, () => replacement)
}

/**
 * Render a trusted wrapper around an opaque-origin viewer with restaurant-only messages.
 * @param sourceHtml Supplied offline viewer source; never evaluated by the Host.
 * @param options Authoritative initial project and configured polling interval.
 * @returns HTML whose sandbox prevents the supplied viewer from accessing Host credentials or APIs.
 */
export function renderPage(sourceHtml: string, options: RestaurantPageOptions): string {
  let child = sourceHtml
  const { project } = options
  for (const [name, value] of [
    ['WALLS', project.base.walls], ['WINS', project.base.windows], ['DOORS', project.base.doors],
    ['SLIDES', project.base.slides], ['ROOMS', project.base.rooms], ['BOUNDS', project.base.bounds],
  ] as const) child = replaceDeclaration(child, name, value)
  child = replaceDeclaration(child, 'state', project.state, 'let')
  child = replaceRequired(child, /^function defaultState\(\)\{[\s\S]*?^\}/m,
    `function defaultState(){ return JSON.parse(${scriptJson(JSON.stringify(project.state))}); }`, 'defaultState')
  child = replaceRequired(child, /^function save\(\)\{[^\r\n]*\}/m,
    'function save(){ window.RestaurantBridge?.save(); }', 'save')
  child = replaceRequired(child, /^function toggleWall\(id\)\{[\s\S]*?^\}/m,
    'function toggleWall(){ window.RestaurantBridge?.locked(); }', 'toggleWall')
  child = replaceRequired(child, /^\$\('#reset'\)\.onclick = [^\r\n]*;/m, "$('#reset').hidden = true;", 'reset')
  if (options.view === 'plan') {
    const initialScene = 'if (/[?&#]view=2d/.test(location.search + location.hash)) return;'
    child = child.replace(initialScene, 'return;')
  }
  const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'"
  if (!/<head(?:\s[^>]*)?>/i.test(child) || !/<\/body>/i.test(child)) throw new Error('Restaurant viewer is missing its document structure')
  // The policy precedes attachment bytes, including any script placed before its head.
  child = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><style>${stylesSource}</style>`
    + child.replace(/^\uFEFF?\s*<!doctype[^>]*>/i, '')
  child = child.replace(/<\/body>/i,
    () => `<script>window.__restaurantBootstrap=${scriptJson({ project, pollIntervalMs: options.pollIntervalMs, view: options.view, embedded: options.embedded })};\n${bridgeSource}</script></body>`)
  const scene = options.view === 'scene'
  const proposalControls = scene ? '' : `
<section id="restaurant-proposal" hidden aria-label="布置预览">
  <div class="proposal-copy">
    <strong id="restaurant-proposal-title" role="status"></strong>
    <p id="restaurant-proposal-size"></p>
    <ul id="restaurant-proposal-issues"></ul>
  </div>
  <div class="proposal-actions">
    <button type="button" id="restaurant-proposal-apply"></button>
    <button type="button" id="restaurant-proposal-cancel"></button>
  </div>
</section>
<p id="restaurant-proposal-notice" role="status" hidden></p>`
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>餐厅方案</title>
<style>
html,body{margin:0;width:100%;height:100%;overflow:hidden}
body{display:flex;flex-direction:column;background:#faf7f1;color:#271f1a;font:14px/1.45 system-ui,sans-serif}
iframe{display:block;border:0;width:100%;flex:1;min-height:0}
#restaurant-proposal{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid #ccb897;background:#fff4df}
#restaurant-proposal[hidden],#restaurant-proposal-notice[hidden]{display:none}
.proposal-copy{flex:1;min-width:0}
.proposal-copy p{margin:4px 0 0}
#restaurant-proposal-issues{max-height:90px;overflow:auto;margin:4px 0 0;padding-left:20px;color:#792419;overflow-wrap:anywhere}
.proposal-actions{display:flex;flex:none;gap:8px;flex-wrap:wrap}
.proposal-actions button{font:inherit;min-height:36px;padding:6px 12px;border:1px solid #9b816a;border-radius:6px;background:#fff;color:#271f1a;cursor:pointer}
#restaurant-proposal-apply{background:#693a22;border-color:#693a22;color:white}
.proposal-actions button:disabled{opacity:.55;cursor:default}
#restaurant-proposal-notice{margin:0;padding:6px 16px;background:#faf0e3;border-bottom:1px solid #ccb897}
body[data-embedded] #restaurant-proposal{padding:8px 12px}
body[data-embedded] #restaurant-proposal-issues{max-height:clamp(28px,14vh,90px)}
@media(max-width:480px){#restaurant-proposal{flex-direction:column;gap:6px}.proposal-actions{width:100%}.proposal-actions button{flex:1}}
</style></head>
<body${options.embedded ? ' data-embedded' : ''}>${proposalControls}<iframe id="restaurant-frame" title="${scene ? '餐厅 3D' : '餐厅方案'}" data-view="${options.view ?? 'interactive'}" sandbox="allow-scripts allow-downloads allow-pointer-lock"></iframe>
<script>${parentSource}
document.getElementById('restaurant-frame').srcdoc=${scriptJson(child)};
</script></body></html>\n`
}
