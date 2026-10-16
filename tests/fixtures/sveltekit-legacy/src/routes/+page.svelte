<script>
  import { page } from "$app/stores";
  import Widget from "$lib/Widget.svelte";
</script>

<Widget path={$page.url.pathname} />
