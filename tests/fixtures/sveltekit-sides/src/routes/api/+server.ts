import { query } from "$lib/server/db";

export const GET = () => new Response(String(query()));
