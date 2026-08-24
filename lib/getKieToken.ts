import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { GUEST_MODE } from "@/lib/guestMode";

export function getSharedKieToken(): string | null {
  const token = process.env.KIE_API_KEY?.trim() ?? "";
  return token && token !== "your_kie_api_key_here" ? token : null;
}

export async function getKieTokenForUser(userId: string): Promise<string | null> {
  if (GUEST_MODE) {
    const { getKieApiToken } = await import("./guest/db");
    return getKieApiToken();
  }
  if (!userId) return null;

  const { data } = await supabaseAdmin
    .from("user_settings")
    .select("kie_api_token")
    .eq("user_id", userId)
    .maybeSingle();

  const personalToken = data?.kie_api_token?.trim();
  if (personalToken) return personalToken;

  return getSharedKieToken();
}

export async function getKieToken(req: Request): Promise<string | null> {
  if (GUEST_MODE) {
    const { getKieApiToken } = await import("./guest/db");
    return getKieApiToken();
  }
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const { data } = await supabaseAdmin.auth.getUser(token);
  const userId = data.user?.id;
  if (!userId) return null;
  return getKieTokenForUser(userId);
}
