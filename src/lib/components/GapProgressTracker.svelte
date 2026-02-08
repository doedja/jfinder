<script lang="ts">
  import { gapState } from '$lib/stores/gap';
  import { onDestroy } from 'svelte';

  let { taskId, topic }: { taskId: string; topic: string } = $props();

  let progress = $state(0);
  let currentPhase = $state('searching');
  let papersFound = $state<number | null>(null);
  let gapsIdentified = $state<number | null>(null);
  let directionsGenerated = $state<number | null>(null);
  let statusMessage = $state('Initializing analysis...');
  let status = $state<'active' | 'complete' | 'error'>('active');
  let errorMessage = $state('');

  let startTime = $state<number | null>(null);
  let elapsedDisplay = $state('0:00');
  let elapsedInterval: ReturnType<typeof setInterval> | null = null;
  let eventSource: EventSource | null = null;

  // Pulse states for stat cards
  let papersPulse = $state(false);
  let gapsPulse = $state(false);
  let directionsPulse = $state(false);

  const phases = ['searching', 'collecting', 'analyzing', 'comparing', 'generating', 'complete'];

  const phaseLabels: Record<string, string> = {
    searching: 'Finding Papers',
    collecting: 'Gathering Data',
    analyzing: 'Identifying Gaps',
    comparing: 'Comparing Methods',
    generating: 'Creating Insights',
    complete: 'Ready'
  };

  function getPhaseMessage(phase: string, data: any): string {
    const shortTopic = topic.length > 40 ? topic.slice(0, 40) + '...' : topic;
    switch (phase) {
      case 'searching': return `Searching academic databases for "${shortTopic}"...`;
      case 'collecting': return data.papersFound ? `Found ${data.papersFound} papers, collecting metadata...` : 'Collecting paper metadata...';
      case 'analyzing': return data.papersFound ? `Analyzing ${data.papersFound} papers for research gaps...` : 'Analyzing research landscape...';
      case 'comparing': return data.papersFound ? `Comparing methodologies across ${data.papersFound} studies...` : 'Comparing research methodologies...';
      case 'generating': return data.gapsIdentified ? `Generating recommendations based on ${data.gapsIdentified} identified gaps...` : 'Generating research recommendations...';
      case 'complete': {
        const gaps = data.gapsIdentified || 0;
        const dirs = data.directionsGenerated || 0;
        return `Analysis complete! Found ${gaps} gap${gaps !== 1 ? 's' : ''} and ${dirs} research direction${dirs !== 1 ? 's' : ''}.`;
      }
      default: return 'Processing...';
    }
  }

  function formatElapsed(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  function cleanup() {
    eventSource?.close();
    eventSource = null;
    if (elapsedInterval) {
      clearInterval(elapsedInterval);
      elapsedInterval = null;
    }
  }

  function handleRetry() {
    cleanup();
    gapState.reset();
  }

  $effect(() => {
    if (!taskId) return;

    cleanup();
    status = 'active';
    progress = 0;
    currentPhase = 'searching';
    papersFound = null;
    gapsIdentified = null;
    directionsGenerated = null;
    statusMessage = 'Initializing analysis...';
    startTime = Date.now();
    elapsedDisplay = '0:00';

    elapsedInterval = setInterval(() => {
      if (startTime) {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        elapsedDisplay = formatElapsed(elapsed);
      }
    }, 1000);

    eventSource = new EventSource(`/api/gap-progress/${taskId}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        progress = data.progress || 0;
        currentPhase = data.status || 'searching';
        statusMessage = getPhaseMessage(currentPhase, data);

        // Update stats with pulse
        if (data.papersFound != null && data.papersFound !== papersFound) {
          papersFound = data.papersFound;
          papersPulse = true;
          setTimeout(() => papersPulse = false, 500);
        }
        if (data.gapsIdentified != null && data.gapsIdentified !== gapsIdentified) {
          gapsIdentified = data.gapsIdentified;
          gapsPulse = true;
          setTimeout(() => gapsPulse = false, 500);
        }
        if (data.directionsGenerated != null && data.directionsGenerated !== directionsGenerated) {
          directionsGenerated = data.directionsGenerated;
          directionsPulse = true;
          setTimeout(() => directionsPulse = false, 500);
        }

        if (data.status === 'complete') {
          status = 'complete';
          if (elapsedInterval) {
            clearInterval(elapsedInterval);
            elapsedInterval = null;
          }
          if (startTime) {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            elapsedDisplay = `Completed in ${formatElapsed(elapsed)}`;
          }
          eventSource?.close();
          eventSource = null;

          setTimeout(() => {
            gapState.complete(
              `/api/gap-results/${taskId}`,
              `/api/gap-report/${taskId}`
            );
          }, 1500);
        }

        if (data.status === 'error') {
          status = 'error';
          errorMessage = data.error || 'Analysis failed. Please try again.';
          cleanup();
        }
      } catch (e) {
        console.error('Failed to parse progress data:', e);
      }
    };

    eventSource.onerror = () => {
      console.error('SSE connection error');
      cleanup();
    };

    return cleanup;
  });

  onDestroy(cleanup);

  // Ring calculations
  let circumference = 339.292; // 2 * π * 54
  let ringOffset = $derived(circumference - (progress / 100) * circumference);

  function getPhaseClass(phase: string): string {
    const currentIndex = phases.indexOf(currentPhase);
    const phaseIndex = phases.indexOf(phase);
    if (phaseIndex < currentIndex) return 'complete';
    if (phaseIndex === currentIndex) return 'active';
    return '';
  }

  function getLineClass(index: number): string {
    const currentIndex = phases.indexOf(currentPhase);
    return index < currentIndex ? 'complete' : '';
  }
</script>

<div class="gap-progress-container" class:active={true} class:complete={status === 'complete'} class:error={status === 'error'}>
  <div class="progress-header">
    <div class="progress-title-section">
      <span class="progress-symbol">◈</span>
      <div class="progress-titles">
        <h2 class="progress-title">Analyzing Research Gaps</h2>
        <p class="progress-topic">{topic}</p>
      </div>
    </div>
    <div class="progress-meta">
      <div class="elapsed-time" class:visible={startTime !== null}>
        <span class="elapsed-icon">⏱</span>
        <span class="elapsed-value">{elapsedDisplay}</span>
      </div>
      <div class="progress-badge">{phaseLabels[currentPhase] || 'Processing'}</div>
    </div>
  </div>

  <div class="progress-visualization">
    <div class="progress-ring-container">
      <svg class="progress-ring" viewBox="0 0 120 120">
        <circle class="progress-ring-bg" cx="60" cy="60" r="54" />
        <circle class="progress-ring-fill" cx="60" cy="60" r="54" style="stroke-dashoffset: {ringOffset}" />
      </svg>
      <div class="progress-ring-center">
        <span class="progress-percent">{progress}</span>
        <span class="progress-percent-sign">%</span>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card" class:updated={papersPulse}>
        <span class="stat-icon">▤</span>
        <div class="stat-content">
          <span class="stat-value">
            {#if papersFound !== null && papersFound > 0}
              {papersFound}
            {:else}
              <span class="stat-loading">Searching...</span>
            {/if}
          </span>
          <span class="stat-label">Papers Found</span>
        </div>
      </div>
      <div class="stat-card" class:updated={gapsPulse}>
        <span class="stat-icon">◇</span>
        <div class="stat-content">
          <span class="stat-value">
            {#if gapsIdentified !== null && gapsIdentified > 0}
              {gapsIdentified}
            {:else}
              <span class="stat-loading">Analyzing...</span>
            {/if}
          </span>
          <span class="stat-label">Gaps Identified</span>
        </div>
      </div>
      <div class="stat-card" class:updated={directionsPulse}>
        <span class="stat-icon">↗</span>
        <div class="stat-content">
          <span class="stat-value">
            {#if directionsGenerated !== null && directionsGenerated > 0}
              {directionsGenerated}
            {:else}
              <span class="stat-loading">Generating...</span>
            {/if}
          </span>
          <span class="stat-label">Directions</span>
        </div>
      </div>
    </div>
  </div>

  <div class="phase-timeline">
    {#each phases as phase, i}
      {#if i > 0}
        <div class="phase-line {getLineClass(i - 1)}"></div>
      {/if}
      <div class="phase-dot {getPhaseClass(phase)}"></div>
    {/each}
  </div>

  <p class="status-text">{statusMessage}</p>

  {#if status === 'error'}
    <div class="gap-error-view" style="display: flex;">
      <div class="error-display">
        <div class="error-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <h3 class="error-title">Analysis Failed</h3>
        <p class="error-message">{errorMessage}</p>
        <div class="error-actions">
          <button class="btn btn-primary" onclick={handleRetry}>
            <span class="btn-icon">↻</span>
            <span>Try Again</span>
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .gap-progress-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 2rem 1rem;
    position: relative;
    animation: fadeIn 0.5s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .progress-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    width: 100%;
    max-width: 600px;
    margin-bottom: 2.5rem;
    gap: 1rem;
  }

  .progress-title-section {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
  }

  .progress-symbol {
    font-size: 2rem;
    color: var(--color-gap-accent);
    animation: symbolPulse 2s ease-in-out infinite;
  }

  @keyframes symbolPulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.7; transform: scale(0.95); }
  }

  .progress-titles {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .progress-title {
    font-family: var(--font-display);
    font-size: 1.5rem;
    color: var(--color-gap-text);
    margin: 0;
  }

  .progress-topic {
    font-size: 0.9375rem;
    color: var(--color-gap-text-secondary);
    margin: 0;
    max-width: 280px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .progress-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.5rem;
  }

  .elapsed-time {
    display: none;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.8125rem;
    color: var(--color-gap-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .elapsed-time.visible {
    display: flex;
    animation: fadeIn 0.3s ease;
  }

  .elapsed-icon {
    font-size: 0.875rem;
  }

  .progress-badge {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: var(--color-gap-accent);
    padding: 0.375rem 0.875rem;
    background: rgba(43, 90, 74, 0.1);
    border-radius: 100px;
  }

  .progress-visualization {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2rem;
    margin-bottom: 2.5rem;
  }

  .progress-ring-container {
    position: relative;
    width: 160px;
    height: 160px;
  }

  .progress-ring {
    width: 100%;
    height: 100%;
    transform: rotate(-90deg);
  }

  .progress-ring-bg {
    fill: none;
    stroke: var(--color-gap-border);
    stroke-width: 8;
  }

  .progress-ring-fill {
    fill: none;
    stroke: var(--color-gap-accent);
    stroke-width: 8;
    stroke-linecap: round;
    stroke-dasharray: 339.292;
    transition: stroke-dashoffset 0.6s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .progress-ring-center {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .progress-percent {
    font-family: var(--font-display);
    font-size: 2.5rem;
    color: var(--color-gap-text);
    line-height: 1;
  }

  .progress-percent-sign {
    font-size: 1rem;
    color: var(--color-gap-text-secondary);
    margin-left: 1px;
  }

  .stats-grid {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    justify-content: center;
  }

  .stat-card {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.875rem 1.25rem;
    background: var(--color-gap-surface);
    border: 1px solid var(--color-gap-border);
    border-radius: var(--radius-lg);
    min-width: 140px;
    transition: all 0.3s ease;
  }

  .stat-card.updated {
    animation: statPulse 0.5s ease;
  }

  @keyframes statPulse {
    0% { transform: scale(1); }
    50% { transform: scale(1.02); border-color: var(--color-gap-accent); }
    100% { transform: scale(1); }
  }

  .stat-icon {
    font-size: 1.25rem;
    color: var(--color-gap-accent);
  }

  .stat-content {
    display: flex;
    flex-direction: column;
  }

  .stat-value {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--color-gap-text);
    line-height: 1;
    min-height: 1.25rem;
  }

  .stat-loading {
    font-size: 0.75rem;
    font-weight: 400;
    color: var(--color-gap-text-muted);
    animation: loadingPulse 1.5s ease-in-out infinite;
  }

  @keyframes loadingPulse {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 1; }
  }

  .stat-label {
    font-size: 0.6875rem;
    color: var(--color-gap-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .phase-timeline {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    width: 100%;
    max-width: 300px;
    margin: var(--space-md) 0;
  }

  .phase-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--color-gap-border);
    transition: all 0.3s ease;
    flex-shrink: 0;
  }

  .phase-dot.active {
    background: var(--color-gap-accent);
    transform: scale(1.3);
    box-shadow: 0 0 8px rgba(43, 90, 74, 0.4);
  }

  .phase-dot.complete {
    background: var(--color-gap-accent);
  }

  .phase-line {
    flex: 1;
    height: 2px;
    background: var(--color-gap-border);
    transition: background 0.3s ease;
  }

  .phase-line.complete {
    background: var(--color-gap-accent);
  }

  .status-text {
    font-size: 0.9375rem;
    color: var(--color-gap-text-secondary);
    text-align: center;
    line-height: 1.4;
    margin: 0;
  }

  .gap-progress-container.error .progress-ring-fill {
    stroke: var(--color-error);
  }

  .gap-progress-container.error .progress-badge {
    background: rgba(155, 68, 68, 0.1);
    color: var(--color-error);
  }

  .gap-progress-container.error .progress-symbol {
    animation: none;
    color: var(--color-error);
  }

  .gap-progress-container.complete .progress-symbol {
    animation: none;
  }

  .gap-progress-container.complete .elapsed-time {
    color: var(--color-gap-text-secondary);
  }

  .gap-error-view {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-gap-bg);
    z-index: 10;
  }

  .gap-error-view .error-display {
    text-align: center;
    padding: var(--space-xl);
  }

  .gap-error-view .error-icon {
    width: 64px;
    height: 64px;
    margin: 0 auto var(--space-lg);
    color: var(--color-error);
  }

  .gap-error-view .error-icon svg {
    width: 100%;
    height: 100%;
  }

  .gap-error-view .error-title {
    font-family: var(--font-display);
    font-size: 1.5rem;
    color: var(--color-error);
    margin-bottom: var(--space-sm);
  }

  .gap-error-view .error-message {
    color: var(--color-gap-text-secondary);
    margin-bottom: var(--space-lg);
    max-width: 400px;
    margin-left: auto;
    margin-right: auto;
  }

  .gap-error-view .error-actions {
    display: flex;
    justify-content: center;
    gap: var(--space-md);
  }

  @media (max-width: 640px) {
    .progress-header {
      flex-direction: column;
      gap: 1rem;
    }

    .progress-meta {
      flex-direction: row;
      align-items: center;
      width: 100%;
      justify-content: space-between;
    }

    .stats-grid {
      flex-direction: column;
      width: 100%;
    }

    .stat-card {
      width: 100%;
    }

    .phase-timeline {
      max-width: 250px;
    }
  }
</style>
