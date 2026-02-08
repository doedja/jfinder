import { writable } from 'svelte/store';

export interface SearchState {
  status: 'idle' | 'searching' | 'complete' | 'error';
  taskId: string | null;
  downloadUrl: string | null;
  metadataUrl: string | null;
  error: string | null;
}

const initial: SearchState = {
  status: 'idle',
  taskId: null,
  downloadUrl: null,
  metadataUrl: null,
  error: null
};

function createSearchStore() {
  const { subscribe, set, update } = writable<SearchState>(initial);

  return {
    subscribe,
    startSearch(taskId: string) {
      set({ status: 'searching', taskId, downloadUrl: null, metadataUrl: null, error: null });
    },
    complete(downloadUrl: string | null, metadataUrl: string | null) {
      update(s => ({ ...s, status: 'complete', downloadUrl, metadataUrl }));
    },
    fail(error: string) {
      update(s => ({ ...s, status: 'error', error }));
    },
    reset() {
      set(initial);
    }
  };
}

export const searchState = createSearchStore();
