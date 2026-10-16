import { query } from "$lib/server/db";
import { format } from "$lib/format";

export const load = () => ({ value: format(query()) });
