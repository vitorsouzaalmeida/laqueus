<script>
  import { counter } from "$lib/counter.svelte.js";
  import { round } from "$lib/util.js";

  export let path = "";
</script>

<p>{path} {round(counter.value)}</p>
