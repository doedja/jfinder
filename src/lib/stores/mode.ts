import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export type AppMode = 'download' | 'gap';

function createModeStore() {
  let initial: AppMode = 'download';
  if (browser) {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'gap') initial = 'gap';
  }

  const { subscribe, set } = writable<AppMode>(initial);

  return {
    subscribe,
    set(mode: AppMode) {
      if (browser) {
        const url = new URL(window.location.href);
        url.searchParams.set('mode', mode);
        window.history.replaceState({}, '', url.toString());
      }
      set(mode);
    }
  };
}

export const mode = createModeStore();
