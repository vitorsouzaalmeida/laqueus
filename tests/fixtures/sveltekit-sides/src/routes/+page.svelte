<script lang="ts">
  import { format } from "$lib/format";
  let { data } = $props();
</script>

<p>{format(data.value)}</p>
