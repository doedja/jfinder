import { writable } from 'svelte/store';

export interface GapState {
  status: 'idle' | 'analyzing' | 'complete' | 'error';
  taskId: string | null;
  topic: string | null;
  resultUrl: string | null;
  reportUrl: string | null;
  error: string | null;
}

const initial: GapState = {
  status: 'idle',
  taskId: null,
  topic: null,
  resultUrl: null,
  reportUrl: null,
  error: null
};

function createGapStore() {
  const { subscribe, set, update } = writable<GapState>(initial);

  return {
    subscribe,
    startAnalysis(taskId: string, topic: string) {
      set({ status: 'analyzing', taskId, topic, resultUrl: null, reportUrl: null, error: null });
    },
    complete(resultUrl: string, reportUrl: string) {
      update(s => ({ ...s, status: 'complete', resultUrl, reportUrl }));
    },
    fail(error: string) {
      update(s => ({ ...s, status: 'error', error }));
    },
    reset() {
      set(initial);
    }
  };
}

export const gapState = createGapStore();
