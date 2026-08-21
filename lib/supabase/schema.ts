/**
 * Database schema used by Supabase Data API queries.
 *
 * A dedicated Supabase project uses the standard `public` schema by default,
 * while still allowing self-hosters to override it through the environment.
 */
export const SUPABASE_SCHEMA =
  process.env.NEXT_PUBLIC_SUPABASE_SCHEMA?.trim() || "public";
