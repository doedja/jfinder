<script lang="ts">
  import { mode } from '$lib/stores/mode';
  import { theme } from '$lib/stores/theme';
  import { searchState } from '$lib/stores/search';
  import { gapState } from '$lib/stores/gap';
  import ModeToggle from '$lib/components/ModeToggle.svelte';
  import SearchForm from '$lib/components/SearchForm.svelte';
  import ProgressTracker from '$lib/components/ProgressTracker.svelte';
  import ResultsDisplay from '$lib/components/ResultsDisplay.svelte';
  import GapAnalysisForm from '$lib/components/GapAnalysisForm.svelte';
  import GapProgressTracker from '$lib/components/GapProgressTracker.svelte';
  import GapResults from '$lib/components/GapResults.svelte';

  let gapFormVisible = $state(true);

  function handleSearchStarted(taskId: string) {
    searchState.startSearch(taskId);
  }

  function handleAnalysisStarted(taskId: string, topic: string) {
    gapState.startAnalysis(taskId, topic);
    gapFormVisible = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    // Ctrl+Enter: Submit active form
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      if ($mode === 'download') {
        const form = document.getElementById('searchForm') as HTMLFormElement;
        const btn = form?.querySelector('.btn-submit') as HTMLButtonElement;
        if (form && btn && !btn.disabled) form.requestSubmit();
      } else {
        const form = document.getElementById('gap-analysis-form') as HTMLFormElement;
        const btn = document.getElementById('gap-submit-btn') as HTMLButtonElement;
        if (form && btn && !btn.disabled) form.requestSubmit();
      }
    }

    // Escape: Close modals or autocomplete
    if (e.key === 'Escape') {
      const modals = document.querySelectorAll('.refine-modal.active, .download-progress-modal.active, .related-papers-modal.active');
      if (modals.length > 0) {
        modals.forEach(m => m.classList.remove('active'));
        return;
      }
      const dropdowns = document.querySelectorAll('.autocomplete-dropdown, .gap-autocomplete-dropdown');
      dropdowns.forEach(d => { (d as HTMLElement).style.display = 'none'; });
    }

    // Alt+T: Switch modes
    if (e.altKey && e.key === 't') {
      e.preventDefault();
      mode.set($mode === 'download' ? 'gap' : 'download');
    }
  }

  // Reset gap form visibility when gap state resets
  $effect(() => {
    if ($gapState.status === 'idle') {
      gapFormVisible = true;
    }
  });
</script>

