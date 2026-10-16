<script lang="ts">
  let { label = "Click" }: { label?: string } = $props();
</script>

<button>{label}</button>
