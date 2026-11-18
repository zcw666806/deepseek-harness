/** Choose authorized live replies for automatic storyboard rendering. */
import type { AssistantMessage, Session, UserMessage } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { readStoryboard, storyboardPackage } from './storyboard.ts'
import type { ComicDraft } from './types.ts'

/** Storyboard instructions for workspace agents with an available image route. */
export const COMIC_STORYBOARD_PROMPT = [
  'When the human directly requests a finished comic, default to four panels if no count is given. For a four-panel comic, plan it in the final reply. The application uses that reply to draw supported requests and shows the artwork when it is ready.',
  'When the human asks to review or confirm a storyboard before drawing, present the storyboard and stop for their review. For instructions about making comics, answer the question normally.',
  'For a storyboard, use a title on a separate line in 《Title》, then a brief art direction line with consistent characters. Give exactly four headings: Panel 1, Panel 2, Panel 3, Panel 4. Under each heading use Scene:, Action:, and Dialogue: on separate lines. In Chinese, use 第一格、第二格、第三格、第四格 and 画面：、动作：、对白：. Write each heading on its own line and use None or 无 for silence. End with the fourth panel and report only the planning you performed.',
].join('\n')

const review = [
  /(?:先|提前)[^。！？\n]{0,18}(?:分镜|脚本|大纲)|(?:只|仅)[^。！？\n]{0,12}(?:分镜|脚本|大纲)/u,
  /(?:分镜|方案|草稿)[^。！？\n]{0,16}(?:先看|先给我看|让我看|给我看|待确认|确认后|我确认|过目|审核后)/u,
  /(?:等我|待我|让我|给我)(?:先|来)?(?:看看|过目|审核|确认)/u,
  /(?:不要|别|不用|无需|不必|不想|禁止)[^。！？\n]{0,18}(?:出图|画图|绘制|生成|画漫画|画一|画个|做漫画|做一|做个|成品)/u,
  /\b(?:storyboard|script|outline)\s+only\b/iu,
  /\b(?:only|just|first|review|approve|confirm)\b[^.!?\n]{0,45}\b(?:storyboard|script|outline)\b/iu,
  /\b(?:before|until)\b[^.!?\n]{0,40}\b(?:confirm|approve|review)\b/iu,
  /\b(?:do not|don.t|skip|hold off on)\b[^.!?\n]{0,24}\b(?:draw|generate|illustrate|render)\b/iu,
]
const instructions = [
  /(?:怎么|怎样|如何|步骤|教程|指南|教我|能否解释|说明一下|举例说明)[^。！？\n]{0,40}(?:画|绘制|创作|制作|生成|漫画)/u,
  /(?:画|绘制|创作|制作|生成)[^。！？\n]{0,35}(?:教程|提示词|流程|指南|方法)/u,
  /\b(?:how to|how do|how can|tutorial|guide|instructions|examples)\b[^.!?\n]{0,42}\b(?:comic|comic strip|draw|generate)\b/iu,
]
const chineseDraw = [
  /(?:^|[，。；：、！？\n]|请(?:帮我|为我|你)?|帮我|给我|为我|直接)[ \t]*(?:我?(?:想|要|希望)(?:请你|让你|你)?[ \t]*)?(?:画|绘制|创作|制作|生成|做|出|来)[^。！？\n]{0,90}(?:四格|漫画|连环画)/u,
  /把[^。！？\n]{0,70}(?:画成|做成|改编成)[^。！？\n]{0,20}(?:四格|漫画|连环画)/u,
]
const englishDraw = new RegExp([
  String.raw`(?:^|[.!?;:\n]|\b(?:please|can you|could you|would you|help me|i want (?:you )?to|i.d like (?:you )?to)\b)`,
  String.raw`\s*(?:draw|make|create|generate|illustrate|render)\b[^.!?\n]{0,90}\b(?:comic|comic strip)\b`,
].join(''), 'iu')

function explicitlyDrawsComic(text: string): boolean {
  const request = text.replace(/```[\s\S]*?(?:```|$)|`[^`\n]*`|“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|"[^"\n]*"|(?<!\p{L})'[^'\n]+'(?!\p{L})/gu, ' ')
    .replace(/^[ \t]*>[^\n]*/gmu, ' ').trim()
  return !review.some(pattern => pattern.test(request)) && !instructions.some(pattern => pattern.test(request))
    && (chineseDraw.some(pattern => pattern.test(request)) || englishDraw.test(request))
}

function messageText(message: AssistantMessage | UserMessage): string {
  return message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

/**
 * Resolve a new, successful turn's directly requested comic and its exact Assistant message.
 * @param session - Session that published the live closing event.
 * @param closing - Successful end of an appended turn.
 * @returns The editable draft, source identity and art direction, or undefined for review-only and other turns.
 */
export function automaticStoryboard(session: Session, closing: SessionEvent<'turn/end'>): {
  readonly messageId: AssistantMessage['id']
  readonly draft: ComicDraft
  readonly artDirection: string
} | undefined {
  if (closing.seq < session.firstLiveSeq || closing.data.reason.kind !== 'completed') return undefined
  const events = session.events
  let reply: AssistantMessage | undefined
  let request: UserMessage | undefined
  for (let seq = closing.seq - 1; seq >= session.firstLiveSeq; seq--) {
    const event = events[seq]
    if (event?.type === 'turn/start') {
      if (event.data.turn !== closing.data.turn || request === undefined || reply === undefined) return undefined
      const text = messageText(request)
      if (!explicitlyDrawsComic(text)) return undefined
      const storyboard = readStoryboard(messageText(reply))
      if (storyboard === null) return undefined
      const chinese = /\p{Script=Han}/u.test(text)
      const { draft } = storyboardPackage(storyboard, chinese ? '四格漫画' : 'Four-panel comic', chinese ? '原画' : 'Artwork', 520)
      return { messageId: reply.id, draft, artDirection: storyboard.artDirection }
    }
    if (event?.type === 'assistant/message' && event.data.turn === closing.data.turn && event.surfaceOp === 'append' && reply === undefined) {
      if (event.data.interrupted === true) return undefined
      reply = event.data.message
    }
    if (event?.type === 'user/message' && event.surfaceOp === 'append' && event.data.source.kind === 'user' && request === undefined) {
      if (reply === undefined) return undefined
      request = event.data
    }
  }
  return undefined
}
