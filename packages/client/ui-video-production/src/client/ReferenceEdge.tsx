/** Reference-image connections route below their shot's measured prompt card. */
import { BaseEdge, useInternalNode, type EdgeProps } from '@xyflow/react'
import type { VideoShotId } from '@deepseek-ai/dsh-video-production/types'
import { workflowNodeId } from './workflow-graph.ts'

interface ReferenceEdgeProps extends EdgeProps {
  data: { shotId: VideoShotId }
}

/** Current canvas-space bounds of the prompt that an image connection must pass. */
export interface ReferenceObstacle { x: number; y: number; width: number; height: number }

/**
 * Route the reference around the prompt's lower corners in the default left-to-right layout.
 * @param endpoints - current source and target handle coordinates.
 * @param prompt - measured prompt bounds, including its current dragged position.
 * @returns the SVG path and label position in the clear lane below the prompt.
 */
export function referenceLanePath(
  endpoints: Pick<EdgeProps, 'sourceX' | 'sourceY' | 'targetX' | 'targetY'>, prompt: ReferenceObstacle,
): { path: string; labelX: number; labelY: number } {
  const { sourceX, sourceY, targetX, targetY } = endpoints
  const left = Math.min(sourceX + 16, prompt.x - 16)
  const right = Math.max(targetX - 16, prompt.x + prompt.width + 16)
  const lane = prompt.y + prompt.height + 16
  return {
    path: `M ${sourceX},${sourceY} C ${left},${sourceY} ${left},${lane} ${left},${lane}`
      + ` L ${right},${lane} C ${right},${lane} ${right},${targetY} ${targetX},${targetY}`,
    labelX: (left + right) / 2, labelY: lane,
  }
}

/**
 * Keep reference connections visible around the associated prompt while retaining standard edge interactions.
 * @param props - ReactFlow handle positions, labels and reference metadata.
 * @returns an interactive reference path once the prompt has canvas dimensions.
 */
export function ReferenceEdge(props: ReferenceEdgeProps) {
  const prompt = useInternalNode(workflowNodeId('prompt', props.data.shotId))
  const width = prompt?.measured.width ?? prompt?.width ?? prompt?.initialWidth
  const height = prompt?.measured.height ?? prompt?.height ?? prompt?.initialHeight
  if (prompt === undefined || width === undefined || height === undefined) return null
  const lane = referenceLanePath(props, { ...prompt.internals.positionAbsolute, width, height })
  return <BaseEdge
    id={props.id} path={lane.path} labelX={lane.labelX} labelY={lane.labelY}
    label={props.label}
    {...props.style === undefined ? {} : { style: props.style }}
    {...props.markerStart === undefined ? {} : { markerStart: props.markerStart }}
    {...props.markerEnd === undefined ? {} : { markerEnd: props.markerEnd }}
    {...props.labelStyle === undefined ? {} : { labelStyle: props.labelStyle }}
    {...props.labelShowBg === undefined ? {} : { labelShowBg: props.labelShowBg }}
    {...props.labelBgStyle === undefined ? {} : { labelBgStyle: props.labelBgStyle }}
    {...props.labelBgPadding === undefined ? {} : { labelBgPadding: props.labelBgPadding }}
    {...props.labelBgBorderRadius === undefined ? {} : { labelBgBorderRadius: props.labelBgBorderRadius }}
    {...props.interactionWidth === undefined ? {} : { interactionWidth: props.interactionWidth }}
  />
}
