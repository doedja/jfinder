<script lang="ts">
  import '../app.css';
  import { theme } from '$lib/stores/theme';

  let { children } = $props();
</script>

<div class="page-wrapper">
  {@render children()}
</div>

<style>
  .page-wrapper {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
</style>
