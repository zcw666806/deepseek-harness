import { runInNewContext } from 'node:vm'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it } from 'vitest'
import { renderPage } from '../src/page.ts'
import type { Project } from '../src/types.ts'

const fixture = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
const WALLS = [];
const WINS = [];
const DOORS = [];
const SLIDES = [];
const ROOMS = [];
const BOUNDS = {};
let state = {};
function defaultState(){
  return { furniture: [{ type: 'bed' }] };
}
function save(){ localStorage.setItem('old-state', JSON.stringify(state)); }
function toggleWall(id){
  state.demolished.push(id);
}
$('#reset').onclick = () => { state = defaultState(); };
</script></body></html>`

const project = (): Project => ({
  formatVersion: 1, revision: 7, title: 'Restaurant',
  base: {
    walls: [[0, 0, 200, 300, 'n']], windows: [], doors: [], slides: [], rooms: [],
    bounds: { x: 0, y: 0, w: 10000, h: 10000 },
  },
  state: {
    furniture: [{ id: 'table-1', type: 'table', name: 'Table', cx: 1000, cy: 1000, w: 600, d: 700, rot: 0, color: '#ffffff' }],
    rooms: {}, demolished: [], measures: [],
  },
  groups: [], keepouts: [],
})

function childSource(html: string): string {
  const start = html.lastIndexOf('.srcdoc=') + '.srcdoc='.length
  return JSON.parse(html.slice(start, html.indexOf(';\n</script>', start))) as string
}

const windows: JSDOM[] = []
afterEach(() => { for (const dom of windows.splice(0)) dom.window.close() })

interface BridgeRequest {
  channel: string
  id: string
  method: string
  payload?: { expectedRevision: number; state?: Project['state'] }
}

interface BridgeHarness {
  selectItem(id: string): void
  setDragging(active: boolean): void
  saveAt(cx: number): void
  readX(): number
  readIds(): string[]
  renderCount(): number
}

function bridgeHarness(initial: Project, view?: 'plan' | 'scene'): {
  dom: JSDOM
  requests: BridgeRequest[]
  controls: BridgeHarness
  reply(request: BridgeRequest, result: unknown): void
  notifyProposalChange(): void
} {
  const dom = new JSDOM('<!doctype html><body><aside class="right"></aside><main id="stage"><svg id="plan"></svg></main><button id="undo"></button><button id="redo"></button><button id="reset"></button><button id="importJson"></button><input id="fileIn"><button id="exportJson"></button></body>',
    { runScripts: 'outside-only', url: 'https://restaurant.invalid/' })
  windows.push(dom)
  const requests: BridgeRequest[] = []
  const parent = { postMessage: (request: BridgeRequest) => requests.push(request) }
  Object.defineProperty(dom.window, 'parent', { value: parent })
  dom.window.setInterval = () => 0
  const setup = `
    window.__restaurantBootstrap = ${JSON.stringify({ project: initial, pollIntervalMs: 750, view })};
    let state = JSON.parse(JSON.stringify(window.__restaurantBootstrap.project.state));
    const ui = { sel: null, tool: 'select', layers: { furn: true } };
    const $ = selector => document.querySelector(selector);
    const svg = $('#plan');
    const undoStack = [], redoStack = [];
    let drag = null, libDrag = null, LANG = 'zh';
    const s2t = value => value;
    function select(value) { ui.sel = value; }
    function undo() {}
    function redo() {}
    $('#undo').onclick = undo;
    $('#redo').onclick = redo;
    function updateHeader() {}
    let renders = 0;
    function renderAll() { renders++; updateHeader(); }
    function validateSel() {}
    function setLang(value) { LANG = value; }
    function setTool(value) { ui.tool = value; }
    function download() {}
    function mutate(action) { action(); }
    window.testHarness = {
      selectItem(id) { select({ kind: 'furn', id }); },
      setDragging(active) { drag = active ? {} : null; },
      saveAt(cx) { state.furniture[0].cx = cx; window.RestaurantBridge.save(); },
      readX() { return state.furniture[0].cx; },
      readIds() { return state.furniture.map(item => item.id); },
      renderCount() { return renders; }
    };
  `
  dom.window.eval(setup + readFileSync(new URL('../web/bridge.js', import.meta.url), 'utf8'))
  return {
    dom, requests,
    controls: (dom.window as unknown as { testHarness: BridgeHarness }).testHarness,
    reply(request, result) {
      dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
        source: parent as unknown as Window,
        data: { channel: 'restaurant', id: request.id, result },
      }))
    },
    notifyProposalChange() {
      dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
        source: parent as unknown as Window,
        data: { channel: 'restaurant', method: 'proposal-changed' },
      }))
    },
  }
}

async function settle(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve))
}

function proposed(initial: Project, canApply = true) {
  return {
    id: 'proposal-1', baseRevision: initial.revision, groupId: 'group-1', beforeSeats: 2, afterSeats: 4,
    removedItemIds: ['table-1'],
    addedItems: [
      { ...initial.state.furniture[0]!, id: 'proposal-table', cx: 1300 },
      { ...initial.state.furniture[0]!, id: 'proposal-chair', type: 'chair', cx: 1300, cy: 1800 },
    ],
    chairEnvelopes: [{ itemId: 'proposal-chair', polygon: [[0, 0], [100, 0], [100, 100], [0, 100]] }],
    template: { tableWidthMm: 1200, tableDepthMm: 750, chairWidthMm: 450, chairDepthMm: 450, chairPulloutMm: 300 },
    issues: canApply ? [] : [{ kind: 'chair-clearance', itemIds: ['proposal-chair'], obstacleId: 'wall:2', overlapMm: 35.58, message: 'Chair blocked' }],
    canApply,
  }
}

function viewerHost(view?: 'plan' | 'scene') {
  const initial = project()
  const html = renderPage(fixture, { project: initial, pollIntervalMs: 750, ...(view === undefined ? {} : { view }) })
  const script = /<script>([\s\S]*)<\/script>/u.exec(html)![1]!
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://restaurant.invalid/' })
  windows.push(dom)
  const replies: unknown[] = []
  const calls: { url: string; options: RequestInit }[] = []
  const frame = dom.window.document.querySelector<HTMLIFrameElement>('#restaurant-frame')!
  frame.contentWindow!.postMessage = message => { replies.push(message) }
  let receive: (event: { source: unknown; data: unknown }) => Promise<void> = async () => { throw new Error('No parent listener') }
  let snapshot: { project: Project; selection: string[]; issues: unknown[]; proposal: ReturnType<typeof proposed> | null } = {
    project: initial, selection: [], issues: [], proposal: null,
  }
  const clicks = new Map<string, (event: { isTrusted: boolean }) => void>()
  for (const id of ['restaurant-proposal-apply', 'restaurant-proposal-cancel']) {
    const button = dom.window.document.getElementById(id)
    if (button) Object.defineProperty(button, 'addEventListener', { value: (_type: string, listener: (event: { isTrusted: boolean }) => void) => { clicks.set(id, listener) } })
  }
  runInNewContext(script, {
    document: dom.window.document,
    window: { addEventListener: (_name: string, value: typeof receive) => { receive = value } },
    crypto: { randomUUID: () => 'test-operation' },
    fetch: async (url: string, options: RequestInit) => {
      calls.push({ url, options })
      if (url.endsWith('/applyProposal') || url.endsWith('/cancelProposal')) {
        snapshot = { ...snapshot, proposal: null }
      }
      return { ok: true, json: async () => url.endsWith('.state') ? snapshot : { result: { ok: true, value: snapshot } } }
    },
  })
  return {
    initial, dom, frame, replies, calls, clicks,
    setProposal(proposal: ReturnType<typeof proposed> | null, next = initial) {
      snapshot = { ...snapshot, project: next, proposal }
    },
    receive(method: string, payload?: unknown, source: unknown = frame.contentWindow) {
      return receive({ source, data: { channel: 'restaurant', id: 'request', method, payload } })
    },
  }
}

describe('restaurant page adapter', () => {
  it('initializes the supplied renderer with the complete authoritative project', () => {
    const initial = project()
    const html = renderPage(fixture, { project: initial, pollIntervalMs: 750 })
    const child = childSource(html)
    expect(child).toContain('const WALLS = [[0,0,200,300,"n"]];')
    expect(child).toContain('const BOUNDS = {"x":0,"y":0,"w":10000,"h":10000};')
    expect(child).toContain(`let state = ${JSON.stringify(initial.state)};`)
    expect(child).toContain('"pollIntervalMs":750')
    expect(child).not.toContain("localStorage.setItem('old-state'")
    expect(child).not.toContain("type: 'bed'")
    expect(child).not.toContain('state.demolished.push(id)')
    expect(child).toContain("$('#reset').hidden = true;")
    expect(child).toContain('window.RestaurantBridge?.save()')
  })

  it('keeps the supplied code in a network-isolated opaque-origin frame', () => {
    const html = renderPage(fixture, { project: project(), pollIntervalMs: 750 })
    expect(html).toContain('sandbox="allow-scripts allow-downloads allow-pointer-lock"')
    expect(html).not.toContain('allow-same-origin')
    const child = childSource(html)
    expect(child).toContain("connect-src 'none'")
    expect(child).toContain("frame-src 'none'")
    expect(child).toContain("base-uri 'none'")
    expect(child.indexOf('Content-Security-Policy')).toBeLessThan(child.indexOf('<meta charset'))
    expect(child).not.toContain("fetch('/api/")
    expect(child).toContain("window.parent.postMessage({ channel: 'restaurant'")
    const earlyScript = childSource(renderPage('<script>early()</script>' + fixture, { project: project(), pollIntervalMs: 750 }))
    expect(earlyScript.indexOf('Content-Security-Policy')).toBeLessThan(earlyScript.indexOf('<script>early()'))
  })

  it('preserves script-closing names as data without breaking the trusted wrapper', () => {
    const initial = project()
    const name = '</script><script>parent.stolen=true</script>\u2028'
    const hostile = { ...initial, state: { ...initial.state, furniture: [{ ...initial.state.furniture[0]!, name }] } }
    const html = renderPage(fixture + '<!-- </script><script>source()</script> -->', { project: hostile, pollIntervalMs: 750 })
    expect(html.match(/<script\b/gu)).toHaveLength(1)
    expect(html).not.toContain('<script>parent.stolen')
    const child = childSource(html)
    const declaration = /^let state = (.+);$/mu.exec(child)![1]!
    expect((JSON.parse(declaration) as Project['state']).furniture[0]!.name).toBe(name)
  })

  it('refuses viewers whose required integration anchors are absent', () => {
    const options = { project: project(), pollIntervalMs: 750 }
    expect(() => renderPage(fixture.replace('const WALLS = [];', ''), options)).toThrow('missing WALLS')
    expect(() => renderPage(fixture.replace(/^function save[^\r\n]*$/mu, ''), options)).toThrow('missing save')
    expect(() => renderPage(fixture.replace('<head>', '').replace('</head>', ''), options)).toThrow('document structure')
  })

  it('proxies only restaurant messages from the actual iframe window', async () => {
    const host = viewerHost()
    await host.receive('state', null, {})
    await host.receive('https://example.com/')
    expect(host.calls).toHaveLength(0)
    await host.receive('state')
    await host.receive('move', { expectedRevision: 7, itemIds: ['table-1'], dxMm: 300, dyMm: 0 })
    expect(host.calls.map(call => call.url)).toEqual(['/api/restaurant.state', '/restaurant-rpc/move'])
    expect(JSON.parse(host.calls[1]!.options.body as string)).toMatchObject({ type: 'client-request', rpcId: 'test-operation', method: 'move' })
    expect(host.replies).toHaveLength(2)
    expect(host.frame.srcdoc).toContain('window.RestaurantBridge')
  })

  it('keeps confirmation outside the sandbox and sends the displayed proposal ID on a trusted click', async () => {
    const host = viewerHost('plan')
    host.setProposal(proposed(host.initial))
    await host.receive('state')
    expect(host.dom.window.document.querySelector('#restaurant-proposal-title')!.textContent).toContain('2 → 4')
    await host.receive('applyProposal', { proposalId: 'proposal-1' })
    await host.receive('cancelProposal', { proposalId: 'proposal-1' })
    await host.receive('move', { expectedRevision: 7, itemIds: ['table-1'], dxMm: 300, dyMm: 0 })
    host.clicks.get('restaurant-proposal-apply')!({ isTrusted: false })
    expect(host.calls).toHaveLength(1)
    host.clicks.get('restaurant-proposal-apply')!({ isTrusted: true })
    await settle()
    expect(host.calls[1]!.url).toBe('/restaurant-rpc/applyProposal')
    expect(JSON.parse(host.calls[1]!.options.body as string).payload).toEqual({ proposalId: 'proposal-1' })
    expect(host.dom.window.document.querySelector<HTMLElement>('#restaurant-proposal')!.hidden).toBe(true)
    expect(host.dom.window.document.querySelector('#restaurant-proposal-notice')!.textContent).toContain('已应用')
  })

  it('keeps the scene companion read-only and reports stale proposals in the plan viewer', async () => {
    const sceneHost = viewerHost('scene')
    sceneHost.setProposal(proposed(sceneHost.initial))
    await sceneHost.receive('state')
    await sceneHost.receive('select', { itemIds: ['table-1'] })
    await sceneHost.receive('move')
    await sceneHost.receive('applyProposal')
    expect(sceneHost.calls.map(call => call.url)).toEqual(['/api/restaurant.state'])
    expect(sceneHost.dom.window.document.querySelector('#restaurant-proposal')).toBeNull()

    const planHost = viewerHost('plan')
    const blocked = proposed(planHost.initial, false)
    planHost.setProposal(blocked)
    await planHost.receive('state')
    expect(planHost.dom.window.document.querySelector<HTMLButtonElement>('#restaurant-proposal-apply')!.disabled).toBe(true)
    expect(planHost.dom.window.document.querySelector('#restaurant-proposal-issues')!.textContent).toContain('拉椅空间受阻 · 座椅 1 / 墙段 2 · 35.6 mm')
    planHost.setProposal(blocked, { ...planHost.initial, revision: 8 })
    await planHost.receive('state')
    expect(planHost.dom.window.document.querySelector<HTMLElement>('#restaurant-proposal')!.hidden).toBe(true)
    expect(planHost.dom.window.document.querySelector('#restaurant-proposal-notice')!.textContent).toContain('已失效')
  })

  it.each(['plan', 'scene'] as const)('renders the candidate in the %s without saving it and restores the original on cancel', async view => {
    const initial = project()
    const bridge = bridgeHarness(initial, view)
    const proposal = proposed(initial, false)
    bridge.reply(bridge.requests[0]!, { ok: true, value: { project: initial, selection: [], issues: [], proposal } })
    await settle()
    expect(bridge.controls.readIds()).toEqual(['proposal-table', 'proposal-chair'])
    expect(bridge.controls.renderCount()).toBe(1)
    const doc = bridge.dom.window.document
    expect(doc.body.hasAttribute('data-restaurant-preview')).toBe(true)
    expect(doc.querySelector('#restaurant-preview polygon.conflict')?.getAttribute('data-item-id')).toBe('proposal-chair')
    bridge.controls.saveAt(1400)
    expect(bridge.controls.readX()).toBe(1300)
    expect(bridge.requests.every(request => request.method !== 'save')).toBe(true)
    bridge.notifyProposalChange()
    await settle()
    const refreshed = bridge.requests.filter(request => request.method === 'state').at(-1)!
    bridge.reply(refreshed, { ok: true, value: { project: initial, selection: [], issues: [], proposal: null } })
    await settle()
    expect(bridge.controls.readIds()).toEqual(['table-1'])
    expect(bridge.controls.readX()).toBe(1000)
    expect(doc.body.hasAttribute('data-restaurant-preview')).toBe(false)
  })

  it('keeps a drag based on its original revision when a selection response contains a newer remote edit', async () => {
    const initial = project()
    const bridge = bridgeHarness(initial)
    bridge.reply(bridge.requests[0]!, { ok: true, value: { project: initial, selection: [], issues: [] } })
    await settle()
    bridge.controls.selectItem('table-1')
    await settle()
    const selected = bridge.requests.find(request => request.method === 'select')!
    bridge.controls.setDragging(true)
    const remote = { ...initial, revision: 8, state: { ...initial.state, furniture: [{ ...initial.state.furniture[0]!, cx: 5000 }] } }
    bridge.reply(selected, { ok: true, value: { project: remote, selection: ['table-1'], issues: [] } })
    await settle()
    expect(bridge.controls.readX()).toBe(1000)
    bridge.controls.setDragging(false)
    bridge.controls.saveAt(1300)
    await settle()
    const saved = bridge.requests.find(request => request.method === 'save')!
    expect(saved.payload?.expectedRevision).toBe(7)
    expect(saved.payload?.state?.furniture[0]!.cx).toBe(1300)
    bridge.reply(saved, { ok: false, error: { code: 'REVISION_CONFLICT', message: 'Expected revision 7, current revision is 8.' } })
    await settle()
    const refreshed = bridge.requests[bridge.requests.length - 1]!
    expect(refreshed.method).toBe('state')
    bridge.reply(refreshed, { ok: true, value: { project: remote, selection: ['table-1'], issues: [] } })
    await settle()
    expect(bridge.controls.readX()).toBe(5000)
    expect(bridge.dom.window.document.querySelector('[role="status"]')!.textContent).toContain('8')
    expect(bridge.dom.window.document.querySelector('[role="alert"]')!.textContent).toContain('Expected revision 7')
  })

  it('routes existing undo buttons through the authoritative project history', async () => {
    const initial = project()
    const bridge = bridgeHarness(initial)
    bridge.reply(bridge.requests[0]!, { ok: true, value: { project: initial, selection: [], issues: [], history: { canUndo: true, canRedo: false } } })
    await settle()
    bridge.dom.window.document.querySelector<HTMLButtonElement>('#undo')!.click()
    await settle()
    const undone = bridge.requests.find(request => request.method === 'undo')!
    expect(undone.payload?.expectedRevision).toBe(7)
    bridge.reply(undone, { ok: true, value: { project: { ...initial, revision: 8 }, selection: [], issues: [], history: { canUndo: false, canRedo: true } } })
    await settle()
    expect(bridge.dom.window.document.querySelector<HTMLButtonElement>('#undo')!.disabled).toBe(true)
    expect(bridge.dom.window.document.querySelector<HTMLButtonElement>('#redo')!.disabled).toBe(false)
  })

  it('rolls back rejected edits and displays the affected objects as text', async () => {
    const initial = project()
    const bridge = bridgeHarness(initial)
    bridge.reply(bridge.requests[0]!, { ok: true, value: { project: initial, selection: [], issues: [] } })
    await settle()
    bridge.controls.saveAt(1300)
    await settle()
    const saved = bridge.requests.find(request => request.method === 'save')!
    bridge.reply(saved, { ok: false, error: { code: 'LAYOUT_CONFLICT', message: 'Layout conflict', details: {
      issues: [{ itemIds: ['table-1'], obstacleId: 'w2', message: '<img src=x onerror=alert(1)>' }],
    } } })
    await settle()
    const refreshed = bridge.requests[bridge.requests.length - 1]!
    bridge.reply(refreshed, { ok: true, value: { project: initial, selection: [], issues: [] } })
    await settle()
    expect(bridge.controls.readX()).toBe(1000)
    const alert = bridge.dom.window.document.querySelector('[role="alert"]')!
    expect(alert.textContent).toContain('table-1 / w2')
    expect(alert.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(alert.querySelector('img')).toBeNull()
  })
})
