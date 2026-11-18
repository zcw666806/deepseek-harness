/** Admission and page layout for four-panel text storyboards. */

import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { ComicBubbleId, ComicLayerId, ComicPageId, ComicPanelId, ComicProjectPackage } from './types.ts'

interface StoryboardPanel {
  scene: string
  action: string
  dialogue: string
}

interface Storyboard {
  readonly title: string
  readonly artDirection: string
  readonly panels: readonly StoryboardPanel[]
}

const heading = /^(?:第\s*([一二三四五六七八九十\d]+)\s*格|panel\s+(\d+))(?:\s*[:：.、—-]\s*(.*))?$/iu
const field = /^(画面|动作|对白|scene|action|dialogue)\s*[:：]\s*(.*)$/iu
const markdownLink = /^\[[^\]]+\]\(\s*(?:<([^<>]+)>|([^()\s]+))\s*\)$/u
const storyboardFilename = /(?:^|[/\\])storyboard\.md$/iu
const chineseNumbers: Readonly<Record<string, number>> = { 一: 1, 二: 2, 三: 3, 四: 4 }
const fields: Readonly<Record<string, keyof StoryboardPanel>> = {
  画面: 'scene', 动作: 'action', 对白: 'dialogue', scene: 'scene', action: 'action', dialogue: 'dialogue',
}

/**
 * Read a settled four-panel reply and omit standalone storyboard document links.
 * @param text - Visible Assistant reply text.
 * @returns Ordered panel text, or null when no unambiguous storyboard is present.
 */
export function readStoryboard(text: string): Storyboard | null {
  const panels: StoryboardPanel[] = []
  let current: StoryboardPanel | undefined
  let currentField: keyof StoryboardPanel = 'scene'
  let title = ''
  const artDirection: string[] = []
  for (const line of text.split('\n')) {
    const content = line.trim().replace(/^(?:#{1,6}|[-*])\s+/u, '').replace(/\*\*|__/gu, '')
    if (content === '') continue
    const link = markdownLink.exec(content)
    const destination = link?.[1] ?? link?.[2]
    if (destination !== undefined && storyboardFilename.test(destination)) continue
    const panelMatch = heading.exec(content)
    if (panelMatch !== null) {
      const label = panelMatch[1] ?? panelMatch[2] ?? ''
      if (panels.length === 4 || (chineseNumbers[label] ?? Number(label)) !== panels.length + 1) return null
      current = { scene: panelMatch[3] ?? '', action: '', dialogue: '' }
      panels.push(current)
      currentField = 'scene'
      continue
    }
    if (current === undefined) {
      const bookTitle = /^《([^》]+)》$/u.exec(content)
      if (bookTitle?.[1] !== undefined) title = bookTitle[1]
      else if (!/^[-*_]{3,}$/u.test(content)) artDirection.push(content)
      continue
    }
    const fieldMatch = field.exec(content)
    const name = fieldMatch?.[1]?.toLowerCase()
    const key = name === undefined ? undefined : fields[name]
    if (key !== undefined) {
      currentField = key
      current[key] = fieldMatch?.[2] ?? ''
    } else {
      current[currentField] = [current[currentField], content].filter(Boolean).join('\n')
    }
  }
  return panels.length === 4 && panels.every(panel => panel.scene.trim() !== '')
    ? { title, artDirection: artDirection.join('\n').slice(0, 4096), panels }
    : null
}

/**
 * Compose an editable one-page manuscript with an empty art layer in every panel.
 * @param storyboard - The admitted text storyboard.
 * @param defaultTitle - Localized project title for an untitled reply.
 * @param layerName - Localized label for an empty illustration layer.
 * @param panelHeight - Panel height in pixels. Generated square artwork uses 520.
 * @returns A portable manuscript admitted by the comic project import service.
 */
export function storyboardPackage(
  storyboard: Storyboard, defaultTitle: string, layerName: string, panelHeight = 720,
): ComicProjectPackage {
  return {
    format: 'dsh-comic-project',
    version: 1,
    images: [],
    draft: {
      title: storyboard.title.trim().slice(0, 160) || defaultTitle,
      pages: [{
        id: randomUUID() as ComicPageId,
        title: '',
        width: 1200,
        height: panelHeight * 2 + 160,
        panels: storyboard.panels.map((panel, index) => {
          const dialogue = panel.dialogue.trim()
          const silent = /^(?:|[（(]?\s*(?:无|无对白|none|no dialogue)\s*[）)]?)$/iu.test(dialogue)
          return {
            id: randomUUID() as ComicPanelId,
            x: 64 + (index % 2) * 552,
            y: 64 + Math.floor(index / 2) * (panelHeight + 32),
            width: 520,
            height: panelHeight,
            description: panel.scene.slice(0, 8192),
            notes: panel.action.slice(0, 8192),
            layers: [{ id: randomUUID() as ComicLayerId, name: layerName, visible: true, versions: [], imageId: null }],
            bubbles: silent ? [] : [{
              id: randomUUID() as ComicBubbleId, text: dialogue.slice(0, 8192), speaker: '',
              x: 32, y: 28, width: 456, height: 130, fontSize: 26,
            }],
          }
        }),
      }],
    },
  }
}
