<script lang="ts">
  import { mode, type AppMode } from '$lib/stores/mode';
  import { onMount } from 'svelte';

  let indicatorEl: HTMLDivElement;
  let toggleEl: HTMLDivElement;

  function updateIndicator() {
    if (!toggleEl || !indicatorEl) return;
    const activeOption = toggleEl.querySelector('.toggle-option.active') as HTMLElement;
    if (activeOption) {
      indicatorEl.style.width = `${activeOption.offsetWidth}px`;
      indicatorEl.style.transform = `translateX(${activeOption.offsetLeft - 4}px)`;
    }
  }

  function setMode(newMode: AppMode) {
    mode.set(newMode);
  }

  $effect(() => {
    // Re-run when $mode changes
    $mode;
    requestAnimationFrame(updateIndicator);
  });

  onMount(() => {
    updateIndicator();
    window.addEventListener('resize', updateIndicator);
    return () => window.removeEventListener('resize', updateIndicator);
  });
</script>

<div class="mode-toggle" bind:this={toggleEl}>
  <button
    class="toggle-option"
    class:active={$mode === 'download'}
    type="button"
    aria-pressed={$mode === 'download'}
    onclick={() => setMode('download')}
  >
    <span class="toggle-icon">↓</span>
    <span class="toggle-label">Paper Finder</span>
  </button>
  <button
    class="toggle-option"
    class:active={$mode === 'gap'}
    type="button"
    aria-pressed={$mode === 'gap'}
    onclick={() => setMode('gap')}
  >
    <span class="toggle-icon">◇</span>
    <span class="toggle-label">Gap Analysis</span>
  </button>
  <div class="toggle-indicator" class:gap-mode={$mode === 'gap'} bind:this={indicatorEl}></div>
</div>

<style>
  .mode-toggle {
    display: inline-flex;
    position: relative;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: 4px;
    gap: 0;
  }

  .toggle-option {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1.25rem;
    background: transparent;
    border: none;
    border-radius: calc(var(--radius-lg) - 4px);
    font-family: var(--font-body);
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: color 0.3s ease;
    white-space: nowrap;
  }

  .toggle-option:hover {
    color: var(--color-text);
  }

  .toggle-option.active {
    color: white;
  }

  .toggle-icon {
    font-size: 1rem;
    transition: transform 0.3s ease;
  }

  .toggle-option:hover .toggle-icon {
    transform: scale(1.1);
  }

  .toggle-indicator {
    position: absolute;
    top: 4px;
    left: 4px;
    height: calc(100% - 8px);
    border-radius: calc(var(--radius-lg) - 4px);
    background: var(--color-accent);
    transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1),
                background-color 0.4s ease,
                width 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    z-index: 0;
    width: calc(50% - 4px);
  }

  .toggle-indicator.gap-mode {
    background: var(--color-gap-accent);
  }

  @media (max-width: 480px) {
    .toggle-label {
      display: none;
    }

    .toggle-option {
      padding: 0.625rem 1rem;
    }

    .toggle-icon {
      font-size: 1.125rem;
    }
  }
</style>
