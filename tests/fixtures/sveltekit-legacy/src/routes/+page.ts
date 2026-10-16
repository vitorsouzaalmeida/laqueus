import { PUBLIC_NAME } from "$env/static/public";
import { round } from "$lib/util";

export const load = () => ({ value: round(1), name: PUBLIC_NAME });
