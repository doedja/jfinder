import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const SEARCH_KEY = 'jfinder_search_history';
const GAP_KEY = 'jfinder_gap_history';
const MAX_HISTORY = 10;

export interface SearchHistoryEntry {
  topic: string;
  papers: number;
  timestamp: number;
}

export interface GapHistoryEntry {
  topic: string;
  depth: string;
  papers: number;
  timestamp: number;
}

function loadHistory<T>(key: string): T[] {
  if (!browser) return [];
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch { return []; }
}

function saveHistory<T>(key: string, items: T[]) {
  if (browser) {
    localStorage.setItem(key, JSON.stringify(items.slice(0, MAX_HISTORY)));
  }
}

function createSearchHistoryStore() {
  const { subscribe, set, update } = writable<SearchHistoryEntry[]>(loadHistory(SEARCH_KEY));

  return {
    subscribe,
    add(entry: { topic: string; papers: number }) {
      update(items => {
        const filtered = items.filter(h => h.topic !== entry.topic);
        const next = [{ ...entry, timestamp: Date.now() }, ...filtered].slice(0, MAX_HISTORY);
        saveHistory(SEARCH_KEY, next);
        return next;
      });
    },
    remove(topic: string) {
      update(items => {
        const next = items.filter(h => h.topic !== topic);
        saveHistory(SEARCH_KEY, next);
        return next;
      });
    },
    clear() {
      if (browser) localStorage.removeItem(SEARCH_KEY);
      set([]);
    }
  };
}

function createGapHistoryStore() {
  const { subscribe, set, update } = writable<GapHistoryEntry[]>(loadHistory(GAP_KEY));

  return {
    subscribe,
    add(entry: { topic: string; depth: string; papers: number }) {
      update(items => {
        const filtered = items.filter(h => h.topic !== entry.topic);
        const next = [{ ...entry, timestamp: Date.now() }, ...filtered].slice(0, MAX_HISTORY);
        saveHistory(GAP_KEY, next);
        return next;
      });
    },
    remove(topic: string) {
      update(items => {
        const next = items.filter(h => h.topic !== topic);
        saveHistory(GAP_KEY, next);
        return next;
      });
    },
    clear() {
      if (browser) localStorage.removeItem(GAP_KEY);
      set([]);
    }
  };
}

export const searchHistory = createSearchHistoryStore();
export const gapHistory = createGapHistoryStore();
