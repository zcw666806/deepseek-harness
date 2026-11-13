/** Project ownership for the opt-in restaurant workspace. */
import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { extractProject, FileProjectStore } from './project.ts'

/** Explicit paths belonging to this restaurant workspace. */
export interface Config {
  /** Original offline restaurant page; its scripts are never run on the Host. */
  sourceHtml: string
  /** Writable project file, including undo and redo history. */
  projectPath: string
}

/** Validate the workspace paths before opening the project. */
export const Config: Schema<Config> = Schema.object({
  sourceHtml: Schema.string().required(),
  projectPath: Schema.string().required(),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Single writer shared by restaurant tools and browser operations. */
    restaurantProject: RestaurantProject
  }
}

/** Own the source page and one persistent project writer. */
export default class RestaurantProject extends Service {
  readonly sourceHtml: string
  readonly store: FileProjectStore

  /**
   * Open an existing project or import the source page's JSON literals.
   * @param ctx - plugin owner.
   * @param config - absolute source and persistence paths.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'restaurantProject')
    if (!isAbsolute(config.sourceHtml) || !isAbsolute(config.projectPath)) {
      throw new Error('restaurant-design: sourceHtml and projectPath must be absolute paths')
    }
    this.sourceHtml = readFileSync(config.sourceHtml, 'utf8')
    this.store = new FileProjectStore(config.projectPath, extractProject(this.sourceHtml))
  }
}
