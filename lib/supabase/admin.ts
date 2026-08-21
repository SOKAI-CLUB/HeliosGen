import { createClient } from "@supabase/supabase-js";
import { SUPABASE_SCHEMA } from "./schema";

// Service-role client — bypasses RLS. Only used server-side (API routes / middleware).
// Never expose SUPABASE_SERVICE_ROLE_KEY to the browser.
// Lazily initialized so module evaluation during the build phase doesn't require env vars.
function buildClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.SUPABASE_SECRET_KEY ??
      process.env.SUPABASE_SERVICE_ROLE_KEY)!,
    {
      db: { schema: SUPABASE_SCHEMA },
    }
  );
}

type AdminClient = ReturnType<typeof buildClient>;

let _instance: AdminClient | undefined;

function getInstance(): AdminClient {
  if (!_instance) {
    _instance = buildClient();
  }
  return _instance;
}

export const supabaseAdmin: AdminClient = new Proxy({} as AdminClient, {
  get(_t, prop: string | symbol) {
    const val = Reflect.get(getInstance(), prop, getInstance());
    return typeof val === "function" ? val.bind(getInstance()) : val;
  },
});
