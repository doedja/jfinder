<script lang="ts">
  import { searchState } from '$lib/stores/search';

  let { taskId }: { taskId: string } = $props();

  let loading = $state(true);
  let paperCount = $state(0);
  let metadataText = $state('');
  let detailsExpanded = $state(false);
  let papers = $state<{ filename: string; name: string }[]>([]);

  let downloadUrl = $derived($searchState.downloadUrl);
  let metadataUrl = $derived($searchState.metadataUrl);

  $effect(() => {
    if (!taskId) return;
    loadResults();
  });

  async function loadResults() {
    loading = true;

    const [metadataResult, papersResult] = await Promise.allSettled([
      fetch(`/api/metadata/${taskId}`).then(async r => {
        if (r.ok) {
          const text = await r.text();
          metadataText = text;
          const lines = text.split('\n');
          for (const line of lines) {
            if (line.toLowerCase().includes('downloaded:') || line.toLowerCase().includes('papers:')) {
              const match = line.match(/(\d+)/);
              if (match) {
                paperCount = parseInt(match[1]);
                break;
              }
            }
          }
        }
      }),
      fetch(`/api/papers/${taskId}`).then(async r => {
        if (r.ok) {
          papers = await r.json();
        }
      })
    ]);

    if (metadataResult.status === 'rejected') {
      metadataText = 'Failed to load metadata';
    }

    loading = false;
  }

  function toggleDetails() {
    detailsExpanded = !detailsExpanded;
  }

  function handleNewSearch() {
    searchState.reset();
  }
</script>

<section class="results-section">
  {#if loading}
    <div class="loading-overlay">
      <span class="spinner spinner-lg"></span>
      <span>Preparing your files...</span>
    </div>
  {:else}
    <div class="results-inner">
      <div class="success-hero">
        <div class="success-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M8 12l2.5 2.5L16 9"/>
          </svg>
        </div>
        <h2 class="success-title">{paperCount} Papers Ready</h2>
      </div>

      <div class="primary-action">
        {#if downloadUrl}
          <a href={downloadUrl} class="btn btn-primary btn-large">
            Download All (ZIP)
          </a>
        {/if}
      </div>

      <div class="secondary-actions">
        {#if metadataUrl}
          <a href={metadataUrl} class="text-link">
            Download metadata only
          </a>
        {/if}
        <button class="text-link" onclick={toggleDetails}>
          {detailsExpanded ? 'Hide details' : 'View details'}
        </button>
      </div>

      {#if papers.length > 0}
        <div class="paper-list">
          <h3 class="paper-list-title">Downloaded Papers</h3>
          <div class="paper-list-items">
            {#each papers as paper}
              <div class="paper-item">
                <svg class="paper-item-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM14 3.5L18.5 8H14V3.5zM6 20V4h7v5h5v11H6z"/></svg>
                <span class="paper-item-name" title={paper.name}>{paper.name}</span>
                <a class="paper-item-preview" href="/api/preview/{taskId}/{encodeURIComponent(paper.filename)}" target="_blank" rel="noopener">Preview</a>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <div class="details-panel" class:expanded={detailsExpanded}>
        <pre class="metadata-content">{metadataText}</pre>
      </div>

      <button class="new-search-link" onclick={handleNewSearch}>
        &larr; Start new search
      </button>
    </div>
  {/if}
</section>

<style>
  .results-section {
    padding: var(--space-lg) var(--space-md);
    background: var(--color-surface);
    border-radius: var(--radius-lg);
    box-shadow: 0 1px 3px rgba(26, 24, 20, 0.04);
    text-align: center;
  }

  .results-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-md);
  }

  .success-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-sm);
  }

  .success-icon {
    width: 44px;
    height: 44px;
    color: var(--color-success);
  }

  .success-icon svg {
    width: 100%;
    height: 100%;
  }

  .success-title {
    font-family: var(--font-display);
    font-size: 1.5rem;
    font-weight: 400;
    color: var(--color-text);
    margin: 0;
  }

  .primary-action {
    width: 100%;
    max-width: 280px;
  }

  .btn-large {
    width: 100%;
    padding: var(--space-sm) var(--space-lg);
    font-size: 0.9375rem;
  }

  .secondary-actions {
    display: flex;
    gap: var(--space-md);
  }

  .text-link {
    font-family: var(--font-body);
    font-size: 0.8125rem;
    color: var(--color-text-muted);
    background: none;
    border: none;
    cursor: pointer;
    transition: color var(--transition-fast);
    text-decoration: none;
  }

  .text-link:hover {
    color: var(--color-accent);
  }

  .paper-list {
    width: 100%;
    max-width: 500px;
    text-align: left;
  }

  .paper-list-title {
    font-family: var(--font-display);
    font-size: 1rem;
    color: var(--color-text);
    margin-bottom: var(--space-sm);
    text-align: center;
  }

  .paper-list-items {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    max-height: 300px;
    overflow-y: auto;
  }

  .paper-item {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: 0.5rem 0.75rem;
    background: var(--color-bg);
    border: 1px solid var(--color-border-light);
    border-radius: var(--radius-sm);
    font-size: 0.8125rem;
    transition: all 0.15s ease;
  }

  .paper-item:hover {
    border-color: var(--color-border);
    background: var(--color-bg-warm);
  }

  .paper-item-icon {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    color: var(--color-error);
    opacity: 0.7;
  }

  .paper-item-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-secondary);
  }

  .paper-item-preview {
    flex-shrink: 0;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-accent);
    text-decoration: none;
    padding: 0.25rem 0.5rem;
    border-radius: var(--radius-sm);
    transition: all 0.15s ease;
  }

  .paper-item-preview:hover {
    background: var(--color-bg-warm);
    color: var(--color-accent-dark);
  }

  .details-panel {
    width: 100%;
    max-width: 450px;
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.3s ease, padding 0.3s ease;
  }

  .details-panel.expanded {
    max-height: 250px;
    padding-top: var(--space-sm);
  }

  .metadata-content {
    text-align: left;
    padding: var(--space-sm);
    background: var(--color-bg);
    border-radius: var(--radius-md);
    font-family: var(--font-body);
    font-size: 0.75rem;
    line-height: 1.5;
    color: var(--color-text-secondary);
    white-space: pre-wrap;
    word-wrap: break-word;
    max-height: 200px;
    overflow-y: auto;
    margin: 0;
  }

  .new-search-link {
    margin-top: var(--space-xs);
    padding-top: var(--space-sm);
    border-top: 1px solid var(--color-border-light);
    width: 100%;
    font-family: var(--font-body);
    font-size: 0.8125rem;
    color: var(--color-text-muted);
    background: none;
    border-left: none;
    border-right: none;
    border-bottom: none;
    cursor: pointer;
    transition: color var(--transition-fast);
  }

  .new-search-link:hover {
    color: var(--color-accent);
  }

  .results-section :global(.loading-overlay) {
    min-height: 150px;
  }

  @media (max-width: 480px) {
    .secondary-actions {
      flex-direction: column;
      gap: var(--space-sm);
    }
  }
</style>
