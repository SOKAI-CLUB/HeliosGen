import { useState, useEffect, useCallback, useRef } from "react";
import { useWorkflowStore } from "./store";
import { buildPipelineWaves } from "./executor";
import { getPipelineWaveStatus, isNodeBusy } from "./workflowGraph";

interface PipelineState {
  spaceId: string;
  waves: string[][];
  waveIdx: number;
  waveStarted: boolean;
}

export function usePipelineRunner(scopeNodeIds?: string[]) {
  const nodes = useWorkflowStore(s => s.nodes);
  const activeSpaceId = useWorkflowStore(s => s.activeSpaceId);
  const [pipeline, setPipeline] = useState<PipelineState | null>(null);
  const scopeRef = useRef(scopeNodeIds);
  useEffect(() => { scopeRef.current = scopeNodeIds; }, [scopeNodeIds]);
  const ownedRun = useRef<PipelineState | null>(null);

  const scopedNodes = scopeNodeIds ? nodes.filter(n => scopeNodeIds.includes(n.id)) : nodes;
  const genNodeCount = scopedNodes.filter(n => n.type === "generateNode" || n.type === "videoGeneratorNode").length;

  const finish = useCallback((failed = false) => {
    const run = ownedRun.current;
    if (!run) return;
    ownedRun.current = null;
    const store = useWorkflowStore.getState();
    if (store.activeSpaceId === run.spaceId) {
      for (const id of run.waves.flat()) {
        store.updateNodeData(id, { pipelineQueued: false, pendingGenerate: false });
      }
      if (failed) store.addToast("Workflow interrompu : une étape a échoué ou a été annulée. Corrigez-la puis relancez.", "error");
    } else {
      const ids = new Set(run.waves.flat());
      useWorkflowStore.setState(s => ({ spaces: s.spaces.map(space => space.id === run.spaceId ? {
        ...space, nodes: space.nodes.map(node => ids.has(node.id) ? {
          ...node, data: { ...node.data, pipelineQueued: false, pendingGenerate: false, pipelineStarting: false },
        } : node),
      } : space) }));
    }
    store.setIsRunning(false);
    setPipeline(null);
  }, []);

  const run = useCallback(() => {
    const store = useWorkflowStore.getState();
    if (store.isRunning || ownedRun.current || store.nodes.some(isNodeBusy)) return;
    const scope = scopeRef.current;
    const filtered = scope ? store.nodes.filter(n => scope.includes(n.id)) : store.nodes;
    const waves = buildPipelineWaves(filtered, store.edges);
    const count = filtered.filter(n => n.type === "generateNode" || n.type === "videoGeneratorNode").length;
    if (waves.flat().length !== count) {
      store.addToast("Le workflow contient une boucle. Retirez la connexion circulaire avant de relancer.", "error");
      return;
    }
    if (!waves.length) return;
    const next = { spaceId: store.activeSpaceId, waves, waveIdx: 0, waveStarted: false };
    ownedRun.current = next;
    store.setIsRunning(true);
    for (const id of waves.flat()) store.updateNodeData(id, { pipelineQueued: true });
    setPipeline(next);
  }, []);

  useEffect(() => () => finish(), [finish]);

  useEffect(() => {
    if (!pipeline) return;
    if (activeSpaceId !== pipeline.spaceId) { finish(); return; }
    const { waves, waveIdx, waveStarted } = pipeline;
    const currentWave = waves[waveIdx];
    if (!waveStarted) {
      const store = useWorkflowStore.getState();
      for (const id of currentWave) {
        store.updateNodeData(id, { pendingGenerate: true, pipelineQueued: false, status: "idle", errorMsg: undefined, hasError: false });
      }
      // Advance this controller after dispatching a wave to the external store.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPipeline(p => p ? { ...p, waveStarted: true } : null);
      return;
    }
    const status = getPipelineWaveStatus(nodes, currentWave);
    if (status === "waiting") return;
    if (status === "error") { finish(true); return; }
    if (waveIdx + 1 === waves.length) { finish(); return; }
    setPipeline({ ...pipeline, waveIdx: waveIdx + 1, waveStarted: false });
  }, [nodes, activeSpaceId, pipeline, finish]);

  return { run, isRunning: pipeline !== null, genNodeCount };
}