<svelte:head>
  <title>JFinder — Research Paper & Gap Finder</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<main class="main" data-mode={$mode}>
  <!-- Header -->
  <header class="header">
    <div class="header-inner container">
      <div class="header-left">
        <div class="header-brand">
          <span class="brand-symbol">◈</span>
          <span class="brand-name">JFinder</span>
        </div>
        <nav class="header-nav">
          <a href="/features" class="nav-link">Features</a>
        </nav>
      </div>
      <div class="header-right">
        <button class="theme-toggle" type="button" aria-label="Toggle dark mode" title="Toggle dark mode" onclick={() => theme.toggle()}>
          <svg class="theme-icon theme-icon-light" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="5"/>
            <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
            <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
          <svg class="theme-icon theme-icon-dark" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
        </button>
        <ModeToggle />
      </div>
    </div>
  </header>

  <!-- Content Area -->
  <div class="content-wrapper">
    <!-- Paper Finder Mode -->
    {#if $mode === 'download'}
      <section class="mode-content active">
        <div class="container">
          <div class="hero animate-slide-up">
            <h1 class="hero-title">Find & Download<br/>Research Papers</h1>
            <p class="hero-subtitle">AI-powered discovery meets automated retrieval</p>
          </div>

          {#if $searchState.status === 'idle'}
            <div class="search-card card animate-slide-up delay-3">
              <div class="search-card-header">
                <span class="search-card-label">Begin Search</span>
              </div>
              <div class="search-card-body">
                <SearchForm onSearchStarted={handleSearchStarted} />
              </div>
            </div>
          {:else if $searchState.status === 'searching'}
            <div class="results-area">
              <ProgressTracker taskId={$searchState.taskId!} />
            </div>
          {:else if $searchState.status === 'complete'}
            <div class="results-area">
              <ResultsDisplay taskId={$searchState.taskId!} />
            </div>
          {/if}
        </div>
      </section>
    {/if}

    <!-- Gap Analysis Mode -->
    {#if $mode === 'gap'}
      <section class="mode-content active">
        <div class="container">
          <div class="hero animate-slide-up">
            <h1 class="hero-title">Research Gap Finder</h1>
            <p class="hero-subtitle">AI-powered analysis to identify unexplored areas and discover research opportunities</p>
          </div>

          {#if $gapState.status === 'idle' && gapFormVisible}
            <div class="gap-form-card card animate-slide-up delay-2">
              <div class="gap-form-wrapper">
                <GapAnalysisForm onAnalysisStarted={handleAnalysisStarted} />
              </div>
            </div>
          {:else if $gapState.status === 'analyzing'}
            <div class="gap-results-area">
              <GapProgressTracker taskId={$gapState.taskId!} topic={$gapState.topic!} />
            </div>
          {:else if $gapState.status === 'complete'}
            <div class="gap-results-area">
              <GapResults taskId={$gapState.taskId!} topic={$gapState.topic!} />
            </div>
          {:else if $gapState.status === 'error'}
            <div class="gap-form-card card animate-slide-up delay-2">
              <div class="gap-form-wrapper">
                <GapAnalysisForm onAnalysisStarted={handleAnalysisStarted} />
              </div>
            </div>
          {/if}
        </div>
      </section>
    {/if}
  </div>

  <!-- Footer -->
  <footer class="footer">
    <div class="container footer-inner">
      <div class="footer-brand">JFinder</div>
      <div class="footer-meta">
        <span class="footer-copyright">&copy; 2025</span>
        <span class="footer-divider">&middot;</span>
        <a href="https://jfinder.doedja.com" class="footer-link">jfinder.doedja.com</a>
        <span class="footer-divider">&middot;</span>
        <a href="https://github.com/doedja/jfinder" class="footer-link" target="_blank" rel="noopener">GitHub</a>
      </div>
    </div>
  </footer>
</main>

<style>
  .main {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--color-bg);
    transition: background-color 0.6s ease;
  }

  .main[data-mode="gap"] {
    background: var(--color-gap-bg);
  }

  .header {
    padding: 1rem 0;
    border-bottom: 1px solid var(--color-border-light);
    transition: border-color 0.6s ease;
  }

  .main[data-mode="gap"] .header {
    border-color: var(--color-gap-border);
  }

  .header-inner {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 1.5rem;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .theme-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .theme-toggle:hover {
    color: var(--color-accent);
    border-color: var(--color-text-muted);
    background: var(--color-bg-warm);
  }

  .main[data-mode="gap"] .theme-toggle:hover {
    color: var(--color-gap-accent);
  }

  .theme-icon-dark {
    display: none;
  }

  :global([data-theme="dark"]) .theme-icon-light {
    display: none;
  }

  :global([data-theme="dark"]) .theme-icon-dark {
    display: block;
  }

  .header-brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .header-nav {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .nav-link {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
    text-decoration: none;
    transition: color 0.2s ease;
  }

  .nav-link:hover {
    color: var(--color-accent);
  }

  .main[data-mode="gap"] .nav-link:hover {
    color: var(--color-gap-accent);
  }

  .brand-symbol {
    font-size: 1.5rem;
    color: var(--color-accent);
    transition: color 0.6s ease;
  }

  .main[data-mode="gap"] .brand-symbol {
    color: var(--color-gap-accent);
  }

  .brand-name {
    font-family: var(--font-display);
    font-size: 1.25rem;
    color: var(--color-text);
    transition: color 0.6s ease;
  }

  .main[data-mode="gap"] .brand-name {
    color: var(--color-gap-text);
  }

  .content-wrapper {
    position: relative;
  }

  .mode-content {
    padding: var(--space-2xl) 0 var(--space-xl);
    animation: contentFadeIn 0.5s ease;
  }

  @keyframes contentFadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .hero {
    text-align: center;
    margin-bottom: var(--space-xl);
    opacity: 0;
  }

  .hero-title {
    font-family: var(--font-display);
    font-size: clamp(2rem, 5vw, 3rem);
    color: var(--color-text);
    margin-bottom: var(--space-md);
    letter-spacing: -0.02em;
    line-height: 1.1;
    transition: color 0.6s ease;
  }

  .main[data-mode="gap"] .hero-title {
    color: var(--color-gap-text);
  }

  .hero-subtitle {
    font-size: 1.0625rem;
    color: var(--color-text-secondary);
    transition: color 0.6s ease;
  }

  .main[data-mode="gap"] .hero-subtitle {
    color: var(--color-gap-text-secondary);
  }

  .search-card,
  .gap-form-card {
    overflow: hidden;
    opacity: 0;
    transition: border-color 0.6s ease, box-shadow 0.6s ease;
  }

  .main[data-mode="gap"] :global(.card) {
    border-color: var(--color-gap-border);
  }

  .search-card-header {
    padding: var(--space-md) var(--space-xl);
    background: var(--color-bg-warm);
    border-bottom: 1px solid var(--color-border-light);
    transition: background-color 0.6s ease, border-color 0.6s ease;
  }

  .search-card-label {
    font-size: 0.75rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-text-muted);
    transition: color 0.6s ease;
  }

  .search-card-body {
    padding: var(--space-xl);
  }

  .gap-form-wrapper {
    padding: var(--space-xl);
  }

  .results-area,
  .gap-results-area {
    display: flex;
    flex-direction: column;
    gap: var(--space-lg);
    margin-top: var(--space-xl);
  }

  .footer {
    padding: var(--space-lg) 0;
    margin-top: auto;
    border-top: 1px solid var(--color-border-light);
    transition: border-color 0.6s ease;
  }

  .main[data-mode="gap"] .footer {
    border-color: var(--color-gap-border);
  }

  .footer-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.375rem;
  }

  .footer-brand {
    font-family: var(--font-display);
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text);
    transition: color 0.6s ease;
  }

  .main[data-mode="gap"] .footer-brand {
    color: var(--color-gap-text);
  }

  .footer-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8125rem;
    color: var(--color-text-muted);
    transition: color 0.6s ease;
  }

  .main[data-mode="gap"] .footer-meta {
    color: var(--color-gap-text-secondary);
  }

  .footer-divider {
    opacity: 0.5;
  }

  .footer-link {
    color: var(--color-text-secondary);
    text-decoration: none;
    transition: color 0.2s ease;
  }

  .footer-link:hover {
    color: var(--color-accent);
  }

  .main[data-mode="gap"] .footer-link:hover {
    color: var(--color-gap-accent);
  }

  @media (max-width: 640px) {
    .header {
      padding: 0.75rem 0;
    }

    .mode-content {
      padding: var(--space-xl) 0 var(--space-lg);
    }

    .search-card-body,
    .gap-form-wrapper {
      padding: var(--space-lg);
    }
  }
</style>
