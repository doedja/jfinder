<script lang="ts">
  import { searchState } from '$lib/stores/search';
  import { onDestroy } from 'svelte';

  let { taskId }: { taskId: string } = $props();

  let progress = $state(0);
  let message = $state('Connecting...');
  let currentCycle = $state(0);
  let totalCycles = $state(0);
  let papersFound = $state(0);
  let papersDownloaded = $state(0);
  let status = $state<'progress' | 'complete' | 'error'>('progress');
  let errorMessage = $state('');
  let eventSource: EventSource | null = null;

  let lastPapersFound = 0;
  let lastPapersDownloaded = 0;
  let papersFoundPulse = $state(false);
  let papersDownloadedPulse = $state(false);

  function cleanup() {
    eventSource?.close();
    eventSource = null;
  }

  function handleRetry() {
    cleanup();
    searchState.reset();
  }

  $effect(() => {
    if (!taskId) return;

    cleanup();

    eventSource = new EventSource(`/api/progress/${taskId}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.error) {
          status = 'error';
          errorMessage = data.error;
          cleanup();
          return;
        }

        progress = data.progress;
        message = data.message;
        currentCycle = data.currentCycle || 0;
        totalCycles = data.totalCycles || 0;

        const newPapersFound = parseInt(data.papersFound) || 0;
        const newPapersDownloaded = parseInt(data.papersDownloaded) || 0;

        if (newPapersFound !== lastPapersFound) {
          papersFound = newPapersFound;
          papersFoundPulse = true;
          setTimeout(() => papersFoundPulse = false, 500);
          lastPapersFound = newPapersFound;
        }

        if (newPapersDownloaded !== lastPapersDownloaded) {
          papersDownloaded = newPapersDownloaded;
          papersDownloadedPulse = true;
          setTimeout(() => papersDownloadedPulse = false, 500);
          lastPapersDownloaded = newPapersDownloaded;
        }

        if (data.status === 'complete') {
          status = 'complete';
          cleanup();
          searchState.complete(data.downloadUrl, data.metadataUrl);
        }

        if (data.status === 'error') {
          status = 'error';
          errorMessage = data.error || 'An error occurred';
          cleanup();
        }
      } catch (e) {
        console.error('Failed to parse progress data:', e);
      }
    };

    eventSource.onerror = () => {
      status = 'error';
      errorMessage = 'Connection lost. Please try again.';
      cleanup();
    };

    return cleanup;
  });

  onDestroy(cleanup);
</script>

<section class="progress-section" class:complete={status === 'complete'} class:error={status === 'error'}>
  {#if status === 'error'}
    <div class="error-view">
      <div class="error-display">
        <div class="error-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <h3 class="error-title">Something went wrong</h3>
        <p class="error-message">{errorMessage}</p>
        <button class="btn btn-primary" onclick={handleRetry}>Try Again</button>
      </div>
    </div>
  {:else}
    <div class="progress-view">
      <h3 class="progress-title">Search in Progress</h3>

      <div class="progress-hero">
        <div class="progress-bar-wrapper">
          <div class="progress-bar" style="width: {progress}%"></div>
        </div>
        <span class="progress-percent">{progress}%</span>
      </div>

      <p class="progress-message">{message}</p>
      <p class="progress-cycle">Cycle {currentCycle} of {totalCycles}</p>

      <div class="progress-stats">
        <span class="stat-item"><span class="stat-value" class:updated={papersFoundPulse}>{papersFound}</span> found</span>
        <span class="stat-dot">&middot;</span>
        <span class="stat-item"><span class="stat-value" class:updated={papersDownloadedPulse}>{papersDownloaded}</span> downloaded</span>
      </div>
    </div>
  {/if}
</section>

<style>
  .progress-section {
    padding: var(--space-lg) var(--space-md);
    background: var(--color-surface);
    border-radius: var(--radius-lg);
    box-shadow: 0 1px 3px rgba(26, 24, 20, 0.04);
    text-align: center;
  }

  .progress-view {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-sm);
  }

  .progress-title {
    font-family: var(--font-display);
    font-size: 1.25rem;
    font-weight: 400;
    color: var(--color-text);
    margin: 0;
  }

  .progress-hero {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    width: 100%;
    max-width: 350px;
  }

  .progress-bar-wrapper {
    flex: 1;
    height: 8px;
    background: var(--color-bg-warm);
    border-radius: 4px;
    overflow: hidden;
  }

  .progress-bar {
    height: 100%;
    background: var(--color-accent);
    border-radius: 4px;
    transition: width 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    position: relative;
  }

  .progress-bar::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
    animation: shimmer 2s infinite;
  }

  @keyframes shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }

  .progress-percent {
    font-family: var(--font-display);
    font-size: 1.125rem;
    color: var(--color-accent);
    min-width: 3rem;
    text-align: right;
  }

  .progress-message {
    font-size: 0.9375rem;
    color: var(--color-text);
    margin: 0;
  }

  .progress-cycle {
    font-size: 0.8125rem;
    color: var(--color-text-muted);
    margin: 0;
  }

  .progress-stats {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    margin-top: var(--space-xs);
    padding-top: var(--space-sm);
    border-top: 1px solid var(--color-border-light);
  }

  .stat-item {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }

  .stat-value {
    font-weight: 600;
    color: var(--color-text);
    transition: color 0.3s ease;
  }

  .stat-value.updated {
    color: var(--color-accent);
  }

  .stat-dot {
    color: var(--color-text-muted);
    font-size: 0.625rem;
  }

  .progress-section.complete .progress-bar::after {
    animation: none;
    opacity: 0;
  }

  .progress-section.complete .progress-message {
    color: var(--color-success);
  }

  .progress-section.error .progress-bar {
    background: var(--color-error);
  }

  .error-view {
    padding: var(--space-sm) 0;
  }

  .error-view .error-display {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-sm);
  }

  .error-view .error-icon {
    width: 40px;
    height: 40px;
    color: var(--color-error);
  }

  .error-view .error-icon svg {
    width: 100%;
    height: 100%;
  }

  .error-view .error-title {
    font-family: var(--font-display);
    font-size: 1.25rem;
    color: var(--color-text);
    margin: 0;
  }

  .error-view .error-message {
    font-size: 0.9375rem;
    color: var(--color-text-secondary);
    margin: 0;
    max-width: 300px;
  }

  @media (max-width: 480px) {
    .progress-hero {
      flex-direction: column;
      gap: var(--space-sm);
    }

    .progress-percent {
      text-align: center;
    }

    .progress-stats {
      flex-direction: column;
      gap: var(--space-xs);
    }

    .stat-dot {
      display: none;
    }
  }
</style>
