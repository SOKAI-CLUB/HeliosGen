import type { Edge, Node } from "@xyflow/react";
import type { NodeData } from "./store";

/** Follow outgoing connections, including branches and intermediate text nodes. */
export function getDownstreamNodeIds(sourceId: string, edges: Edge[]): string[] {
  const visited = new Set([sourceId]);
  const queue = [sourceId];
  for (let i = 0; i < queue.length; i++) {
    for (const edge of edges) {
      if (edge.source !== queue[i] || visited.has(edge.target)) continue;
      visited.add(edge.target);
      queue.push(edge.target);
    }
  }
  return queue.slice(1);
}

export function isNodeBusy(node: Node<NodeData>): boolean {
  return node.data.status === "pending" || node.data.status === "running" ||
    !!node.data.pendingGenerate || !!node.data.pipelineStarting || !!node.data.pipelineQueued;
}

/** Keep previous takes in history, but never feed them to the next variation. */
export function invalidateOutputs(node: Node<NodeData>): Node<NodeData> {
  if (!["generateNode", "videoGeneratorNode", "assistantNode"].includes(node.type ?? "")) return node;
  const previous = node.type === "generateNode" ? node.data.imageUrl : node.data.videoUrl;
  const history = Array.isArray(node.data.generations) ? node.data.generations : [];
  const generations = previous && !history.includes(previous) ? [...history, previous] : history;
  return {
    ...node,
    data: {
      ...node.data, generations, status: "idle", errorMsg: undefined, hasError: false,
      imageUrl: undefined, r2Url: undefined, inputImage: undefined, videoUrl: undefined,
      outputText: undefined, taskId: undefined, imageNaturalRatio: undefined,
      capturedFrameUrl: undefined, eagerStartFrameUrl: undefined, eagerEndFrameUrl: undefined,
      videoDuration: undefined, trimmedVideoUrl: undefined, trimmedVideoSourceUrl: undefined,
      trimStart: undefined, trimEnd: undefined, trimReviewed: undefined,
      pendingGenerate: false, pipelineStarting: false, pipelineQueued: false,
    },
  };
}

export function getPipelineWaveStatus(nodes: Node<NodeData>[], ids: string[]): "waiting" | "done" | "error" {
  const wave = ids.map(id => nodes.find(node => node.id === id));
  if (wave.some(node => !node)) return "error";
  if (wave.some(node => node!.data.pendingGenerate || node!.data.pipelineStarting ||
    node!.data.status === "pending" || node!.data.status === "running")) return "waiting";
  return wave.every(node => node!.data.status === "done") ? "done" : "error";
}
