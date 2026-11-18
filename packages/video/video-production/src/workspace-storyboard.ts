/** Converts a project Markdown storyboard into editable video shots. */
import { VideoShotId } from './brand.ts'
import type { VideoAspectRatio, VideoResolution, VideoShotInput } from './types.ts'

type Field = 'duration' | 'aspectRatio' | 'resolution' | 'scene' | 'prompt'
type Fields = Partial<Record<Field, string>>

interface ShotSection {
  readonly number: number
  readonly title: string
  readonly fields: Fields
}

const headingLine = /^(#{1,6})\s+(.+?)\s*#*$/u
const shotHeading = /^(?:(?:shot|镜头)\s*#?\s*(\d+)|第\s*(\d+)\s*镜(?:头)?|(\d+))(?=$|[\s.、:：—–-])[\s.、:：—–-]*(.*)$/iu
const fieldLine = new RegExp([
  String.raw`^(?:[-*+]\s+)?(\*\*|__)?`,
  '(时长|duration|画幅|宽高比|aspect ratio|分辨率|resolution|画面|场景|scene|生成提示词|提示词|generation prompt|prompt)',
  String.raw`(?:\1)?\s*[:：]\s*(.*)$`,
].join(''), 'iu')
const fieldKeys: Readonly<Partial<Record<string, Field>>> = {
  时长: 'duration', duration: 'duration', 画幅: 'aspectRatio', 宽高比: 'aspectRatio', 'aspect ratio': 'aspectRatio',
  分辨率: 'resolution', resolution: 'resolution', 画面: 'scene', 场景: 'scene', scene: 'scene',
  生成提示词: 'prompt', 提示词: 'prompt', 'generation prompt': 'prompt', prompt: 'prompt',
}

function aspectRatio(value: string | undefined): VideoAspectRatio | undefined {
  if (value === undefined) return '16:9'
  const ratio = /^(16:9|9:16|1:1)(?=$|[\s(（])/u.exec(value)?.[1]
  return ratio === '16:9' || ratio === '9:16' || ratio === '1:1' ? ratio : undefined
}

function resolution(value: string | undefined): VideoResolution | undefined {
  if (value === undefined) return '480p'
  const size = /^(480p|720p)(?=$|[\s(（])/iu.exec(value)?.[1]?.toLowerCase()
  return size === '480p' || size === '720p' ? size : undefined
}

function toVideoShot(shot: ShotSection, index: number, projectFields: Fields): VideoShotInput | null {
  const seconds = /^(\d+)\s*(?:秒(?:钟)?|s(?:ec(?:ond)?s?)?\.?)?$/iu.exec(shot.fields.duration ?? '')?.[1]
  const duration = Number(seconds)
  const ratio = aspectRatio(shot.fields.aspectRatio ?? projectFields.aspectRatio)
  const size = resolution(shot.fields.resolution ?? projectFields.resolution)
  const prompt = (shot.fields.prompt?.trim() || shot.fields.scene?.trim() || '')
  if (!Number.isInteger(duration) || duration < 1 || duration > 15 || ratio === undefined || size === undefined || prompt === '') {
    return null
  }
  return {
    id: VideoShotId(`workspace-shot-${String(shot.number)}`), title: shot.title, prompt, duration, aspectRatio: ratio,
    resolution: size, assetIds: [], position: { x: 32 + (index % 3) * 348, y: 32 + Math.floor(index / 3) * 382 },
  }
}

/**
 * Read a title and numbered shot sections with explicit durations and prompts or scenes.
 * @param text - Project storyboard Markdown. Shot-level framing and resolution override project values.
 * @returns Editable shots in document order, or null for missing or invalid storyboard data.
 */
export function parseWorkspaceStoryboard(text: string): { title: string; shots: VideoShotInput[] } | null {
  let title = ''
  const projectFields: Fields = {}
  const sections: ShotSection[] = []
  const shotNumbers = new Set<number>()
  let current: ShotSection | undefined
  let continued: 'prompt' | 'scene' | undefined
  let fence: string | undefined

  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim()
    if (fence !== undefined) {
      if (line === fence) fence = undefined
      else if (current !== undefined && continued !== undefined) {
        current.fields[continued] = `${current.fields[continued] ?? ''}\n${raw}`
      }
      continue
    }
    const opener = /^(\x60{3,}|~{3,})/u.exec(line)?.[1]
    if (opener !== undefined) { fence = opener; continue }
    const heading = headingLine.exec(line)
    if (heading?.[1] !== undefined && heading[2] !== undefined) {
      current = undefined
      continued = undefined
      const label = heading[2].trim()
      if (heading[1] === '#' && title === '') title = label
      const match = heading[1].length >= 2 && heading[1].length <= 4 ? shotHeading.exec(label) : null
      if (match !== null) {
        const number = Number(match[1] ?? match[2] ?? match[3])
        if (!Number.isSafeInteger(number) || number < 1 || shotNumbers.has(number)) return null
        shotNumbers.add(number)
        current = { number, title: match[4]?.trim() || label, fields: {} }
        sections.push(current)
      }
      continue
    }

    const match = fieldLine.exec(line)
    const key = match?.[2] === undefined ? undefined : fieldKeys[match[2].toLowerCase()]
    if (key !== undefined && match?.[3] !== undefined) {
      const marker = match[1]
      const value = marker !== undefined && match[3].startsWith(marker) ? match[3].slice(marker.length).trim() : match[3]
      if (current !== undefined) current.fields[key] = value
      else if (sections.length === 0 && (key === 'aspectRatio' || key === 'resolution')) projectFields[key] = value
      continued = key === 'prompt' || key === 'scene' ? key : undefined
    } else if (line.startsWith('|') || /^[-*+]\s+/u.test(line)) continued = undefined
    else if (line !== '' && current !== undefined && continued !== undefined) {
      current.fields[continued] = `${current.fields[continued] ?? ''}\n${raw}`
    }
  }

  if (title === '' || sections.length === 0 || fence !== undefined) return null
  const shots: VideoShotInput[] = []
  for (const section of sections) {
    const shot = toVideoShot(section, shots.length, projectFields)
    if (shot === null) return null
    shots.push(shot)
  }
  return { title, shots }
}
