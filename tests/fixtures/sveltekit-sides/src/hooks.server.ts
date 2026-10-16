import { query } from "$lib/server/db";

export const handle = async ({ event, resolve }: { event: unknown; resolve: (event: unknown) => unknown }) => {
  query();
  return resolve(event);
};
