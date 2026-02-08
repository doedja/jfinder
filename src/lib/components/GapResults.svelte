<script lang="ts">
  import { gapState } from '$lib/stores/gap';
  import { onDestroy } from 'svelte';

  let { taskId, topic }: { taskId: string; topic: string } = $props();

  // Tab state
  let activeTab = $state<'gaps' | 'comparisons' | 'directions' | 'trends'>('gaps');

  // Results data
  let currentResults = $state<any>(null);
  let currentParams = $state<any>(null);
  let reportUrl = $state<string | null>(null);
  let allGaps = $state<any[]>([]);
  let filteredGaps = $state<any[]>([]);
  let loading = $state(true);
  let loadError = $state(false);

  // Filter state
  let filterSeverity = $state('all');
  let filterSort = $state('priority');

  // Modal state
  let showRefineModal = $state(false);
  let showDownloadModal = $state(false);
  let showRelatedPapersModal = $state(false);

  // Refine modal options
  let refineMorePapers = $state(false);
  let refineDeep = $state(false);
  let refineYear = $state(false);
  let refineYearInput = $state('');

  // Download progress state
  let dlProgress = $state(0);
  let dlMessage = $state('Preparing download...');
  let dlDetail = $state('');
  let dlComplete = $state(false);
  let dlDownloadUrl = $state('');
  let dlEventSource: EventSource | null = null;

  // Related papers state
  let relatedPapersTitle = $state('Related Papers');
  let relatedPapersLoading = $state(false);
  let relatedPapersData = $state<{ citedBy: any[]; references: any[] } | null>(null);
  let relatedPapersError = $state('');

  // Collapsible sections state
  let expandedApproaches = $state<Set<string>>(new Set());
  let expandedRelatedPapers = $state<Set<string>>(new Set());

  // Priority scoring algorithm
  function calculatePriority(gap: any): number {
    const severityScore = gap.severity === 'high' ? 3 : gap.severity === 'medium' ? 2 : 1;
    const paperScore = Math.min((gap.evidence?.paperCount || 0) / 10, 3);
    const noveltyScore = gap.type === 'under-researched-topic' ? 2 : 1;
    return severityScore * 2 + paperScore + noveltyScore;
  }

  function prioritizeGaps(gaps: any[]): any[] {
    return gaps
      .map(gap => ({ ...gap, priority: calculatePriority(gap) }))
      .sort((a, b) => b.priority - a.priority);
  }

  // Derived values
  let summaryPapers = $derived(currentResults?.papers?.length || 0);
  let summaryGaps = $derived(currentResults?.gaps?.length || 0);
  let summaryDirections = $derived(currentResults?.directions?.length || 0);
  let tabGapsCount = $derived(currentResults?.gaps?.length || 0);
  let tabComparisonsCount = $derived(currentResults?.comparisons?.length || 0);
  let tabDirectionsCount = $derived(currentResults?.directions?.length || 0);
  let hasPapers = $derived((currentResults?.papers?.length || 0) > 0);

  let filterCountText = $derived(
    filteredGaps.length === allGaps.length
      ? `Showing all ${allGaps.length}`
      : `Showing ${filteredGaps.length} of ${allGaps.length}`
  );

  let currentParamsText = $derived(() => {
    const depth = currentParams?.depth || 'quick';
    const papers = currentParams?.papers || 30;
    return `${papers} papers, ${depth} analysis`;
  });

  let dlStrokeDashoffset = $derived(() => {
    const circumference = 213.628;
    return circumference - (dlProgress / 100) * circumference;
  });

  // Apply filters reactively
  $effect(() => {
    if (allGaps.length === 0) {
      filteredGaps = [];
      return;
    }

    let result = allGaps.filter(gap => {
      if (filterSeverity === 'all') return true;
      return gap.severity === filterSeverity;
    });

    if (filterSort === 'priority') {
      result = prioritizeGaps(result);
    } else if (filterSort === 'severity') {
      const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
      result.sort((a, b) => (order[a.severity] ?? 2) - (order[b.severity] ?? 2));
    } else if (filterSort === 'alphabetical') {
      result.sort((a, b) => a.title.localeCompare(b.title));
    }

    filteredGaps = result;
  });

  // Helper to find paper details by DOI
  function findPaperByDoi(doi: string): any | null {
    if (!currentResults?.papers) return null;
    return currentResults.papers.find((p: any) => p.doi === doi || p.doi?.endsWith(doi));
  }

  function getRelatedPapersForGap(relatedPapers: string[]): any[] {
    if (!relatedPapers || relatedPapers.length === 0) return [];
    return relatedPapers.map(doi => findPaperByDoi(doi)).filter(Boolean);
  }

  // Toggle collapsible sections
  function toggleApproach(cardId: string) {
    const newSet = new Set(expandedApproaches);
    if (newSet.has(cardId)) {
      newSet.delete(cardId);
    } else {
      newSet.add(cardId);
    }
    expandedApproaches = newSet;
  }

  function toggleRelatedPapersSection(cardId: string) {
    const newSet = new Set(expandedRelatedPapers);
    if (newSet.has(cardId)) {
      newSet.delete(cardId);
    } else {
      newSet.add(cardId);
    }
    expandedRelatedPapers = newSet;
  }

  // Actions
  function handleNewAnalysis() {
    gapState.reset();
  }

  function handleRefineSubmit() {
    showRefineModal = false;
    gapState.reset();
  }

  function handleDownloadReport() {
    if (reportUrl) {
      window.open(reportUrl, '_blank');
    }
  }

  function handleExportBibtex() {
    if (taskId) {
      window.open(`/api/export/${taskId}/bibtex`, '_blank');
    }
  }

  function handleExportRis() {
    if (taskId) {
      window.open(`/api/export/${taskId}/ris`, '_blank');
    }
  }

  async function handleDownloadPapers() {
    if (!taskId) return;

    // Reset and show modal
    dlProgress = 0;
    dlMessage = 'Starting download...';
    dlDetail = '';
    dlComplete = false;
    dlDownloadUrl = '';
    showDownloadModal = true;

    try {
      const res = await fetch(`/api/download-gap-papers/${taskId}`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        dlMessage = err.error || 'Failed to start download';
        return;
      }

      const { taskId: downloadTaskId } = await res.json();

      // Track progress via SSE
      dlEventSource = new EventSource(`/api/progress/${downloadTaskId}`);
      dlEventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          dlProgress = data.progress || 0;
          dlMessage = data.message || 'Downloading...';
          dlDetail = `${data.papersDownloaded || 0}/${data.papersFound || 0} papers`;

          if (data.status === 'complete') {
            dlEventSource?.close();
            dlEventSource = null;
            dlMessage = 'Download complete!';
            dlComplete = true;
            if (data.downloadUrl) {
              dlDownloadUrl = data.downloadUrl;
            }
          }

          if (data.status === 'error') {
            dlEventSource?.close();
            dlEventSource = null;
            dlMessage = data.error || 'Download failed';
          }
        } catch (e) {
          console.error('Failed to parse progress:', e);
        }
      };
      dlEventSource.onerror = () => {
        dlEventSource?.close();
        dlEventSource = null;
        dlMessage = 'Connection lost';
      };
    } catch (error) {
      dlMessage = 'Failed to start download';
      console.error('Download error:', error);
    }
  }

  async function handleShowRelatedPapers(doi: string, title: string) {
    relatedPapersTitle = `Related: ${title.substring(0, 50)}${title.length > 50 ? '...' : ''}`;
    relatedPapersLoading = true;
    relatedPapersData = null;
    relatedPapersError = '';
    showRelatedPapersModal = true;

    try {
      const res = await fetch(`/api/related-papers/${encodeURIComponent(doi)}?direction=both&count=10`);
      if (!res.ok) throw new Error('Failed to fetch');

      const data = await res.json();
      relatedPapersData = data;
      relatedPapersLoading = false;

      if (!data.citedBy?.length && !data.references?.length) {
        relatedPapersError = 'No related papers found for this DOI.';
      }
    } catch (error) {
      relatedPapersLoading = false;
      relatedPapersError = 'Failed to fetch related papers. Please try again.';
    }
  }

  function clearFilters() {
    filterSeverity = 'all';
    filterSort = 'priority';
  }

  // Load results on mount
  async function loadResults() {
    loading = true;
    loadError = false;

    const resultUrl = `/api/gap-results/${taskId}`;
    const reportUrlValue = `/api/gap-report/${taskId}`;
    reportUrl = reportUrlValue;

    try {
      const response = await fetch(resultUrl);
      if (!response.ok) throw new Error('Failed to load results');

      currentResults = await response.json();
      currentParams = currentResults.params || {};

      // Store and render gaps with prioritization
      allGaps = currentResults.gaps || [];
      if (allGaps.length > 0) {
        filteredGaps = prioritizeGaps(allGaps);
      }

      loading = false;
    } catch (error) {
      console.error('Failed to load results:', error);
      loading = false;
      loadError = true;
      gapState.fail('Failed to load analysis results');
    }
  }

  $effect(() => {
    if (taskId) {
      loadResults();
    }
  });

  // Cleanup on destroy
  onDestroy(() => {
    dlEventSource?.close();
    dlEventSource = null;
  });
