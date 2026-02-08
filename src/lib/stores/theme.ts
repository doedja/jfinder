import { writable } from 'svelte/store';
import { browser } from '$app/environment';

function createThemeStore() {
  const { subscribe, set, update } = writable<'light' | 'dark'>('light');

  if (browser) {
    const saved = localStorage.getItem('jfinder-theme');
    if (saved === 'dark' || saved === 'light') {
      set(saved);
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      set(prefersDark ? 'dark' : 'light');
    }
  }

  return {
    subscribe,
    toggle() {
      update(current => {
        const next = current === 'dark' ? 'light' : 'dark';
        if (browser) {
          document.documentElement.classList.add('no-transition');
          if (next === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
          } else {
            document.documentElement.removeAttribute('data-theme');
          }
          localStorage.setItem('jfinder-theme', next);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              document.documentElement.classList.remove('no-transition');
            });
          });
        }
        return next;
      });
    },
    set(value: 'light' | 'dark') {
      if (browser) {
        if (value === 'dark') {
          document.documentElement.setAttribute('data-theme', 'dark');
        } else {
          document.documentElement.removeAttribute('data-theme');
        }
        localStorage.setItem('jfinder-theme', value);
      }
      set(value);
    }
  };
}

export const theme = createThemeStore();
