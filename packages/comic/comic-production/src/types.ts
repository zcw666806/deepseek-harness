/** Browser-safe identities, editable manuscript, and lossless layer references. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

/** A manuscript whose lifecycle is independent of any Session. */
export type ComicProjectId = Branded<'ComicProjectId'>
/** One page in a manuscript. */
export type ComicPageId = Branded<'ComicPageId'>
/** A panel within a page. */
export type ComicPanelId = Branded<'ComicPanelId'>
/** An independently replaceable image layer. */
export type ComicLayerId = Branded<'ComicLayerId'>
/** One balloon in a panel. */
export type ComicBubbleId = Branded<'ComicBubbleId'>
/** The SHA-256 identity of an original PNG. */
export type ComicImageId = Branded<'ComicImageId'>

/** Original image facts recorded after decoding the submitted PNG. */
export interface ComicImage {
  readonly id: ComicImageId
  readonly width: number
  readonly height: number
  readonly bytes: number
}

/** One independently visible layer with its complete retained image history. */
export interface ComicLayer {
  readonly id: ComicLayerId
  readonly name: string
  readonly visible: boolean
  readonly versions: readonly ComicImage[]
  readonly imageId: ComicImageId | null
}

/** Text, speaker, and balloon geometry in panel pixels. */
export interface ComicBubble {
  readonly id: ComicBubbleId
  readonly text: string
  readonly speaker: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly fontSize?: number | undefined
  readonly tailX?: number | undefined
  readonly tailY?: number | undefined
}

/** Panel geometry in page pixels, with layers and balloons in display order. */
export interface ComicPanel {
  readonly id: ComicPanelId
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly description: string
  readonly notes: string
  readonly layers: readonly ComicLayer[]
  readonly bubbles: readonly ComicBubble[]
}

/** A page with its export pixel size and reading order. */
export interface ComicPage {
  readonly id: ComicPageId
  readonly title: string
  readonly width: number
  readonly height: number
  readonly panels: readonly ComicPanel[]
}

/** Editable manuscript values, excluding the Host-assigned owner and revision. */
export interface ComicDraft {
  readonly title: string
  readonly pages: readonly ComicPage[]
}

/** One committed revision of a Workspace's manuscript. */
export interface ComicProject extends ComicDraft {
  readonly id: ComicProjectId
  readonly workspaceId: WorkspaceId
  readonly revision: number
}

/** Project identity and title for the Workspace's manuscript picker. */
export interface ComicProjectSummary {
  readonly id: ComicProjectId
  readonly title: string
  readonly revision: number
}

/** Base64 slice of one original PNG with raw-byte offsets. */
export interface ComicImageChunk {
  readonly data: string
  readonly offset: number
  readonly nextOffset: number
  readonly done: boolean
}

/** One byte-for-byte PNG entry in a portable project. */
export interface ComicPackageImage {
  readonly id: ComicImageId
  readonly data: string
}

/** Portable manuscript and its retained images, with no Session or Workspace IDs. */
export interface ComicProjectPackage {
  readonly format: 'dsh-comic-project'
  readonly version: 1
  readonly draft: ComicDraft
  readonly images: readonly ComicPackageImage[]
}

/** Deployment limits for manuscript metadata, PNG admission, and project transfers. */
export interface Config {
  /** Harness home containing the private original PNG store. Defaults to the active Harness home. */
  readonly dshHome?: string
  /** Maximum encoded byte length of a single original PNG. */
  readonly maxImageBytes?: number
  /** Maximum decoded pixel count of a single original PNG. */
  readonly maxImagePixels?: number
  /** Maximum UTF-8 byte length of the editable manuscript metadata. */
  readonly maxProjectBytes?: number
  /** Maximum UTF-8 byte length of the portable project, including base64 artwork. */
  readonly maxPackageBytes?: number
}
