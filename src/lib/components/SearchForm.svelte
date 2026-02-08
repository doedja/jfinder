<script lang="ts">
  import { searchState } from '$lib/stores/search';
  import { searchHistory } from '$lib/stores/history';

  let { onSearchStarted }: { onSearchStarted?: (taskId: string) => void } = $props();

  // Form field bindings
  let topicValue = $state('');
  let topicDisabled = $state(false);
  let cyclesValue = $state(3);
  let papersValue = $state(20);
  let yearFilter = $state('');
  let downloadType = $state<'full' | 'metadata'>('full');
  let selectedFile = $state<File | null>(null);
  let fileName = $state('');

  // UI state
  let formErrorMessage = $state('');
  let showFormError = $state(false);
  let isSubmitting = $state(false);

  // Autocomplete state
  let suggestions = $state<{ name: string; works: number }[]>([]);
  let showAutocomplete = $state(false);
  let acSelectedIdx = $state(-1);
  let acDebounceTimer: ReturnType<typeof setTimeout>;

  // Search history state
  let showHistory = $state(false);

  // Element refs
  let topicInput: HTMLInputElement;
  let fileInput: HTMLInputElement;
  let formEl: HTMLFormElement;

  function showError(message: string) {
    formErrorMessage = message;
    showFormError = true;
  }

  function hideError() {
    showFormError = false;
    formErrorMessage = '';
  }

  function handleFileChange() {
    hideError();
    if (fileInput?.files && fileInput.files[0]) {
      selectedFile = fileInput.files[0];
      fileName = `Selected: ${fileInput.files[0].name}`;
      topicValue = '';
      topicDisabled = true;
    } else {
      selectedFile = null;
      fileName = '';
      topicDisabled = false;
    }
  }

  function handleTopicInput() {
    hideError();
    if (topicValue) {
      selectedFile = null;
      fileName = '';
      if (fileInput) fileInput.value = '';
    }
    // Hide history when typing
    showHistory = false;

    // Autocomplete
    clearTimeout(acDebounceTimer);
    const q = topicValue.trim();
    if (q.length < 2) {
      showAutocomplete = false;
      return;
    }
    acDebounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`);
        const data: { name: string; works: number }[] = await res.json();
        if (data.length === 0 || topicValue.trim() !== q) {
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
  }

  function handleCyclesChange() {
    if (cyclesValue < 1) cyclesValue = 1;
    if (cyclesValue > 20) cyclesValue = 20;
  }

  function handlePapersChange() {
    if (papersValue < 1) papersValue = 1;
    if (papersValue > 250) papersValue = 250;
  }

  function selectSuggestion(name: string) {
    topicValue = name;
    showAutocomplete = false;
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
      topicValue = suggestions[acSelectedIdx].name;
      showAutocomplete = false;
    } else if (e.key === 'Escape') {
      showAutocomplete = false;
    }
  }

  function handleTopicFocus() {
    let history: typeof $searchHistory;
    const unsub = searchHistory.subscribe(h => (history = h));
    unsub();
    if (history!.length > 0 && !topicValue) {
      showHistory = true;
    }
  }

  function handleTopicBlur() {
    setTimeout(() => {
      showAutocomplete = false;
      showHistory = false;
    }, 200);
  }

  function selectHistoryItem(topic: string, papers: number) {
    topicValue = topic;
    papersValue = papers;
    showHistory = false;
  }

  function removeHistoryEntry(e: MouseEvent, topic: string) {
    e.stopPropagation();
    searchHistory.remove(topic);
  }

  function clearAllHistory(e: MouseEvent) {
    e.stopPropagation();
    searchHistory.clear();
    showHistory = false;
  }

  function formatCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    hideError();

    const topic = topicValue.trim();
    const file = selectedFile;

    if (!topic && !file) {
      showError('Please enter a research topic or upload a DOI file');
      return;
    }

    isSubmitting = true;

    try {
      const formData = new FormData();
      if (topic) formData.append('topic', topic);
      if (file) formData.append('doiFile', file);
      formData.append('cycles', String(cyclesValue));
      formData.append('papers', String(papersValue));
      if (yearFilter.trim()) formData.append('yearFilter', yearFilter.trim());
      formData.append('downloadType', downloadType);

      const response = await fetch('/api/search', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Search failed');
      }

      // Save to search history
      if (topic) {
        searchHistory.add({ topic, papers: papersValue });
      }

      // Notify via store and callback
      searchState.startSearch(data.taskId);
      onSearchStarted?.(data.taskId);
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Search failed');
      isSubmitting = false;
    }
  }

  // Listen for search reset to re-enable form
  $effect(() => {
    const currentState = $searchState;
    if (currentState.status === 'idle') {
      isSubmitting = false;
      topicDisabled = false;
      fileName = '';
      selectedFile = null;
    }
  });
</script>

<form class="search-form" bind:this={formEl} onsubmit={handleSubmit}>
  <div class="form-section">
    <div class="input-group input-group-topic">
      <label for="topic">Research Topic</label>
      <div class="topic-input-wrapper">
        <input
          type="text"
          id="topic"
          name="topic"
          placeholder="e.g., machine learning in drug discovery"
          autocomplete="off"
          bind:this={topicInput}
          bind:value={topicValue}
          disabled={topicDisabled}
          oninput={handleTopicInput}
          onkeydown={handleTopicKeydown}
          onfocus={handleTopicFocus}
          onblur={handleTopicBlur}
        />
        <div class="autocomplete-dropdown" class:visible={showAutocomplete}>
          {#each suggestions as suggestion, i}
            <div
              class="autocomplete-item"
              class:selected={i === acSelectedIdx}
              role="option"
              aria-selected={i === acSelectedIdx}
              onmousedown={(e) => { e.preventDefault(); selectSuggestion(suggestion.name); }}
            >
              <span class="autocomplete-name">{suggestion.name}</span>
              <span class="autocomplete-count">{formatCount(suggestion.works)} papers</span>
            </div>
          {/each}
        </div>
        <div class="search-history-dropdown" class:visible={showHistory}>
          {#if $searchHistory.length > 0}
            <div class="history-header">
              <span class="history-label">Recent Searches</span>
              <button class="history-clear" type="button" onclick={(e) => clearAllHistory(e)}>Clear All</button>
            </div>
            {#each $searchHistory as entry}
              <div
                class="history-item"
                role="button"
                tabindex="-1"
                onclick={() => selectHistoryItem(entry.topic, entry.papers)}
                onkeydown={(e) => { if (e.key === 'Enter') selectHistoryItem(entry.topic, entry.papers); }}
              >
                <div class="history-item-text">
                  <span class="history-topic">{entry.topic}</span>
                  <span class="history-meta">{entry.papers} papers &middot; {new Date(entry.timestamp).toLocaleDateString()}</span>
                </div>
                <button
                  class="history-remove"
                  type="button"
                  title="Remove"
                  onclick={(e) => removeHistoryEntry(e, entry.topic)}
                >&times;</button>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    </div>

    <div class="divider">
      <span class="divider-text">or</span>
    </div>

    <div class="input-group input-group-file">
      <label for="doiFile">DOI List File</label>
      <div class="file-input-wrapper">
        <input
          type="file"
          id="doiFile"
          name="doiFile"
          accept=".txt"
          class="file-input"
          bind:this={fileInput}
          onchange={handleFileChange}
        />
        <label for="doiFile" class="file-input-label">
          <span class="file-icon">&#8593;</span>
          <span class="file-text">Choose .txt file</span>
        </label>
        <span class="file-name" class:active={!!fileName}>{fileName}</span>
      </div>
    </div>
  </div>

  <div class="form-section form-options">
    <div class="options-row">
      <div class="input-group input-group-small">
        <label for="cycles">Search Cycles</label>
        <input
          type="number"
          id="cycles"
          name="cycles"
          bind:value={cyclesValue}
          min="1"
          max="20"
          onchange={handleCyclesChange}
        />
      </div>

      <div class="input-group input-group-small">
        <label for="papers">Max Papers</label>
        <input
          type="number"
          id="papers"
          name="papers"
          bind:value={papersValue}
          min="1"
          max="250"
          onchange={handlePapersChange}
        />
      </div>

      <div class="input-group input-group-small">
        <label for="yearFilter">Year Filter</label>
        <input
          type="text"
          id="yearFilter"
          name="yearFilter"
          placeholder="e.g., 2020-2024"
          bind:value={yearFilter}
        />
      </div>
    </div>

    <div class="download-options">
      <span class="options-label">Download Mode</span>
      <div class="radio-group">
        <label class="radio-option">
          <input type="radio" name="downloadType" value="full" bind:group={downloadType} />
          <span class="radio-custom"></span>
          <span class="radio-label">Full Download</span>
          <span class="radio-hint">Papers + Metadata</span>
        </label>
        <label class="radio-option">
          <input type="radio" name="downloadType" value="metadata" bind:group={downloadType} />
          <span class="radio-custom"></span>
          <span class="radio-label">Metadata Only</span>
          <span class="radio-hint">Faster, no PDFs</span>
        </label>
      </div>
    </div>
  </div>

  <!-- Validation error message -->
  {#if showFormError}
    <div class="form-error">
      <span class="error-icon">!</span>
      <span class="error-text">{formErrorMessage}</span>
    </div>
  {/if}

  <div class="form-actions">
    <button type="submit" class="btn btn-primary btn-submit" disabled={isSubmitting} class:loading={isSubmitting}>
      <span class="btn-content">
        <span class="btn-text">Start Search</span>
        <span class="btn-shortcut">Ctrl+Enter</span>
        <span class="btn-icon">&#8594;</span>
      </span>
      <span class="btn-loader">
        <span class="spinner"></span>
      </span>
    </button>
  </div>
</form>

<style>
  .search-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-xl);
  }

  .form-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-lg);
  }

  .input-group {
    display: flex;
    flex-direction: column;
  }

  .input-group input[type="text"],
  .input-group input[type="number"] {
    background: var(--color-bg);
  }

  .input-group-topic input {
    font-size: 1.125rem;
    padding: var(--space-lg);
  }

  /* Divider */
  .divider {
    display: flex;
    align-items: center;
    gap: var(--space-md);
    color: var(--color-text-muted);
  }

  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--color-border);
  }

  .divider-text {
    font-size: 0.8125rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* File input */
  .file-input-wrapper {
    position: relative;
  }

  .file-input {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .file-input-label {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-md) var(--space-lg);
    background: var(--color-bg);
    border: 1px dashed var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .file-input-label:hover {
    border-color: var(--color-accent);
    background: var(--color-bg-warm);
  }

  .file-input:focus + .file-input-label {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 3px rgba(139, 90, 43, 0.1);
  }

  .file-icon {
    font-size: 1.25rem;
    color: var(--color-accent);
  }

  .file-text {
    color: var(--color-text-secondary);
  }

  .file-name {
    display: none;
    margin-top: var(--space-sm);
    font-size: 0.875rem;
    color: var(--color-text-secondary);
  }

  .file-name.active {
    display: block;
  }

  /* Options */
  .form-options {
    padding: var(--space-lg);
    background: var(--color-bg-warm);
    border-radius: var(--radius-lg);
  }

  .options-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-md);
  }

  @media (max-width: 600px) {
    .options-row {
      grid-template-columns: 1fr;
    }
  }

  .input-group-small input {
    padding: var(--space-sm) var(--space-md);
    text-align: center;
  }

  .download-options {
    margin-top: var(--space-lg);
    padding-top: var(--space-lg);
    border-top: 1px solid var(--color-border);
  }

  .options-label {
    display: block;
    font-size: 0.8125rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--color-text-secondary);
    margin-bottom: var(--space-md);
  }

  .radio-group {
    display: flex;
    gap: var(--space-lg);
  }

  @media (max-width: 480px) {
    .radio-group {
      flex-direction: column;
      gap: var(--space-md);
    }
  }

  .radio-option {
    display: flex;
    align-items: flex-start;
    gap: var(--space-sm);
    cursor: pointer;
    flex: 1;
  }

  .radio-option input {
    position: absolute;
    opacity: 0;
  }

  .radio-custom {
    width: 18px;
    height: 18px;
    border: 2px solid var(--color-border);
    border-radius: 50%;
    transition: all var(--transition-fast);
    flex-shrink: 0;
    margin-top: 2px;
    position: relative;
  }

  .radio-option input:checked + .radio-custom {
    border-color: var(--color-accent);
  }

  .radio-option input:checked + .radio-custom::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 8px;
    height: 8px;
    background: var(--color-accent);
    border-radius: 50%;
  }

  .radio-option input:focus + .radio-custom {
    box-shadow: 0 0 0 3px rgba(139, 90, 43, 0.1);
  }

  .radio-label {
    font-weight: 500;
    color: var(--color-text);
    display: block;
  }

  .radio-hint {
    font-size: 0.8125rem;
    color: var(--color-text-muted);
    display: block;
  }

  /* Form error */
  .form-error {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-md);
    background: rgba(155, 68, 68, 0.1);
    border: 1px solid var(--color-error);
    border-radius: var(--radius-md);
    color: var(--color-error);
    font-size: 0.9375rem;
    animation: slideUpFadeIn 0.3s ease;
  }

  .form-error .error-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    background: var(--color-error);
    color: white;
    border-radius: 50%;
    font-size: 0.75rem;
    font-weight: 700;
    flex-shrink: 0;
  }

  @keyframes slideUpFadeIn {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* Submit button */
  .form-actions {
    display: flex;
    justify-content: flex-end;
  }

  .btn-submit {
    padding: var(--space-md) var(--space-xl);
    font-size: 1rem;
  }

  .btn-submit .btn-shortcut {
    font-size: 0.6875rem;
    opacity: 0.5;
    font-weight: 400;
    letter-spacing: 0.02em;
  }

  .btn-submit .btn-content .btn-icon {
    transition: transform var(--transition-fast);
  }

  .btn-submit:hover .btn-content .btn-icon {
    transform: translateX(4px);
  }

  .btn-submit:disabled {
    pointer-events: none;
  }

  /* Autocomplete */
  .autocomplete-dropdown {
    display: none;
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-top: none;
    border-radius: 0 0 var(--radius-md) var(--radius-md);
    box-shadow: var(--shadow-md);
    z-index: 11;
    max-height: 240px;
    overflow-y: auto;
  }

  .autocomplete-dropdown.visible {
    display: block;
  }

  .autocomplete-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.625rem 1rem;
    cursor: pointer;
    transition: background 0.15s ease;
    border-bottom: 1px solid var(--color-border-light);
  }

  .autocomplete-item:last-child {
    border-bottom: none;
  }

  .autocomplete-item:hover,
  .autocomplete-item.selected {
    background: var(--color-bg-warm);
  }

  .autocomplete-name {
    font-size: 0.875rem;
    color: var(--color-text);
  }

  .autocomplete-count {
    font-size: 0.6875rem;
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  /* Search History */
  .topic-input-wrapper {
    position: relative;
  }

  .search-history-dropdown {
    display: none;
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-top: none;
    border-radius: 0 0 var(--radius-md) var(--radius-md);
    box-shadow: var(--shadow-md);
    z-index: 10;
    max-height: 200px;
    overflow-y: auto;
  }

  .search-history-dropdown.visible {
    display: block;
  }

  .history-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.625rem 1rem;
    cursor: pointer;
    transition: background 0.15s ease;
    border-bottom: 1px solid var(--color-border-light);
  }

  .history-item:last-child {
    border-bottom: none;
  }

  .history-item:hover {
    background: var(--color-bg-warm);
  }

  .history-item-text {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .history-topic {
    font-size: 0.875rem;
    color: var(--color-text);
  }

  .history-meta {
    font-size: 0.6875rem;
    color: var(--color-text-muted);
  }

  .history-remove {
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: 1rem;
    padding: 0.25rem;
    line-height: 1;
    border-radius: 4px;
    transition: all 0.15s ease;
  }

  .history-remove:hover {
    color: var(--color-error);
    background: rgba(155, 68, 68, 0.1);
  }

  .history-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--color-border);
  }

  .history-label {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
  }

  .history-clear {
    background: none;
    border: none;
    font-size: 0.6875rem;
    color: var(--color-text-muted);
    cursor: pointer;
    transition: color 0.15s ease;
  }

  .history-clear:hover {
    color: var(--color-error);
  }
</style>
