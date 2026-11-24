/** Workflow save authority and stale request cancellation. */
import { describe, expect, it, vi } from 'vitest'
import type { WorkflowConfigurationView } from '@deepseek-ai/dsh-video-comfyui/types'
import { WorkflowController } from '../src/client/workflow-controller.ts'

const view: WorkflowConfigurationView = { revision: 4, enabled: false, hasHeaders: true, templates: [], configuration: { baseURL: 'http://localhost:8188', workflows: [] } }
function remote() {
  return { view: vi.fn(async () => view), validate: vi.fn(async () => ({ valid: true as const })),
    save: vi.fn(async () => ({ ...view, revision: 5 })), setEnabled: vi.fn(async () => ({ ...view, revision: 6, enabled: true })) }
}
describe('workflow settings controller', () => {
  it('saves against the displayed revision and requires a separate enable action', async () => {
    const host = remote()
    const controller = new WorkflowController(host)
    const face = controller.inject()
    face.loadWorkflows()
    await vi.waitFor(() => { expect(face.hooks.workflows.getSnapshot().busy).toBe(false) })
    face.saveWorkflows(view.configuration)
    await vi.waitFor(() => { expect(face.hooks.workflows.getSnapshot().view?.revision).toBe(5) })
    expect(host.save).toHaveBeenCalledWith(view.configuration, 4, expect.any(AbortSignal))
    expect(host.setEnabled).not.toHaveBeenCalled()
    face.enableWorkflows(true)
    await vi.waitFor(() => { expect(face.hooks.workflows.getSnapshot().view?.enabled).toBe(true) })
    expect(host.setEnabled).toHaveBeenCalledWith(true, 5, expect.any(AbortSignal))
    await controller.dispose()
  })
  it('preserves the previous report when validation fails', async () => {
    const host = remote()
    host.validate.mockRejectedValueOnce(new Error('Missing mapped node'))
    const controller = new WorkflowController(host)
    const face = controller.inject()
    face.loadWorkflows()
    await vi.waitFor(() => { expect(face.hooks.workflows.getSnapshot().view).toBe(view) })
    face.validateWorkflows(view.configuration)
    await vi.waitFor(() => { expect(face.hooks.workflows.getSnapshot().error).toBe('Missing mapped node') })
    expect(face.hooks.workflows.getSnapshot().view).toBe(view)
    expect(host.save).not.toHaveBeenCalled()
    await controller.dispose()
  })
  it('waits for cancellation and rejects reports from replaced connections', async () => {
    const old = Promise.withResolvers<WorkflowConfigurationView>()
    const host = remote()
    host.view.mockImplementationOnce(() => old.promise)
    const controller = new WorkflowController(host)
    const face = controller.inject()
    face.loadWorkflows()
    controller.reset()
    face.loadWorkflows()
    await vi.waitFor(() => { expect(face.hooks.workflows.getSnapshot().view).toBe(view) })
    const finished = vi.fn()
    const disposing = controller.dispose().then(finished)
    expect(finished).not.toHaveBeenCalled()
    old.resolve({ ...view, revision: 1 })
    await disposing
    expect(face.hooks.workflows.getSnapshot().view).toBe(view)
    expect(finished).toHaveBeenCalledOnce()
    face.loadWorkflows()
    expect(host.view).toHaveBeenCalledTimes(2)
  })
})