</script>

<div class="gap-results-container active">
  <!-- Loading Overlay -->
  {#if loading}
    <div class="gap-results-loading">
      <span class="spinner spinner-lg"></span>
      <span>Loading results...</span>
    </div>
  {/if}

  {#if !loading && !loadError}
    <div class="results-header">
      <div class="results-title-section">
        <h1 class="results-title">Analysis Complete</h1>
        <p class="results-topic">{topic}</p>
      </div>
      <div class="results-actions">
        <button class="action-btn secondary-btn" type="button" onclick={() => showRefineModal = true}>
          <span class="btn-icon">&#8635;</span>
          <span class="btn-text">Refine</span>
        </button>
        <button class="action-btn primary-btn" type="button" onclick={handleDownloadReport}>
          <span class="btn-icon">&#8595;</span>
          <span class="btn-text">Download Report</span>
        </button>
        <button class="action-btn secondary-btn" type="button" onclick={handleExportBibtex}>
          <span class="btn-icon">&#8595;</span>
          <span class="btn-text">BibTeX</span>
        </button>
        <button class="action-btn secondary-btn" type="button" onclick={handleExportRis}>
          <span class="btn-icon">&#8595;</span>
          <span class="btn-text">RIS</span>
        </button>
        {#if hasPapers}
          <button class="action-btn primary-btn" type="button" onclick={handleDownloadPapers}>
            <span class="btn-icon">&#8595;</span>
            <span class="btn-text">Download Papers</span>
          </button>
        {/if}
        <button class="action-btn text-btn" type="button" onclick={handleNewAnalysis}>
          New Analysis
        </button>
      </div>
    </div>

    <!-- Results Summary -->
    <div class="results-summary">
      <div class="summary-stat">
        <span class="summary-value">{summaryPapers}</span>
        <span class="summary-label">Papers Analyzed</span>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-stat">
        <span class="summary-value">{summaryGaps}</span>
        <span class="summary-label">Gaps Found</span>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-stat">
        <span class="summary-value">{summaryDirections}</span>
        <span class="summary-label">Research Directions</span>
      </div>
    </div>

    <!-- Tab Navigation -->
    <div class="tabs-nav">
      <button class="tab-btn" class:active={activeTab === 'gaps'} onclick={() => activeTab = 'gaps'}>
        <span class="tab-icon">&#9671;</span>
        <span class="tab-label">Research Gaps</span>
        <span class="tab-count">{tabGapsCount}</span>
      </button>
      <button class="tab-btn" class:active={activeTab === 'comparisons'} onclick={() => activeTab = 'comparisons'}>
        <span class="tab-icon">&#9670;</span>
        <span class="tab-label">Comparisons</span>
        <span class="tab-count">{tabComparisonsCount}</span>
      </button>
      <button class="tab-btn" class:active={activeTab === 'directions'} onclick={() => activeTab = 'directions'}>
        <span class="tab-icon">&#9672;</span>
        <span class="tab-label">Directions</span>
        <span class="tab-count">{tabDirectionsCount}</span>
      </button>
      <button class="tab-btn" class:active={activeTab === 'trends'} onclick={() => activeTab = 'trends'}>
        <span class="tab-icon">&#8599;</span>
        <span class="tab-label">Trends</span>
      </button>
    </div>

    <!-- Filter Bar (for gaps tab) -->
    <div class="filter-bar" class:visible={activeTab === 'gaps'}>
      <div class="filter-group">
        <label class="filter-label">Severity</label>
        <select class="filter-select" bind:value={filterSeverity}>
          <option value="all">All</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>
      <div class="filter-group">
        <label class="filter-label">Sort by</label>
        <select class="filter-select" bind:value={filterSort}>
          <option value="priority">Priority</option>
          <option value="severity">Severity</option>
          <option value="alphabetical">Alphabetical</option>
        </select>
      </div>
      <span class="filter-count">{filterCountText}</span>
    </div>

    <!-- Tab Content -->
    <div class="tabs-content">
      <!-- Gaps Tab -->
      {#if activeTab === 'gaps'}
        <div class="tab-panel active">
          <div class="gaps-list">
            {#if filteredGaps.length > 0}
              {#each filteredGaps as gap, index}
                {@const severity = gap.severity || 'medium'}
                {@const cardId = `gap-card-${index}`}
                {@const hasRelated = gap.relatedPapers && gap.relatedPapers.length > 0}
                {@const relatedPapers = hasRelated ? getRelatedPapersForGap(gap.relatedPapers) : []}
                <div class="gap-card" id={cardId}>
                  <div class="gap-header">
                    <div class="gap-title-row">
                      <span class="gap-number">{index + 1}.</span>
                      <h3 class="gap-title">{gap.title}</h3>
                    </div>
                    <span class="severity-dot {severity}" title="{severity} severity"></span>
                  </div>
                  <p class="gap-description">{gap.description}</p>
                  {#if gap.suggestedApproach}
                    <button
                      class="gap-approach-toggle"
                      onclick={() => toggleApproach(cardId)}
                    >
                      {expandedApproaches.has(cardId) ? 'Hide suggested approach' : 'View suggested approach'}
                    </button>
                    <div class="gap-approach" class:collapsed={!expandedApproaches.has(cardId)}>
                      {gap.suggestedApproach}
                    </div>
                  {/if}
                  {#if hasRelated && relatedPapers.length > 0}
                    <button
                      class="gap-approach-toggle gap-papers-toggle"
                      onclick={() => toggleRelatedPapersSection(cardId)}
                    >
                      {expandedRelatedPapers.has(cardId) ? `Hide papers (${gap.relatedPapers.length})` : `Supporting papers (${gap.relatedPapers.length})`}
                    </button>
                    <div class="gap-related-papers" class:collapsed={!expandedRelatedPapers.has(cardId)}>
                      <div class="related-papers-label">Supporting Papers ({relatedPapers.length})</div>
                      <ul class="related-papers-list">
                        {#each relatedPapers as p}
                          <li class="related-paper-item">
                            <span class="related-paper-title">{p.title}</span>
                            <span class="related-paper-meta">{p.authors} ({p.year}) - {p.journal}</span>
                            {#if p.doi}
                              <a href="https://doi.org/{p.doi}" target="_blank" rel="noopener" class="related-paper-doi">{p.doi}</a>
                              <button class="find-related-btn" type="button" onclick={() => handleShowRelatedPapers(p.doi, p.title)}>Find Related &#8594;</button>
                            {/if}
                          </li>
                        {/each}
                      </ul>
                    </div>
                  {/if}
                </div>
              {/each}
            {:else if allGaps.length > 0}
              <!-- Filters produced no results -->
              <div class="empty-state">
                <div class="empty-icon">&#9671;</div>
                <h3 class="empty-title">No gaps match your filters</h3>
                <p class="empty-desc">Try adjusting your filter settings to see more results.</p>
                <button class="empty-btn" onclick={clearFilters}>
                  Clear Filters
                </button>
              </div>
            {:else}
              <!-- No gaps at all -->
              <div class="empty-state">
                <div class="empty-icon">&#9671;</div>
                <h3 class="empty-title">No significant gaps detected</h3>
                <p class="empty-desc">This research area appears well-covered. Consider:</p>
                <ul class="empty-suggestions">
                  <li>Try a more specific or niche topic</li>
                  <li>Adjust year filter to recent publications</li>
                  <li>Run Deep analysis for detailed insights</li>
                </ul>
                <button class="empty-btn" onclick={handleNewAnalysis}>Adjust & Retry</button>
              </div>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Comparisons Tab -->
      {#if activeTab === 'comparisons'}
        <div class="tab-panel active">
          <div class="comparisons-list">
            {#if currentResults?.comparisons?.length > 0}
              {#each currentResults.comparisons as comp}
                <div class="comparison-card">
                  <div class="comparison-dimension">Comparison: {comp.dimension}</div>
                  <div class="comparison-findings">
                    {#each comp.findings as f}
                      <div class="finding-group">
                        <div class="finding-label">{f.aspect}</div>
                        {#if f.differences?.length}
                          <div class="finding-label" style="margin-top:0.5rem">Differences</div>
                          <ul class="finding-list">
                            {#each f.differences as d}
                              <li>{d}</li>
                            {/each}
                          </ul>
                        {/if}
                        {#if f.similarities?.length}
                          <div class="finding-label" style="margin-top:0.5rem">Similarities</div>
                          <ul class="finding-list">
                            {#each f.similarities as s}
                              <li>{s}</li>
                            {/each}
                          </ul>
                        {/if}
                      </div>
                    {/each}
                  </div>
                  {#if comp.contradictions?.length}
                    <div class="finding-group" style="margin-top:0.875rem;background:rgba(155,68,68,0.05)">
                      <div class="finding-label" style="color:var(--color-error)">Contradictions</div>
                      <ul class="finding-list">
                        {#each comp.contradictions as c}
                          <li>{c}</li>
                        {/each}
                      </ul>
                    </div>
                  {/if}
                </div>
              {/each}
            {:else}
              <div class="empty-state">
                <div class="empty-icon">&#9670;</div>
                <h3 class="empty-title">Not enough papers to compare</h3>
                <p class="empty-desc">Methodology comparisons require at least 5 papers with similar focus areas.</p>
                <button class="empty-btn" onclick={handleNewAnalysis}>
                  Analyze More Papers
                </button>
              </div>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Directions Tab -->
      {#if activeTab === 'directions'}
        <div class="tab-panel active">
          <div class="directions-list">
            {#if currentResults?.directions?.length > 0}
              {#each currentResults.directions as dir}
                <div class="direction-card">
                  <div class="direction-header">
                    <h3 class="direction-title">{dir.title}</h3>
                    <div class="direction-ratings">
                      <div class="rating">
                        <span class="rating-label">Feasibility</span>
                        <span class="rating-value {dir.feasibility}">{dir.feasibility}</span>
                      </div>
                      <div class="rating">
                        <span class="rating-label">Novelty</span>
                        <span class="rating-value {dir.novelty}">{dir.novelty}</span>
                      </div>
                    </div>
                  </div>
                  <p class="direction-description">{dir.description}</p>
                  {#if dir.rationale}
                    <p class="direction-rationale">{dir.rationale}</p>
                  {/if}
                </div>
              {/each}
            {:else}
              <div class="empty-state">
                <div class="empty-icon">&#9672;</div>
                <h3 class="empty-title">No directions generated</h3>
                <p class="empty-desc">Research directions are generated based on identified gaps. Enable gap detection and try again.</p>
                <button class="empty-btn" onclick={handleNewAnalysis}>
                  Run Full Analysis
                </button>
              </div>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Trends Tab -->
      {#if activeTab === 'trends'}
        <div class="tab-panel active">
          <div class="trends-content">
            {#if currentResults?.trends}
              {#if currentResults.trends.peakYears?.length || currentResults.trends.emergingTopics?.length || currentResults.trends.decliningTrends?.length}
                {#if currentResults.trends.peakYears?.length}
                  <div class="trend-card">
                    <h4 class="trend-title">Peak Publication Years</h4>
                    <div class="trend-tags">
                      {#each currentResults.trends.peakYears as y}
                        <span class="trend-tag">{y}</span>
                      {/each}
                    </div>
                  </div>
                {/if}
                {#if currentResults.trends.emergingTopics?.length}
                  <div class="trend-card">
                    <h4 class="trend-title">Emerging Topics</h4>
                    <div class="trend-tags">
                      {#each currentResults.trends.emergingTopics.slice(0, 12) as t}
                        <span class="trend-tag">{t}</span>
                      {/each}
                    </div>
                  </div>
                {/if}
                {#if currentResults.trends.decliningTrends?.length}
                  <div class="trend-card">
                    <h4 class="trend-title">Declining Research Areas</h4>
                    <div class="trend-tags">
                      {#each currentResults.trends.decliningTrends as t}
                        <span class="trend-tag">{t}</span>
                      {/each}
                    </div>
                  </div>
                {/if}
              {:else}
                <div class="empty-state">
                  <div class="empty-icon">&#8599;</div>
                  <h3 class="empty-title">Limited trend data</h3>
                  <p class="empty-desc">More papers are needed to identify meaningful publication trends.</p>
                </div>
              {/if}
            {:else}
              <div class="empty-state">
                <div class="empty-icon">&#8599;</div>
                <h3 class="empty-title">No trend data available</h3>
                <p class="empty-desc">Trend analysis requires sufficient publication data across multiple years.</p>
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<!-- Refine Modal -->
{#if showRefineModal}
  <div class="refine-modal active">
    <div class="refine-backdrop" role="presentation" onclick={() => showRefineModal = false}></div>
    <div class="refine-dialog">
      <div class="refine-header">
        <h2 class="refine-title">Refine Analysis</h2>
        <button class="refine-close" type="button" onclick={() => showRefineModal = false}>&times;</button>
      </div>
      <div class="refine-body">
        <p class="refine-desc">Adjust parameters and run additional analysis on the same topic.</p>
        <div class="refine-current">
          <span class="current-label">Current:</span>
          <span class="current-value">{currentParamsText()}</span>
        </div>
        <div class="refine-options">
          <label class="refine-option">
            <input type="checkbox" bind:checked={refineMorePapers} />
            <div class="option-content">
              <span class="option-text">Analyze more papers</span>
              <span class="option-hint">Add 20 additional papers to the analysis</span>
            </div>
          </label>
          <label class="refine-option">
            <input type="checkbox" bind:checked={refineDeep} />
            <div class="option-content">
              <span class="option-text">Deep analysis</span>
              <span class="option-hint">More thorough gap detection (slower)</span>
            </div>
          </label>
          <div class="refine-option-wrapper">
            <label class="refine-option">
              <input type="checkbox" bind:checked={refineYear} />
              <div class="option-content">
                <span class="option-text">Year filter</span>
                <span class="option-hint">Limit papers to a specific range</span>
              </div>
            </label>
            <input
              type="text"
              class="refine-year-input"
              placeholder="e.g. 2020-2024"
              disabled={!refineYear}
              bind:value={refineYearInput}
            />
          </div>
        </div>
      </div>
      <div class="refine-footer">
        <button class="action-btn secondary-btn" type="button" onclick={() => showRefineModal = false}>Cancel</button>
        <button class="action-btn primary-btn" type="button" onclick={handleRefineSubmit}>
          <span class="btn-text">Refine Analysis</span>
          <span class="btn-icon">&#8594;</span>
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Download Progress Modal -->
{#if showDownloadModal}
  <div class="download-progress-modal active">
    <div class="refine-backdrop" role="presentation" onclick={() => showDownloadModal = false}></div>
    <div class="refine-dialog" style="max-width:480px;">
      <div class="refine-header">
        <h2 class="refine-title">Downloading Papers</h2>
        <button class="refine-close" type="button" onclick={() => showDownloadModal = false}>&times;</button>
      </div>
      <div class="refine-body" style="text-align:center;">
        <div class="download-progress-ring">
          <svg viewBox="0 0 80 80" width="80" height="80">
            <circle cx="40" cy="40" r="34" fill="none" stroke="var(--color-gap-border)" stroke-width="6" />
            <circle cx="40" cy="40" r="34" fill="none" stroke="var(--color-gap-accent)" stroke-width="6"
              stroke-linecap="round" stroke-dasharray="213.628"
              style="stroke-dashoffset:{dlStrokeDashoffset()};transform:rotate(-90deg);transform-origin:center;transition:stroke-dashoffset 0.4s ease;" />
          </svg>
          <span class="dl-progress-pct">{dlProgress}%</span>
        </div>
        <p class="dl-progress-msg">{dlMessage}</p>
        <p class="dl-progress-detail">{dlDetail}</p>
      </div>
      {#if dlComplete}
        <div class="refine-footer">
          <a class="action-btn primary-btn" href={dlDownloadUrl} target="_blank">
            <span class="btn-icon">&#8595;</span>
            <span class="btn-text">Download ZIP</span>
          </a>
        </div>
      {/if}
    </div>
  </div>
{/if}

<!-- Related Papers Modal -->
{#if showRelatedPapersModal}
  <div class="related-papers-modal active">
    <div class="refine-backdrop" role="presentation" onclick={() => showRelatedPapersModal = false}></div>
    <div class="refine-dialog" style="max-width:560px;">
      <div class="refine-header">
        <h2 class="refine-title">{relatedPapersTitle}</h2>
        <button class="refine-close" type="button" onclick={() => showRelatedPapersModal = false}>&times;</button>
      </div>
      <div class="refine-body">
        {#if relatedPapersLoading}
          <div class="loading-overlay">
            <span class="spinner spinner-lg"></span>
            <span>Finding related papers...</span>
          </div>
        {:else if relatedPapersError}
          <div class="related-empty">{relatedPapersError}</div>
        {:else if relatedPapersData}
          {#if relatedPapersData.citedBy?.length > 0}
            <div class="related-section">
              <div class="related-section-title">Cited By ({relatedPapersData.citedBy.length})</div>
              {#each relatedPapersData.citedBy as p}
                <div class="related-paper-card">
                  <div class="related-paper-card-title">{p.title}</div>
                  <div class="related-paper-card-meta">{p.authors} ({p.year}) - {p.journal}</div>
                  {#if p.doi}
                    <a href="https://doi.org/{p.doi}" target="_blank" rel="noopener" class="related-paper-card-doi">{p.doi}</a>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
          {#if relatedPapersData.references?.length > 0}
            <div class="related-section">
              <div class="related-section-title">References ({relatedPapersData.references.length})</div>
              {#each relatedPapersData.references as p}
                <div class="related-paper-card">
                  <div class="related-paper-card-title">{p.title}</div>
                  <div class="related-paper-card-meta">{p.authors} ({p.year}) - {p.journal}</div>
                  {#if p.doi}
                    <a href="https://doi.org/{p.doi}" target="_blank" rel="noopener" class="related-paper-card-doi">{p.doi}</a>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .gap-results-container {
    display: none;
    flex-direction: column;
    padding: 1.5rem 0;
    position: relative;
  }

  .gap-results-container.active {
    display: flex;
    animation: fadeIn 0.5s ease;
  }

  /* Loading Overlay */
  .gap-results-loading {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-md);
    background: rgba(245, 247, 245, 0.95);
    z-index: 10;
    color: var(--color-gap-text-secondary);
    min-height: 300px;
  }

  .gap-results-loading .spinner {
    color: var(--color-gap-accent);
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  /* Header */
  .results-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .results-title-section {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .results-title {
    font-family: var(--font-display);
    font-size: 1.75rem;
    color: var(--color-gap-text);
    margin: 0;
  }

  .results-topic {
    font-size: 0.9375rem;
    color: var(--color-gap-text-secondary);
    margin: 0;
  }

  .results-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1rem;
    border-radius: var(--radius-md);
    font-family: var(--font-body);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    border: none;
  }

  .primary-btn {
    background: var(--color-gap-accent);
    color: white;
  }

  .primary-btn:hover {
    background: var(--color-gap-accent-dark);
    transform: translateY(-1px);
  }

  .secondary-btn {
    background: var(--color-gap-surface);
    color: var(--color-gap-text);
    border: 1px solid var(--color-gap-border);
  }

  .secondary-btn:hover {
    border-color: var(--color-gap-accent);
    color: var(--color-gap-accent);
  }

  .text-btn {
    background: none;
    color: var(--color-gap-text-secondary);
    padding: 0.625rem 0.5rem;
  }

  .text-btn:hover {
    color: var(--color-gap-accent);
  }

  /* Summary - Clean minimal */
  .results-summary {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-xl);
    padding: var(--space-lg) var(--space-xl);
    margin-bottom: var(--space-lg);
  }

  .summary-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
  }

  .summary-value {
    font-family: var(--font-display);
    font-size: 1.75rem;
    color: var(--color-gap-accent);
    line-height: 1;
  }

  .summary-label {
    font-size: 0.6875rem;
    color: var(--color-gap-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .summary-divider {
    width: 1px;
    height: 36px;
    background: var(--color-gap-border);
  }

  /* Tabs - Minimal underline style */
  .tabs-nav {
    display: flex;
    gap: var(--space-lg);
    margin-bottom: var(--space-lg);
    border-bottom: 1px solid var(--color-gap-border);
    overflow-x: auto;
  }

  .tab-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: var(--space-sm) 0;
    padding-bottom: var(--space-md);
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    font-family: var(--font-body);
    font-size: 0.9375rem;
    color: var(--color-gap-text-muted);
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
  }

  .tab-btn:hover {
    color: var(--color-gap-text);
  }

  .tab-btn.active {
    color: var(--color-gap-accent);
    border-bottom-color: var(--color-gap-accent);
  }

  .tab-icon {
    font-size: 1rem;
    opacity: 0.7;
  }

  .tab-btn.active .tab-icon {
    opacity: 1;
  }

  .tab-label {
    display: none;
  }

  .tab-count {
    font-size: 0.8125rem;
    font-weight: 500;
  }

  @media (min-width: 640px) {
    .tab-label {
      display: inline;
    }
  }

  /* Filter Bar */
  .filter-bar {
    display: none;
    align-items: center;
    gap: 1.25rem;
    padding: 0.875rem 1.25rem;
    background: var(--color-gap-surface);
    border: 1px solid var(--color-gap-border);
    border-radius: var(--radius-md);
    margin-bottom: 1rem;
  }

  .filter-bar.visible {
    display: flex;
  }

  .filter-group {
    display: flex;
    align-items: center;
    gap: 0.625rem;
  }

  .filter-label {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-gap-text-muted);
  }

  .filter-select {
    appearance: none;
    -webkit-appearance: none;
    padding: 0.5rem 2rem 0.5rem 0.875rem;
    background: var(--color-gap-bg);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%232b5a4a' d='M6 8L2 4h8z'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 0.625rem center;
    border: 1px solid var(--color-gap-border);
    border-radius: var(--radius-md);
    font-family: var(--font-body);
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-gap-text);
    cursor: pointer;
    transition: all 0.2s ease;
    min-width: 100px;
  }

  .filter-select:hover {
    border-color: var(--color-gap-accent-light);
  }

  .filter-select:focus {
    outline: none;
    border-color: var(--color-gap-accent);
    box-shadow: 0 0 0 3px rgba(43, 90, 74, 0.1);
  }

  .filter-count {
    margin-left: auto;
    font-size: 0.8125rem;
    color: var(--color-gap-text-muted);
  }

  /* Tab Content */
  .tabs-content {
    width: 100%;
  }

  .tab-panel {
    display: none;
  }

  .tab-panel.active {
    display: block;
    animation: tabFadeIn 0.3s ease;
  }

  @keyframes tabFadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* Gap Card - Clean minimal style */
  .gaps-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  .gap-card {
    background: var(--color-gap-surface);
    border-radius: var(--radius-lg);
    padding: var(--space-md) var(--space-lg);
    transition: all 0.2s ease;
    box-shadow: 0 1px 3px rgba(20, 26, 24, 0.04);
    border-left: 3px solid var(--color-gap-accent-light);
  }

  .gap-card:hover {
    box-shadow: 0 4px 12px rgba(43, 90, 74, 0.08);
    border-left-color: var(--color-gap-accent);
  }

  .gap-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: var(--space-sm);
    gap: var(--space-md);
  }

  .gap-title-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-sm);
  }

  .gap-number {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-gap-text-muted);
  }

  .gap-title {
    font-size: 1rem;
    font-weight: 500;
    color: var(--color-gap-text);
    margin: 0;
    line-height: 1.4;
  }

  /* Severity dot instead of badges */
  .severity-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 6px;
  }

  .severity-dot.high {
    background: var(--color-error);
  }

  .severity-dot.medium {
    background: var(--color-warning);
  }

  .severity-dot.low {
    background: var(--color-gap-accent-light);
  }

  .gap-badges {
    display: flex;
    gap: 0.375rem;
    flex-shrink: 0;
  }

  .gap-badge {
    font-size: 0.625rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
  }

  .badge-type {
    background: rgba(43, 90, 74, 0.1);
    color: var(--color-gap-accent);
  }

  .badge-severity {
    background: rgba(166, 139, 61, 0.1);
    color: var(--color-warning);
  }

  .badge-severity.high {
    background: rgba(155, 68, 68, 0.1);
    color: var(--color-error);
  }

  .badge-severity.low {
    background: rgba(74, 124, 89, 0.1);
    color: var(--color-success);
  }

  .gap-description {
    font-size: 0.9375rem;
    color: var(--color-gap-text-secondary);
    line-height: 1.6;
    margin: 0;
  }

  /* Collapsible approach toggle */
  .gap-approach-toggle {
    display: inline-flex;
    align-items: center;
    margin-top: var(--space-sm);
    padding: 0;
    background: none;
    border: none;
    font-family: var(--font-body);
    font-size: 0.8125rem;
    color: var(--color-gap-accent);
    cursor: pointer;
    transition: color 0.2s ease;
  }

  .gap-approach-toggle:hover {
    color: var(--color-gap-accent-dark);
  }

  .gap-approach-toggle::before {
    content: '\25B8';
    margin-right: 0.375rem;
    transition: transform 0.2s ease;
  }

  .gap-approach {
    margin-top: var(--space-sm);
    padding: var(--space-md);
    background: var(--color-gap-bg);
    border-radius: var(--radius-md);
    font-size: 0.875rem;
    color: var(--color-gap-text-secondary);
    line-height: 1.6;
    overflow: hidden;
    transition: max-height 0.3s ease, opacity 0.3s ease, padding 0.3s ease;
  }

  .gap-approach.collapsed,
  .gap-related-papers.collapsed {
    max-height: 0;
    padding-top: 0;
    padding-bottom: 0;
    opacity: 0;
  }

  /* Related Papers */
  .gap-related-papers {
    margin-top: var(--space-sm);
    padding: var(--space-md);
    background: var(--color-gap-bg);
    border-radius: var(--radius-md);
    overflow: hidden;
    transition: max-height 0.3s ease, opacity 0.3s ease, padding 0.3s ease;
  }

  .related-papers-label {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-gap-text-muted);
    margin-bottom: var(--space-sm);
  }

  .related-papers-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }

  .related-paper-item {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--color-gap-border);
  }

  .related-paper-item:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }

  .related-paper-title {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-gap-text);
  }

  .related-paper-meta {
    font-size: 0.75rem;
    color: var(--color-gap-text-muted);
  }

  .related-paper-doi {
    font-size: 0.75rem;
    color: var(--color-gap-accent);
    text-decoration: none;
    transition: color 0.2s ease;
  }

  .related-paper-doi:hover {
    color: var(--color-gap-accent-dark);
    text-decoration: underline;
  }

  .gap-papers-toggle {
    margin-left: var(--space-sm);
  }

  /* Direction Card */
  .direction-card {
    background: var(--color-gap-surface);
    border-radius: var(--radius-lg);
    padding: var(--space-md) var(--space-lg);
    margin-bottom: var(--space-md);
    box-shadow: 0 1px 3px rgba(20, 26, 24, 0.04);
    border-left: 3px solid var(--color-gap-accent-light);
    transition: all 0.2s ease;
  }

  .direction-card:hover {
    box-shadow: 0 4px 12px rgba(43, 90, 74, 0.08);
    border-left-color: var(--color-gap-accent);
  }

  .direction-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 0.625rem;
    gap: 1rem;
  }

  .direction-title {
    font-size: 1rem;
    font-weight: 500;
    color: var(--color-gap-text);
    margin: 0;
  }

  .direction-ratings {
    display: flex;
    gap: 0.625rem;
  }

  .rating {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.125rem;
  }

  .rating-label {
    font-size: 0.5625rem;
    text-transform: uppercase;
    color: var(--color-gap-text-muted);
  }

  .rating-value {
    font-size: 0.6875rem;
    font-weight: 600;
    padding: 0.125rem 0.375rem;
    border-radius: 4px;
  }

  .rating-value.high {
    background: rgba(74, 124, 89, 0.15);
    color: var(--color-success);
  }

  .rating-value.medium {
    background: rgba(166, 139, 61, 0.15);
    color: var(--color-warning);
  }

  .rating-value.low {
    background: rgba(155, 68, 68, 0.1);
    color: var(--color-error);
  }

  .direction-description {
    font-size: 0.9375rem;
    color: var(--color-gap-text-secondary);
    line-height: 1.6;
    margin: 0 0 0.625rem;
  }

  .direction-rationale {
    font-size: 0.8125rem;
    color: var(--color-gap-text-muted);
    font-style: italic;
    padding-left: 0.875rem;
    border-left: 2px solid var(--color-gap-border);
  }

  /* Comparison Card */
  .comparison-card {
    background: var(--color-gap-surface);
    border-radius: var(--radius-lg);
    padding: var(--space-md) var(--space-lg);
    margin-bottom: var(--space-md);
    box-shadow: 0 1px 3px rgba(20, 26, 24, 0.04);
    border-left: 3px solid var(--color-gap-accent-light);
    transition: all 0.2s ease;
  }

  .comparison-card:hover {
    box-shadow: 0 4px 12px rgba(43, 90, 74, 0.08);
    border-left-color: var(--color-gap-accent);
  }

  .comparison-dimension {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-gap-accent);
    margin-bottom: var(--space-sm);
    padding-bottom: var(--space-xs);
    border-bottom: 1px solid var(--color-gap-border);
  }

  .comparison-findings {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
  }

  .finding-group {
    padding: 0.875rem;
    background: var(--color-gap-bg);
    border-radius: var(--radius-md);
  }

  .finding-label {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--color-gap-text-secondary);
    margin-bottom: 0.5rem;
  }

  .finding-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .finding-list li {
    font-size: 0.875rem;
    color: var(--color-gap-text-secondary);
    padding: 0.25rem 0 0.25rem 1rem;
    position: relative;
  }

  .finding-list li::before {
    content: '\2022';
    position: absolute;
    left: 0;
    color: var(--color-gap-accent);
  }

  /* Trends Content */
  .trends-content {
    display: grid;
    gap: var(--space-md);
  }

  .trend-card {
    background: var(--color-gap-surface);
    border-radius: var(--radius-lg);
    padding: var(--space-md) var(--space-lg);
    box-shadow: 0 1px 3px rgba(20, 26, 24, 0.04);
    border-left: 3px solid var(--color-gap-accent-light);
    transition: all 0.2s ease;
  }

  .trend-card:hover {
    box-shadow: 0 4px 12px rgba(43, 90, 74, 0.08);
    border-left-color: var(--color-gap-accent);
  }

  .trend-title {
    font-size: 0.8125rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-gap-text-secondary);
    margin: 0 0 var(--space-sm);
  }

  .trend-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.625rem 0.5rem;
  }

  .trend-tag {
    font-size: 0.8125rem;
    padding: 0.375rem 0.875rem;
    background: rgba(43, 90, 74, 0.1);
    color: var(--color-gap-accent);
    border-radius: 100px;
    white-space: nowrap;
    transition: all 0.2s ease;
  }

  .trend-tag:hover {
    background: rgba(43, 90, 74, 0.15);
  }

  /* Empty State */
  .empty-state {
    text-align: center;
    padding: 3rem 1.5rem;
  }

  .empty-icon {
    font-size: 2.5rem;
    margin-bottom: 1rem;
    opacity: 0.4;
  }

  .empty-title {
    font-family: var(--font-display);
    font-size: 1.125rem;
    color: var(--color-gap-text);
    margin: 0 0 0.5rem;
  }

  .empty-desc {
    font-size: 0.9375rem;
    color: var(--color-gap-text-secondary);
    margin: 0 0 1rem;
    max-width: 360px;
    margin-left: auto;
    margin-right: auto;
  }

  .empty-suggestions {
    list-style: none;
    padding: 0;
    margin: 0 0 1.5rem;
    text-align: left;
    display: inline-block;
  }

  .empty-suggestions li {
    font-size: 0.875rem;
    color: var(--color-gap-text-muted);
    padding: 0.25rem 0;
    padding-left: 1.25rem;
    position: relative;
  }

  .empty-suggestions li::before {
    content: '\2192';
    position: absolute;
    left: 0;
    color: var(--color-gap-accent);
  }

  .empty-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.25rem;
    background: var(--color-gap-accent);
    color: white;
    border: none;
    border-radius: var(--radius-md);
    font-family: var(--font-body);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .empty-btn:hover {
    background: var(--color-gap-accent-dark);
    transform: translateY(-1px);
  }

  /* Refine Modal */
  .refine-modal {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 1000;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }

  .refine-modal.active {
    display: flex;
    animation: modalFadeIn 0.2s ease;
  }

  @keyframes modalFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .refine-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(20, 26, 24, 0.6);
    backdrop-filter: blur(4px);
  }

  .refine-dialog {
    position: relative;
    width: 100%;
    max-width: 440px;
    background: var(--color-gap-surface);
    border-radius: var(--radius-lg);
    box-shadow: 0 24px 48px rgba(20, 26, 24, 0.2);
    animation: dialogSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes dialogSlideIn {
    from { opacity: 0; transform: translateY(20px) scale(0.95); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .refine-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid var(--color-gap-border);
  }

  .refine-title {
    font-family: var(--font-display);
    font-size: 1.25rem;
    color: var(--color-gap-text);
    margin: 0;
  }

  .refine-close {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    font-size: 1.5rem;
    color: var(--color-gap-text-muted);
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.2s ease;
  }

  .refine-close:hover {
    background: var(--color-gap-bg-deep);
    color: var(--color-gap-text);
  }

  .refine-body {
    padding: 1.5rem;
  }

  .refine-desc {
    font-size: 0.9375rem;
    color: var(--color-gap-text-secondary);
    margin: 0 0 1rem;
  }

  .refine-current {
    padding: 0.75rem 1rem;
    background: var(--color-gap-bg);
    border-radius: var(--radius-md);
    margin-bottom: 1.25rem;
    font-size: 0.875rem;
  }

  .current-label {
    color: var(--color-gap-text-muted);
    margin-right: 0.5rem;
  }

  .current-value {
    color: var(--color-gap-text);
    font-weight: 500;
  }

  .refine-options {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .refine-option {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    cursor: pointer;
    padding: 0.875rem 1rem;
    background: var(--color-gap-bg);
    border: 1px solid var(--color-gap-border);
    border-radius: var(--radius-md);
    transition: all 0.2s ease;
  }

  .refine-option:hover {
    border-color: var(--color-gap-accent-light);
  }

  .refine-option:has(input:checked) {
    border-color: var(--color-gap-accent);
    background: rgba(43, 90, 74, 0.05);
  }

  .refine-option input[type="checkbox"] {
    width: 18px;
    height: 18px;
    margin-top: 2px;
    accent-color: var(--color-gap-accent);
    cursor: pointer;
    flex-shrink: 0;
  }

  .option-content {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .option-text {
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--color-gap-text);
  }

  .option-hint {
    font-size: 0.8125rem;
    color: var(--color-gap-text-muted);
  }

  .refine-option-wrapper {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .refine-option-wrapper .refine-option {
    margin-bottom: 0;
  }

  .refine-year-input {
    width: 100%;
    padding: 0.625rem 0.875rem;
    background: var(--color-gap-surface);
    border: 1px solid var(--color-gap-border);
    border-radius: var(--radius-md);
    font-family: var(--font-body);
    font-size: 0.875rem;
    color: var(--color-gap-text);
    transition: all 0.2s ease;
  }

  .refine-year-input:focus {
    outline: none;
    border-color: var(--color-gap-accent);
  }

  .refine-year-input:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .refine-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    padding: 1rem 1.5rem;
    border-top: 1px solid var(--color-gap-border);
    background: var(--color-gap-bg);
    border-radius: 0 0 var(--radius-lg) var(--radius-lg);
  }

  /* Download Progress Modal */
  .download-progress-modal,
  .related-papers-modal {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 1000;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }

  .download-progress-modal.active,
  .related-papers-modal.active {
    display: flex;
    animation: modalFadeIn 0.2s ease;
  }

  .download-progress-ring {
    position: relative;
    display: inline-block;
    margin-bottom: var(--space-md);
  }

  .dl-progress-pct {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-display);
    font-size: 1.25rem;
    color: var(--color-gap-text);
  }

  .dl-progress-msg {
    font-size: 0.9375rem;
    color: var(--color-gap-text);
    margin: 0 0 0.25rem;
  }

  .dl-progress-detail {
    font-size: 0.8125rem;
    color: var(--color-gap-text-muted);
    margin: 0;
  }

  /* Related Papers Modal Content */
  .related-section {
    margin-bottom: var(--space-lg);
  }

  .related-section:last-child {
    margin-bottom: 0;
  }

  .related-section-title {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-gap-accent);
    margin-bottom: var(--space-sm);
    padding-bottom: var(--space-xs);
    border-bottom: 1px solid var(--color-gap-border);
  }

  .related-paper-card {
    padding: 0.75rem;
    margin-bottom: 0.5rem;
    background: var(--color-gap-bg);
    border-radius: var(--radius-md);
    transition: background 0.2s ease;
  }

  .related-paper-card:hover {
    background: var(--color-gap-bg-deep);
  }

  .related-paper-card-title {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-gap-text);
    margin-bottom: 0.25rem;
  }

  .related-paper-card-meta {
    font-size: 0.75rem;
    color: var(--color-gap-text-muted);
    margin-bottom: 0.25rem;
  }

  .related-paper-card-doi {
    font-size: 0.75rem;
    color: var(--color-gap-accent);
    text-decoration: none;
  }

  .related-paper-card-doi:hover {
    text-decoration: underline;
  }

  .find-related-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.5rem;
    background: none;
    border: 1px solid var(--color-gap-border);
    border-radius: var(--radius-sm);
    font-family: var(--font-body);
    font-size: 0.6875rem;
    color: var(--color-gap-accent);
    cursor: pointer;
    transition: all 0.2s ease;
    margin-top: 0.25rem;
  }

  .find-related-btn:hover {
    background: rgba(43, 90, 74, 0.05);
    border-color: var(--color-gap-accent);
  }

  .related-empty {
    text-align: center;
    padding: var(--space-lg);
    color: var(--color-gap-text-muted);
    font-size: 0.875rem;
  }

  .loading-overlay {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-md);
    padding: var(--space-xl);
    color: var(--color-gap-text-secondary);
  }

  @media (max-width: 640px) {
    .results-header {
      flex-direction: column;
    }

    .results-actions {
      width: 100%;
      justify-content: flex-start;
    }

    .results-summary {
      flex-direction: column;
      gap: 1rem;
    }

    .summary-divider {
      width: 60px;
      height: 1px;
    }

    .tabs-nav {
      justify-content: flex-start;
    }

    .tab-label {
      display: none;
    }

    .tab-btn {
      padding: 0.75rem 1rem;
    }

    .filter-bar {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.75rem;
    }

    .filter-count {
      margin-left: 0;
    }

    .refine-dialog {
      max-width: 100%;
    }
  }
</style>
