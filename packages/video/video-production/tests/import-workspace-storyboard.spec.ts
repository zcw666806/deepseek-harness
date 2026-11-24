import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { persistSession, projectInput, setup } from './helpers.ts'

const STORYBOARD = [
  '# 晨间花市',
  '- 分辨率：720p',
  '### 01 开场',
  '- 时长：5 秒',
  '- 画幅：9:16',
  '- 生成提示词：Move through the flower market at sunrise.',
  '### 02 花束',
  '- 时长：7 秒',
  '- 画幅：9:16',
  '- 画面：小摊上的花束。',
].join('\n')

describe('importWorkspaceStoryboard', () => {
  it('imports the Session workspace storyboard as shots without calling a generator', async () => {
    const fixture = await setup()
    const { ctx, root, sessionId } = fixture
    try {
      await mkdir(join(root, 'flower-market'))
      await writeFile(join(root, 'flower-market', 'storyboard.md'), STORYBOARD, 'utf8')
      const project = await ctx.videoProduction.importWorkspaceStoryboard(sessionId, join('flower-market', 'storyboard.md'))
      expect(project).toMatchObject({
        revision: 1, title: '晨间花市', assets: [], exports: [],
        shots: [
          { title: '开场', duration: 5, aspectRatio: '9:16', resolution: '720p', versions: [],
            prompt: 'Move through the flower market at sunrise.' },
          { title: '花束', duration: 7, aspectRatio: '9:16', resolution: '720p', versions: [], prompt: '小摊上的花束。' },
        ],
      })
      await expect(ctx.videoProduction.view(sessionId)).resolves.toEqual(project)
    } finally {
      await fixture.dispose()
    }
  })

  it('returns an existing project without replacing its shots', async () => {
    const fixture = await setup()
    const { ctx, root, sessionId } = fixture
    try {
      const saved = await ctx.videoProduction.update(sessionId, projectInput())
      await writeFile(join(root, 'storyboard.md'), STORYBOARD, 'utf8')
      await expect(ctx.videoProduction.importWorkspaceStoryboard(sessionId, 'storyboard.md')).resolves.toEqual(saved)
    } finally {
      await fixture.dispose()
    }
  })

  it('returns one committed project to simultaneous first imports', async () => {
    const fixture = await setup()
    const { ctx, root, sessionId } = fixture
    try {
      const path = join(root, 'storyboard.md')
      await writeFile(path, STORYBOARD, 'utf8')
      const [first, second] = await Promise.all([
        ctx.videoProduction.importWorkspaceStoryboard(sessionId, path),
        ctx.videoProduction.importWorkspaceStoryboard(sessionId, 'storyboard.md'),
      ])
      expect(first.revision).toBe(1)
      expect(second).toEqual(first)
      await expect(ctx.videoProduction.view(sessionId)).resolves.toEqual(first)
    } finally {
      await fixture.dispose()
    }
  })

  it('requires a storyboard in the Session workspace, including after resolving path aliases', async () => {
    const fixture = await setup()
    const outside = await mkdtemp(join(tmpdir(), 'dsh-video-storyboard-outside-'))
    const { ctx, root, sessionId } = fixture
    try {
      const externalStoryboard = join(outside, 'storyboard.md')
      await writeFile(externalStoryboard, STORYBOARD, 'utf8')
      await writeFile(join(root, 'notes.md'), STORYBOARD, 'utf8')
      await symlink(outside, join(root, 'external'), process.platform === 'win32' ? 'junction' : 'dir')
      for (const path of [externalStoryboard, join('external', 'storyboard.md'), 'notes.md']) {
        await expect(ctx.videoProduction.importWorkspaceStoryboard(sessionId, path))
          .rejects.toMatchObject({ code: 'video-production/invalid', details: { reason: 'storyboard-path' } })
      }
      await expect(ctx.videoProduction.view(sessionId)).resolves.toMatchObject({ revision: 0 })
    } finally {
      await fixture.dispose()
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('requires a Session with a workspace', async () => {
    const fixture = await setup()
    const { ctx } = fixture
    try {
      const sessionId = SessionId('video-storyboard-without-workspace')
      const session = ctx.sessions.create(sessionId)
      await persistSession(ctx, session)
      await expect(ctx.videoProduction.importWorkspaceStoryboard(sessionId, 'storyboard.md'))
        .rejects.toMatchObject({ code: 'video-production/invalid', details: { reason: 'storyboard-path' } })
    } finally {
      await fixture.dispose()
    }
  })

  it('rejects unreadable, oversized, or incomplete storyboards before saving', async () => {
    const fixture = await setup({ maxProjectBytes: 1024 })
    const { ctx, root, sessionId } = fixture
    const importStoryboard = () => ctx.videoProduction.importWorkspaceStoryboard(sessionId, 'storyboard.md')
    const path = join(root, 'storyboard.md')
    try {
      await expect(importStoryboard()).rejects.toMatchObject({ details: { reason: 'storyboard-read' } })
      await writeFile(path, Buffer.from([0xff]))
      await expect(importStoryboard()).rejects.toMatchObject({ details: { reason: 'storyboard-read' } })
      await writeFile(path, ' '.repeat(1025), 'utf8')
      await expect(importStoryboard()).rejects.toMatchObject({ details: { reason: 'storyboard-read' } })
      await writeFile(path, '# Outline without shot details', 'utf8')
      await expect(importStoryboard()).rejects.toMatchObject({ details: { reason: 'storyboard-format' } })
      await expect(ctx.videoProduction.view(sessionId)).resolves.toMatchObject({ revision: 0 })
    } finally {
      await fixture.dispose()
    }
  })
})
