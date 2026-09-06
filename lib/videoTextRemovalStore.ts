"use client";

import { create } from "zustand";
import type { TextRemovalJob } from "@/lib/videoTextRemoval";

export interface TextRemovalTarget {
  url?: string;
  title?: string;
  onUse?: (url: string) => void;
}

interface RemovalStore {
  open: boolean;
  target: TextRemovalTarget;
  selectedId: string | null;
  jobs: TextRemovalJob[];
  jobTargets: Record<string, TextRemovalTarget>;
  show: (target?: TextRemovalTarget) => void;
  close: () => void;
  select: (id: string) => void;
  updateJob: (job: TextRemovalJob) => void;
  dismiss: (id: string) => void;
  reset: () => void;
}

export const useVideoTextRemovalStore = create<RemovalStore>((set) => ({
  open: false, target: {}, selectedId: null, jobs: [], jobTargets: {},
  show: (target = {}) => set({ open: true, target, selectedId: null }),
  close: () => set({ open: false }),
  select: (selectedId) => set((state) => ({ open: true, selectedId, target: state.jobTargets[selectedId] ?? {} })),
  updateJob: (job) => set((state) => ({ jobs: state.jobs.some((entry) => entry.id === job.id)
    ? state.jobs.map((entry) => entry.id === job.id ? { ...entry, ...job, sourceUrl: job.sourceUrl ?? entry.sourceUrl } : entry)
    : [...state.jobs, job] })),
  dismiss: (id) => set((state) => {
    const jobTargets = { ...state.jobTargets };
    delete jobTargets[id];
    return { jobs: state.jobs.filter((job) => job.id !== id || job.status === "pending"), jobTargets };
  }),
  reset: () => set({ open: false, target: {}, selectedId: null, jobs: [], jobTargets: {} }),
}));

export const openVideoTextRemoval = (target?: TextRemovalTarget) => useVideoTextRemovalStore.getState().show(target);
