import { round } from "#lib/util.js";

export function createOrder(amount: number) {
  return validate(amount) ? round(amount) : 0;
}

function validate(amount: number) {
  return amount > 0 && amount < 10;
}
