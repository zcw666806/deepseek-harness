import { describe, expect, it } from 'vitest'
import { parseWorkspaceStoryboard } from '../src/workspace-storyboard.ts'

describe('Markdown video storyboard', () => {
  it('keeps Chinese shot details in document order and ignores overview tables and generation records', () => {
    const storyboard = [
      '# 晨间花市',
      '## 美术',
      '- 分辨率：720p',
      '- 画幅：9:16（竖屏）',
      '## 镜头',
      '| 镜号 | 时长 | 画面 |',
      '| --- | --- | --- |',
      '| 01 开场 | 5 秒 | 到达花市 |',
      '### 01 开场',
      '- 时长：5 秒',
      '- 画面：花市远景',
      '- 参考素材：无',
      '- 生成提示词：Track through the market, past white lilies and red tulips.',
      '### 第 2 镜头：特写',
      '- 时长：8秒',
      '- 画幅：1:1',
      '- 分辨率：480p',
      '- 画面：叶尖的露珠落下。',
      '## 生成记录',
      '| 镜号 | 结果文件 |',
      '| 02 | 未生成 |',
    ].join('\r\n')

    expect(parseWorkspaceStoryboard(storyboard)).toEqual({
      title: '晨间花市',
      shots: [
        {
          id: 'workspace-shot-1', title: '开场', duration: 5, aspectRatio: '9:16', resolution: '720p',
          prompt: 'Track through the market, past white lilies and red tulips.', assetIds: [], position: { x: 32, y: 32 },
        },
        {
          id: 'workspace-shot-2', title: '特写', duration: 8, aspectRatio: '1:1', resolution: '480p',
          prompt: '叶尖的露珠落下。', assetIds: [], position: { x: 380, y: 32 },
        },
      ],
    })
  })

  it('reads English shot fields and carries the original fenced prompt into the canvas', () => {
    const result = parseWorkspaceStoryboard([
      '# Sky Watch',
      '#### Shot #01 — Sunrise',
      '- **Duration:** 6 seconds',
      '- **Prompt**:',
      '```text',
      'A time-lapse: dawn breaks over the mountains.',
      'Retain the clouds and the distant birds.',
      '```',
    ].join('\n'))

    expect(result?.shots[0]).toMatchObject({
      id: 'workspace-shot-1', title: 'Sunrise', duration: 6, aspectRatio: '16:9', resolution: '480p',
      prompt: 'A time-lapse: dawn breaks over the mountains.\nRetain the clouds and the distant birds.',
    })
  })

  it.each([
    ['missing title', '### 1 Sunrise\n- Duration: 5s\n- Scene: Mist'],
    ['only an overview', '# Sunrise\n| Shot 1 | 5s | Mist |'],
    ['missing duration', '# Sunrise\n### Shot 1\n- Prompt: Mist'],
    ['unsupported duration', '# Sunrise\n### Shot 1\n- Duration: 16s\n- Prompt: Mist'],
    ['missing prompt and scene', '# Sunrise\n### Shot 1\n- Duration: 5s'],
    ['unsupported aspect ratio', '# Sunrise\n### Shot 1\n- Duration: 5s\n- Scene: Mist\n- Aspect ratio: 4:3'],
    ['unsupported resolution', '# Sunrise\n### Shot 1\n- Duration: 5s\n- Scene: Mist\n- Resolution: 1080p'],
    ['duplicate shot number', '# Sunrise\n### Shot 1\n- Duration: 5s\n- Scene: Mist\n### Shot 01\n- Duration: 2s\n- Scene: Hills'],
  ])('rejects %s', (_label, storyboard) => {
    expect(parseWorkspaceStoryboard(storyboard)).toBeNull()
  })
})
