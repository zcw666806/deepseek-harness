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
/** One deployment-configured route for drawing a finished storyboard. */
export type ComicImageGenerationTargetId = Branded<'ComicImageGenerationTargetId'>

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

/** OpenAI-compatible image service used to draw a storyboard in one request. */
export interface ComicImageGenerationConfig {
  /** API base URL ending at the provider's version path, such as `/v1`. */
  readonly baseURL: string
  /** Credential reference resolved on the Host when a request starts. */
  readonly credentialRef: string
  /** Provider's image model ID. */
  readonly model: string
  /** Time limit in milliseconds for the request and any image download. */
  readonly timeoutMs?: number
  /** HTTPS origins allowed to serve artwork when a provider returns a URL. */
  readonly imageOrigins?: string[]
}

/** Browser-visible image route. Endpoints and credentials stay on the Host. */
export interface ComicImageGenerationTarget {
  readonly id: ComicImageGenerationTargetId
  readonly title: string
  readonly model: string
}

/** Named image route a deployment makes available to comic Sessions. */
export interface ComicImageGenerationTargetConfig extends ComicImageGenerationConfig {
  /** Stable route ID unique within the deployment. */
  readonly id: string
  /** Display label for the model picker. */
  readonly title: string
}

/** Deployment limits and optional storyboard image generation. */
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
  /** Optional single image route, exposed under the reserved ID `default`. */
  readonly imageGeneration?: ComicImageGenerationConfig | null
  /** Additional selectable image routes, each with a provider endpoint and credential reference. */
  readonly imageGenerationTargets?: ComicImageGenerationTargetConfig[]
}
