<script lang="ts">
  import Widget from "#lib/Widget.svelte";

  let { data } = $props();

  function onSave(event?: Event) {
    if (event && data) persist();
  }

  function persist() {
    return data?.order ?? null;
  }
</script>

<Widget />
<button onclick={onSave}>Save</button>
<p>{persist()}</p>
