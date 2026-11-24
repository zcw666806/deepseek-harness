/** Combine a human brief with its document workflow in the recorded prompt. */

/**
 * Prepare the text of a creation-mode message for the existing submission pipeline.
 * @param instructions - localized project workflow for the active creation mode.
 * @param text - text from the composer, which may be empty for an attachment-only brief.
 * @returns The complete user message text delivered to the Agent.
 */
export function projectCreationPrompt(instructions: string, text: string): string {
  return text === '' ? instructions : `${text}\n\n${instructions}`
}
