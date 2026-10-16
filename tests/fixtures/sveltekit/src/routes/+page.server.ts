import { createOrder } from "#lib/orders.js";

export const load = async () => ({ order: createOrder(1) });
