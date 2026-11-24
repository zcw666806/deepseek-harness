/** Native ComfyUI 0.43.0 media diagnostic, exercised by the managed-runtime e2e. */
import type { WorkflowStarterTemplate } from './types.ts'

/** Model-free black video; the prompt scalar is deliberately disconnected from image generation. */
export const diagnosticTemplates: readonly WorkflowStarterTemplate[] = [{
  category: 'diagnostic',
  workflow: {
    id: 'managed-native-black', title: 'Black-frame transport diagnostic (not AI generation)',
    template: {
      text: { class_type: 'PrimitiveString', inputs: { value: 'Model-free diagnostic; this text is not linked to image generation.' } },
      frames: { class_type: 'EmptyImage', inputs: { width: 480, height: 480, batch_size: 8, color: 0 } },
      video: { class_type: 'CreateVideo', inputs: { images: ['frames', 0], fps: 8 } },
      save: { class_type: 'SaveVideo', inputs: {
        video: ['video', 0], filename_prefix: 'diagnostic', format: 'mp4', 'format.codec': 'h264',
      } },
    },
    prompt: { node: 'text', input: 'value' },
    duration: { node: 'frames', input: 'batch_size', unit: 'frames', fps: 8 },
    width: { node: 'frames', input: 'width' }, height: { node: 'frames', input: 'height' },
    references: [], outputPrefix: { node: 'save', input: 'filename_prefix' }, durations: [1],
    sizes: [{ aspectRatio: '1:1', resolution: '480p', width: 480, height: 480 }],
    output: { node: 'save', key: 'images', index: 0 },
  },
}]
