<script lang="ts">
  import Tooltip from './Tooltip.svelte';
  import { gapState } from '$lib/stores/gap';
  import { gapHistory, type GapHistoryEntry } from '$lib/stores/history';

  let { onAnalysisStarted }: { onAnalysisStarted?: (taskId: string, topic: string) => void } = $props();

  // Form state
  let topic = $state('');
  let depth: 'quick' | 'deep' = $state('quick');
  let papers = $state(30);
  let yearFilter = $state('');
  let analysisTypes = $state({ gaps: true, comparisons: true, directions: true });

  // UI state
  let advancedExpanded = $state(false);
  let isSubmitting = $state(false);
  let topicError = $state('');
  let yearError = $state('');
  let typesError = $state('');
  let topicInvalid = $state(false);
  let yearInvalid = $state(false);

  // Autocomplete state
  let suggestions = $state<{ name: string; works: number }[]>([]);
  let showAutocomplete = $state(false);
  let acSelectedIdx = $state(-1);
  let acDebounceTimer: ReturnType<typeof setTimeout> | undefined;

  // History dropdown state
  let showHistory = $state(false);

  // Element refs
  let topicInputEl: HTMLInputElement;

  // Derived values
  let charCount = $derived(`${topic.length}/200`);

  let timeEstimate = $derived.by(() => {
    const baseTime = depth === 'quick' ? 1.5 : 6;
    const estimate = Math.ceil(baseTime * (papers / 30));

    if (estimate <= 2) return '~1-2 minutes';
    if (estimate <= 4) return '~3-4 minutes';
    if (estimate <= 6) return '~5-6 minutes';
    return `~${estimate - 1}-${estimate + 1} minutes`;
  });

  let minusBtnDisabled = $derived(papers <= 10);
  let plusBtnDisabled = $derived(papers >= 100);

  // Format count helper
  function fmtCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  }

  // Autocomplete effect with debounce
  $effect(() => {
    const q = topic.trim();
    if (acDebounceTimer) clearTimeout(acDebounceTimer);

    if (q.length < 2) {
      showAutocomplete = false;
      return;
    }

    acDebounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`);
        const data: { name: string; works: number }[] = await res.json();
        if (data.length === 0 || topic.trim() !== q) {
          showAutocomplete = false;
          return;
        }
        suggestions = data;
        acSelectedIdx = -1;
        showAutocomplete = true;
      } catch {
        /* ignore */
      }
    }, 250);
  });

  // Validation
  function validateTopic(): boolean {
    const value = topic.trim();

    if (value.length === 0) {
      topicError = 'Please enter a research topic';
      topicInvalid = true;
      return false;
    }
    if (value.length < 5) {
      topicError = 'Topic must be at least 5 characters';
      topicInvalid = true;
      return false;
    }
    if (value.length > 200) {
      topicError = 'Topic must be less than 200 characters';
      topicInvalid = true;
      return false;
    }

    topicError = '';
    topicInvalid = false;
    return true;
  }

  function validateYear(): boolean {
    const value = yearFilter.trim();

    if (!value) {
      yearError = '';
      yearInvalid = false;
      return true;
    }

    const pattern = /^(\d{4})-(\d{4})$/;
    const match = value.match(pattern);

    if (!match) {
      yearError = 'Use format: YYYY-YYYY (e.g., 2020-2024)';
      yearInvalid = true;
      return false;
    }

    const startYear = parseInt(match[1]);
    const endYear = parseInt(match[2]);

    if (endYear < startYear) {
      yearError = 'End year must be after start year';
      yearInvalid = true;
      return false;
    }

    if (startYear < 1900 || endYear > new Date().getFullYear() + 1) {
      yearError = 'Please enter valid years';
      yearInvalid = true;
      return false;
    }

    yearError = '';
    yearInvalid = false;
    return true;
  }

  function validateTypes(): boolean {
    const hasChecked = analysisTypes.gaps || analysisTypes.comparisons || analysisTypes.directions;

    if (!hasChecked) {
      typesError = 'Select at least one analysis type';
      return false;
    }

    typesError = '';
    return true;
  }

  // Stepper handlers
  function decreasePapers() {
    if (papers > 10) papers -= 10;
  }

  function increasePapers() {
    if (papers < 100) papers += 10;
  }

  // Topic input handlers
  function handleTopicInput() {
    validateTopic();
    showHistory = false;
  }

  function handleTopicFocus() {
    if ($gapHistory.length > 0 && !topic) {
      showHistory = true;
    }
  }

  function handleTopicBlur() {
    setTimeout(() => {
      showAutocomplete = false;
      showHistory = false;
    }, 200);
  }

  function handleTopicKeydown(e: KeyboardEvent) {
    if (!showAutocomplete) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      acSelectedIdx = Math.min(acSelectedIdx + 1, suggestions.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      acSelectedIdx = Math.max(acSelectedIdx - 1, 0);
    } else if (e.key === 'Enter' && acSelectedIdx >= 0) {
      e.preventDefault();
      topic = suggestions[acSelectedIdx].name;
      showAutocomplete = false;
    } else if (e.key === 'Escape') {
      showAutocomplete = false;
    }
  }

  function selectSuggestion(e: MouseEvent, name: string) {
    e.preventDefault();
    topic = name;
    showAutocomplete = false;
  }

  // History handlers
  function selectHistoryItem(e: MouseEvent, entry: GapHistoryEntry) {
    e.preventDefault();
    topic = entry.topic;
    depth = entry.depth as 'quick' | 'deep';
    papers = entry.papers;
    showHistory = false;
  }

  function removeHistoryItem(e: MouseEvent, entryTopic: string) {
    e.preventDefault();
    e.stopPropagation();
    gapHistory.remove(entryTopic);
  }

  function clearAllHistory(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    gapHistory.clear();
    showHistory = false;
  }

  // Form submission
  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();

    const isTopicValid = validateTopic();
    const isYearValid = validateYear();
    const isTypesValid = validateTypes();

    if (!isTopicValid || !isYearValid || !isTypesValid) {
      return;
    }

    const selectedTypes: string[] = [];
    if (analysisTypes.gaps) selectedTypes.push('gaps');
    if (analysisTypes.comparisons) selectedTypes.push('comparisons');
    if (analysisTypes.directions) selectedTypes.push('directions');

    if (selectedTypes.length === 0) {
      selectedTypes.push('gaps', 'comparisons', 'directions');
    }

    isSubmitting = true;

    try {
      const response = await fetch('/api/analyze-gaps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim(),
          analysisTypes: selectedTypes,
          papers,
          yearFilter: yearFilter.trim() || undefined,
          depth
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Analysis failed');
      }

      // Save to gap analysis history
      gapHistory.add({ topic: topic.trim(), depth, papers });

      // Update the gap store
      gapState.startAnalysis(data.taskId, topic.trim());

      // Notify parent via callback
      onAnalysisStarted?.(data.taskId, topic.trim());

    } catch (error) {
      console.error('Gap analysis error:', error);
      topicError = error instanceof Error ? error.message : 'Analysis failed. Please try again.';
      topicInvalid = false;
      isSubmitting = false;
    }
  }
</script>

<form class="gap-form" novalidate onsubmit={handleSubmit}>
  <!-- Main Form Section -->
  <div class="form-main">
    <!-- Topic Input -->
    <div class="form-group topic-group">
      <div class="label-row">
        <label for="gap-topic" class="form-label">Research Topic</label>
        <Tooltip content="Enter your research area using natural language. Example: 'machine learning in healthcare' or 'sustainable energy storage'" position="right" />
      </div>
      <div class="input-wrapper">
        <input
          type="text"
          id="gap-topic"
          name="topic"
          placeholder="e.g., Machine learning in medical diagnosis"
          required
          minlength={5}
          maxlength={200}
          class="form-input topic-input"
          class:invalid={topicInvalid}
          autocomplete="off"
          bind:this={topicInputEl}
          bind:value={topic}
          oninput={handleTopicInput}
          onfocus={handleTopicFocus}
          onblur={handleTopicBlur}
          onkeydown={handleTopicKeydown}
        />
        <!-- Autocomplete Dropdown -->
        <div class="gap-autocomplete-dropdown" class:visible={showAutocomplete}>
          {#each suggestions as suggestion, i}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="gap-ac-item"
              class:selected={i === acSelectedIdx}
              onmousedown={(e) => selectSuggestion(e, suggestion.name)}
            >
              <span class="gap-ac-name">{suggestion.name}</span>
              <span class="gap-ac-count">{fmtCount(suggestion.works)} papers</span>
            </div>
          {/each}
        </div>
        <!-- History Dropdown -->
        {#if showHistory && $gapHistory.length > 0}
          <div class="gap-history-dropdown visible">
            <div class="gap-history-header">
              <span class="gap-history-label">Recent Analyses</span>
              <button class="gap-history-clear" type="button" onmousedown={clearAllHistory}>Clear All</button>
            </div>
            {#each $gapHistory as entry}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="gap-history-item"
                onmousedown={(e) => selectHistoryItem(e, entry)}
              >
                <div class="gap-history-item-text">
                  <span class="gap-history-topic">{entry.topic}</span>
                  <span class="gap-history-meta">{entry.depth} &middot; {entry.papers} papers &middot; {new Date(entry.timestamp).toLocaleDateString()}</span>
                </div>
                <button
                  class="gap-history-remove"
                  type="button"
                  title="Remove"
                  onmousedown={(e) => removeHistoryItem(e, entry.topic)}
                >&times;</button>
              </div>
            {/each}
          </div>
        {/if}
        <div class="input-accent"></div>
      </div>
      <div class="input-footer">
        <span class="form-hint">Enter your research area to analyze for gaps</span>
        <span class="char-count">{charCount}</span>
      </div>
      {#if topicError}
        <span class="form-error visible">{topicError}</span>
      {/if}
    </div>

    <!-- Analysis Depth -->
    <div class="form-group depth-group">
      <div class="label-row">
        <label class="form-label">Analysis Depth</label>
        <Tooltip content="Quick: ~1-2 min, analyzes metadata. Deep: ~5-8 min, includes full-text analysis when available." position="right" />
      </div>
      <div class="depth-toggle">
        <label class="depth-option">
          <input type="radio" name="depth" value="quick" bind:group={depth} />
          <span class="depth-content">
            <span class="depth-header">
              <span class="depth-icon">&#9889;</span>
              <span class="depth-label">Quick</span>
            </span>
            <span class="depth-desc">Metadata analysis, best for exploration</span>
          </span>
        </label>
        <label class="depth-option">
          <input type="radio" name="depth" value="deep" bind:group={depth} />
          <span class="depth-content">
            <span class="depth-header">
              <span class="depth-icon">&#9672;</span>
              <span class="depth-label">Deep</span>
            </span>
            <span class="depth-desc">Full-text analysis, comprehensive insights</span>
          </span>
        </label>
      </div>
    </div>
  </div>

  <!-- Advanced Options (Collapsible) -->
  <div class="advanced-section" class:expanded={advancedExpanded}>
    <button
      type="button"
      class="advanced-toggle"
      aria-expanded={advancedExpanded}
      onclick={() => advancedExpanded = !advancedExpanded}
    >
      <span class="toggle-text">Advanced Options</span>
      <span class="toggle-icon">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
    </button>

    <div class="advanced-content">
      <div class="advanced-inner">
        <!-- Analysis Types -->
        <div class="form-group types-group">
          <div class="label-row">
            <label class="form-label">Analysis Types</label>
            <Tooltip content="Select which types of analysis to perform. All enabled by default for comprehensive results." position="top" />
          </div>
          <div class="checkbox-row">
            <label class="checkbox-item">
              <input type="checkbox" name="analysisTypes" value="gaps" bind:checked={analysisTypes.gaps} />
              <span class="checkbox-box">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </span>
              <span class="checkbox-label">
                <span class="checkbox-title">Gap Detection</span>
                <Tooltip content="Identifies under-researched areas, temporal gaps, and methodological gaps in the literature." position="top" />
              </span>
            </label>
            <label class="checkbox-item">
              <input type="checkbox" name="analysisTypes" value="comparisons" bind:checked={analysisTypes.comparisons} />
              <span class="checkbox-box">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </span>
              <span class="checkbox-label">
                <span class="checkbox-title">Methodology Compare</span>
                <Tooltip content="Analyzes how different papers approach similar problems and highlights contradictions." position="top" />
              </span>
            </label>
            <label class="checkbox-item">
              <input type="checkbox" name="analysisTypes" value="directions" bind:checked={analysisTypes.directions} />
              <span class="checkbox-box">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </span>
              <span class="checkbox-label">
                <span class="checkbox-title">Research Directions</span>
                <Tooltip content="AI generates novel research opportunities based on identified gaps and trends." position="top" />
              </span>
            </label>
          </div>
          {#if typesError}
            <span class="form-error visible">{typesError}</span>
          {/if}
        </div>

        <!-- Papers & Year Row -->
        <div class="form-row">
          <div class="form-group papers-group">
            <div class="label-row">
              <label for="gap-papers" class="form-label">Papers to Analyze</label>
              <Tooltip content="10-100 papers. More papers = comprehensive analysis but longer processing time. 30 is a good balance." position="top" />
            </div>
            <div class="stepper-input">
              <button type="button" class="stepper-btn minus" aria-label="Decrease" disabled={minusBtnDisabled} onclick={decreasePapers}>&minus;</button>
              <input
                type="number"
                id="gap-papers"
                name="papers"
                bind:value={papers}
                min={10}
                max={100}
                step={10}
                class="stepper-value"
              />
              <button type="button" class="stepper-btn plus" aria-label="Increase" disabled={plusBtnDisabled} onclick={increasePapers}>+</button>
            </div>
          </div>

          <div class="form-group year-group">
            <div class="label-row">
              <label for="gap-year" class="form-label">Year Filter</label>
              <Tooltip content="Limit analysis to specific years (e.g., '2020-2024'). Leave empty to analyze all available papers." position="top" />
            </div>
            <input
              type="text"
              id="gap-year"
              name="yearFilter"
              placeholder="e.g., 2020-2024"
              pattern={'[0-9]{4}-[0-9]{4}'}
              class="form-input year-input"
              class:invalid={yearInvalid}
              bind:value={yearFilter}
            />
            {#if yearError}
              <span class="form-error visible">{yearError}</span>
            {/if}
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Submit Section -->
  <div class="form-actions">
    <div class="time-estimate">
      <span class="estimate-icon">&#9201;</span>
      <span class="estimate-text">Estimated time: <strong>{timeEstimate}</strong></span>
    </div>
    <button type="submit" class="submit-btn" class:loading={isSubmitting} disabled={isSubmitting}>
      <span class="btn-text">Start Analysis</span>
      <span class="btn-shortcut">Ctrl+Enter</span>
      <span class="btn-icon">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M4 10h12M12 6l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
      <span class="btn-loader"></span>
    </button>
  </div>
</form>

<style>
  .gap-form {
    width: 100%;
  }

  .form-main {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  /* Label Row */
  .label-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .form-label {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-gap-text-secondary);
    margin: 0;
  }

  .form-hint {
    font-size: 0.8125rem;
    color: var(--color-gap-text-secondary);
    opacity: 0.7;
  }

  .form-error {
    display: none;
    font-size: 0.8125rem;
    color: var(--color-error);
    margin-top: 0.375rem;
  }

  .form-error.visible {
    display: block;
  }

  /* Topic Input */
  .input-wrapper {
    position: relative;
  }

  .topic-input {
    width: 100%;
    padding: 1rem 1.25rem;
    font-size: 1.125rem;
    background: var(--color-gap-surface);
    border: 2px solid var(--color-gap-border);
    border-radius: var(--radius-lg);
    color: var(--color-gap-text);
    transition: all 0.2s ease;
  }

  .topic-input:focus {
    border-color: var(--color-gap-accent);
    box-shadow: 0 0 0 4px rgba(43, 90, 74, 0.1);
    outline: none;
  }

  .topic-input.invalid {
    border-color: var(--color-error);
  }

  .topic-input.invalid:focus {
    box-shadow: 0 0 0 4px rgba(155, 68, 68, 0.1);
  }

  .topic-input::placeholder {
    color: var(--color-gap-text-secondary);
    opacity: 0.5;
  }

  .input-accent {
    position: absolute;
    bottom: 0;
    left: 1rem;
    right: 1rem;
    height: 2px;
    background: linear-gradient(90deg, var(--color-gap-accent), var(--color-gap-accent-light));
    transform: scaleX(0);
    transform-origin: left;
    transition: transform 0.3s ease;
  }

  .topic-input:focus ~ .input-accent {
    transform: scaleX(1);
  }

  .input-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 0.375rem;
  }

  .char-count {
    font-size: 0.75rem;
    color: var(--color-gap-text-muted);
    font-variant-numeric: tabular-nums;
  }

  /* Depth Toggle */
  .depth-toggle {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }

  @media (max-width: 480px) {
    .depth-toggle {
      grid-template-columns: 1fr;
    }
  }

  .depth-option {
    cursor: pointer;
  }

  .depth-option input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .depth-content {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding: 1rem 1.25rem;
    background: var(--color-gap-surface);
    border: 2px solid var(--color-gap-border);
    border-radius: var(--radius-lg);
    transition: all 0.2s ease;
  }

  .depth-option input:checked + .depth-content {
    border-color: var(--color-gap-accent);
    background: rgba(43, 90, 74, 0.05);
  }

  .depth-option:hover .depth-content {
    border-color: var(--color-gap-accent-light);
  }

  .depth-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .depth-icon {
    font-size: 1rem;
  }

  .depth-label {
    font-size: 1rem;
    font-weight: 500;
    color: var(--color-gap-text);
  }

  .depth-desc {
    font-size: 0.8125rem;
    color: var(--color-gap-text-secondary);
  }

  /* Advanced Section */
  .advanced-section {
    margin-top: 1.5rem;
    border-top: 1px solid var(--color-gap-border);
    padding-top: 1rem;
  }

  .advanced-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0.75rem 0;
    background: none;
    border: none;
    cursor: pointer;
    font-family: var(--font-body);
  }

  .toggle-text {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-gap-text-secondary);
    transition: color 0.2s ease;
  }

  .advanced-toggle:hover .toggle-text {
    color: var(--color-gap-accent);
  }

  .toggle-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    color: var(--color-gap-text-muted);
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .advanced-section.expanded .toggle-icon {
    transform: rotate(180deg);
  }

  .advanced-content {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .advanced-section.expanded .advanced-content {
    grid-template-rows: 1fr;
  }

  .advanced-inner {
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    padding-top: 0.5rem;
  }

  /* Checkbox Row */
  .checkbox-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.75rem;
  }

  @media (max-width: 600px) {
    .checkbox-row {
      grid-template-columns: 1fr;
    }
  }

  .checkbox-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    padding: 0.75rem 1rem;
    background: var(--color-gap-surface);
    border: 2px solid var(--color-gap-border);
    border-radius: var(--radius-md);
    transition: all 0.2s ease;
  }

  .checkbox-item:hover {
    border-color: var(--color-gap-accent-light);
  }

  .checkbox-item:has(input:checked) {
    border-color: var(--color-gap-accent);
    background: rgba(43, 90, 74, 0.05);
  }

  .checkbox-item input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .checkbox-box {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    background: var(--color-gap-surface);
    border: 2px solid var(--color-gap-border);
    border-radius: 4px;
    transition: all 0.2s ease;
    color: transparent;
    flex-shrink: 0;
  }

  .checkbox-item input:checked + .checkbox-box {
    background: var(--color-gap-accent);
    border-color: var(--color-gap-accent);
    color: white;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .checkbox-title {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-gap-text);
  }

  /* Form Row */
  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.25rem;
  }

  @media (max-width: 480px) {
    .form-row {
      grid-template-columns: 1fr;
    }
  }

  /* Stepper Input */
  .stepper-input {
    display: flex;
    align-items: center;
    background: var(--color-gap-surface);
    border: 2px solid var(--color-gap-border);
    border-radius: var(--radius-md);
    overflow: hidden;
    height: 44px;
  }

  .stepper-btn {
    width: 40px;
    height: 100%;
    background: none;
    border: none;
    font-size: 1.125rem;
    color: var(--color-gap-text-secondary);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .stepper-btn:hover {
    background: var(--color-gap-bg-deep);
    color: var(--color-gap-accent);
  }

  .stepper-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .stepper-value {
    flex: 1;
    height: 100%;
    text-align: center;
    border: none;
    background: transparent;
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--color-gap-text);
    -moz-appearance: textfield;
    font-family: var(--font-body);
  }

  .stepper-value::-webkit-outer-spin-button,
  .stepper-value::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  /* Year Input */
  .year-input {
    width: 100%;
    height: 44px;
    padding: 0 1rem;
    background: var(--color-gap-surface);
    border: 2px solid var(--color-gap-border);
    border-radius: var(--radius-md);
    font-size: 0.9375rem;
    color: var(--color-gap-text);
    transition: all 0.2s ease;
  }

  .year-input:focus {
    border-color: var(--color-gap-accent);
    outline: none;
  }

  .year-input.invalid {
    border-color: var(--color-error);
  }

  /* Form Actions */
  .form-actions {
    margin-top: 2rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }

  .time-estimate {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: var(--color-gap-text-secondary);
  }

  .estimate-icon {
    font-size: 1rem;
  }

  .estimate-text strong {
    color: var(--color-gap-accent);
    font-weight: 500;
  }

  .submit-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 1rem 2.5rem;
    background: var(--color-gap-accent);
    color: white;
    border: none;
    border-radius: var(--radius-lg);
    font-family: var(--font-body);
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.3s ease;
    position: relative;
    min-width: 200px;
  }

  .submit-btn:hover:not(:disabled) {
    background: var(--color-gap-accent-dark);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(43, 90, 74, 0.3);
  }

  .submit-btn:active:not(:disabled) {
    transform: translateY(0);
  }

  .submit-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }

  .btn-shortcut {
    font-size: 0.6875rem;
    opacity: 0.5;
    font-weight: 400;
    letter-spacing: 0.02em;
  }

  .btn-icon {
    transition: transform 0.2s ease;
  }

  .submit-btn:hover:not(:disabled) .btn-icon {
    transform: translateX(4px);
  }

  .btn-loader {
    display: none;
    width: 20px;
    height: 20px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .submit-btn.loading .btn-text,
  .submit-btn.loading .btn-icon,
  .submit-btn.loading .btn-shortcut {
    display: none;
  }

  .submit-btn.loading .btn-loader {
    display: block;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Gap Autocomplete */
  .gap-autocomplete-dropdown {
    display: none;
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: var(--color-gap-surface);
    border: 2px solid var(--color-gap-border);
    border-top: none;
    border-radius: 0 0 var(--radius-lg) var(--radius-lg);
    box-shadow: 0 8px 24px rgba(20, 26, 24, 0.1);
    z-index: 11;
    max-height: 240px;
    overflow-y: auto;
  }

  .gap-autocomplete-dropdown.visible {
    display: block;
  }

  .gap-ac-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.625rem 1rem;
    cursor: pointer;
    transition: background 0.15s ease;
    border-bottom: 1px solid var(--color-gap-border);
  }

  .gap-ac-item:last-child {
    border-bottom: none;
  }

  .gap-ac-item:hover,
  .gap-ac-item.selected {
    background: var(--color-gap-bg-deep);
  }

  .gap-ac-name {
    font-size: 0.875rem;
    color: var(--color-gap-text);
  }

  .gap-ac-count {
    font-size: 0.6875rem;
    color: var(--color-gap-text-muted);
    white-space: nowrap;
  }

  /* Gap History Dropdown */
  .gap-history-dropdown {
    display: none;
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: var(--color-gap-surface);
    border: 2px solid var(--color-gap-border);
    border-top: none;
    border-radius: 0 0 var(--radius-lg) var(--radius-lg);
    box-shadow: 0 8px 24px rgba(20, 26, 24, 0.1);
    z-index: 10;
    max-height: 200px;
    overflow-y: auto;
  }

  .gap-history-dropdown.visible {
    display: block;
  }

  .gap-history-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--color-gap-border);
  }

  .gap-history-label {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-gap-text-muted);
  }

  .gap-history-clear {
    background: none;
    border: none;
    font-size: 0.6875rem;
    color: var(--color-gap-text-muted);
    cursor: pointer;
    transition: color 0.15s ease;
  }

  .gap-history-clear:hover {
    color: var(--color-error);
  }

  .gap-history-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.625rem 1rem;
    cursor: pointer;
    transition: background 0.15s ease;
    border-bottom: 1px solid var(--color-gap-border);
  }

  .gap-history-item:last-child {
    border-bottom: none;
  }

  .gap-history-item:hover {
    background: var(--color-gap-bg-deep);
  }

  .gap-history-item-text {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .gap-history-topic {
    font-size: 0.875rem;
    color: var(--color-gap-text);
  }

  .gap-history-meta {
    font-size: 0.6875rem;
    color: var(--color-gap-text-muted);
  }

  .gap-history-remove {
    background: none;
    border: none;
    color: var(--color-gap-text-muted);
    cursor: pointer;
    font-size: 1rem;
    padding: 0.25rem;
    line-height: 1;
    border-radius: 4px;
    transition: all 0.15s ease;
  }

  .gap-history-remove:hover {
    color: var(--color-error);
    background: rgba(155, 68, 68, 0.1);
  }
</style>
