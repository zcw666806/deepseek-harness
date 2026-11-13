/** Admission and durable validation for manuscript geometry and image references. */
import { brandString } from '@deepseek-ai/dsh-brand'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { z } from 'zod'
import type {
  ComicBubbleId, ComicDraft, ComicImage, ComicImageId, ComicLayerId, ComicPackageImage,
  ComicPageId, ComicPanelId, ComicProject, ComicProjectId,
} from './types.ts'

const uuid = z.uuid()
const coordinate = z.number().int().nonnegative()
const dimension = z.number().int().min(1).max(8192)
const title = z.string().trim().min(1).max(160)
const label = z.string().max(160)
const details = z.string().max(8192)
const rect = { x: coordinate, y: coordinate, width: dimension, height: dimension }
const imageId = z.string().regex(/^[a-f0-9]{64}$/).transform(value => brandString<ComicImageId>(value))
const image = z.object({ id: imageId, width: dimension, height: dimension, bytes: z.number().int().positive() }).strict()
const layer = z.object({
  id: uuid.transform(value => brandString<ComicLayerId>(value)),
  name: label, visible: z.boolean(), versions: z.array(image).max(128), imageId: imageId.nullable(),
}).strict()
const bubble = z.object({
  ...rect, id: uuid.transform(value => brandString<ComicBubbleId>(value)), text: details, speaker: label,
  fontSize: z.number().int().min(1).max(256).optional(), tailX: coordinate.optional(), tailY: coordinate.optional(),
}).strict()
const panel = z.object({
  ...rect, id: uuid.transform(value => brandString<ComicPanelId>(value)),
  description: details, notes: details, layers: z.array(layer).max(32), bubbles: z.array(bubble).max(32),
}).strict()
const page = z.object({
  id: uuid.transform(value => brandString<ComicPageId>(value)), title: label,
  width: dimension, height: dimension, panels: z.array(panel).max(32),
}).strict()
const draftFields = { title, pages: z.array(page).min(1).max(32) }

/** User-facing project title admitted when creating a manuscript. */
export const projectTitle = title

/** Wire shape accepted for a proposed full manuscript edit. */
export const draftSchema: z.ZodType<ComicDraft> = z.object(draftFields).strict()

/** Manifest and explicit image entries transferred as a portable project. */
export const packageSchema = z.object({
  format: z.literal('dsh-comic-project'), version: z.literal(1), draft: draftSchema,
  images: z.array(z.object({ id: imageId, data: z.string() }).strict() satisfies z.ZodType<ComicPackageImage>),
}).strict()

/**
 * Compare dimensions and encoded length for a shared content identity.
 * @param first - recorded image facts.
 * @param second - proposed or independently observed image facts.
 * @returns whether all image facts match.
 */
export function sameImage(first: ComicImage, second: ComicImage): boolean {
  return first.id === second.id && first.width === second.width && first.height === second.height && first.bytes === second.bytes
}

/**
 * Collect the retained PNGs of an already validated draft.
 * @param draft - manuscript with valid layer references.
 * @returns deduplicated PNG references in first-use order.
 */
export function imagesOf(draft: ComicDraft): Map<ComicImageId, ComicImage> {
  const images = new Map<ComicImageId, ComicImage>()
  for (const page of draft.pages) for (const panel of page.panels) for (const layer of panel.layers) {
    for (const image of layer.versions) images.set(image.id, image)
  }
  return images
}

/**
 * Validate references, unique identities, and containment across a complete draft.
 * @param draft - draft with structurally validated values.
 * @returns the first relationship violation, if present.
 */
export function draftProblem(draft: ComicDraft): string | undefined {
  const ids = new Set<string>()
  const images = new Map<ComicImageId, ComicImage>()
  const claim = (id: string): boolean => {
    if (ids.has(id)) return false
    ids.add(id)
    return true
  }
  for (const page of draft.pages) {
    if (!claim(page.id) || page.width * page.height > 16 * 1024 * 1024) return 'Page identities and pixel sizes must be valid.'
    for (const panel of page.panels) {
      if (!claim(panel.id) || panel.x + panel.width > page.width || panel.y + panel.height > page.height) {
        return 'A panel must have a unique identity and fit its page.'
      }
      for (const bubble of panel.bubbles) {
        if (!claim(bubble.id) || bubble.x + bubble.width > panel.width || bubble.y + bubble.height > panel.height) {
          return 'A balloon must have a unique identity and fit its panel.'
        }
        if ((bubble.tailX === undefined) !== (bubble.tailY === undefined)
          || (bubble.tailX ?? 0) > panel.width || (bubble.tailY ?? 0) > panel.height) {
          return 'A balloon tail must have both coordinates and fit its panel.'
        }
      }
      for (const layer of panel.layers) {
        if (!claim(layer.id)) return 'Layer identities must be unique.'
        const layerImages = new Set<ComicImageId>()
        const first = layer.versions[0]
        for (const image of layer.versions) {
          if (layerImages.has(image.id)) return 'A layer cannot contain duplicate image versions.'
          layerImages.add(image.id)
          if (image.width !== first?.width || image.height !== first.height) return 'Layer versions must use the same source dimensions.'
          const prior = images.get(image.id)
          if (prior !== undefined && !sameImage(prior, image)) return 'A source identity cannot have conflicting image metadata.'
          images.set(image.id, image)
        }
        if (layer.imageId !== null && !layerImages.has(layer.imageId)) return 'The selected version must belong to its layer.'
      }
    }
  }
  return undefined
}

const projectRecord: z.ZodType<ComicProject> = z.object({
  ...draftFields,
  id: uuid.transform(value => brandString<ComicProjectId>(value)),
  workspaceId: uuid.transform(value => brandString<WorkspaceId>(value)),
  revision: z.number().int().positive(),
}).strict().superRefine((value, issue) => {
  const problem = draftProblem(value)
  if (problem !== undefined) issue.addIssue({ code: 'custom', message: problem })
})

/** One atomic project record owns its current revision and all live image references. */
export const comicProductionDomain = defineDomain({
  name: 'comic_production', version: 1,
  tables: { projects: domainTable<ComicProjectId, ComicProject>(projectRecord) },
})
