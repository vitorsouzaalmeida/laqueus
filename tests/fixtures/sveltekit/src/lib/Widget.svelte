<script lang="ts" module>
  export const label = (value?: string) => value ?? "Widget";
</script>

<script lang="ts">
  import { createOrder } from "#lib/orders.js";

  const click = () => {
    createOrder(2);
  };
</script>

<button onclick={click}>{label()}</button>
