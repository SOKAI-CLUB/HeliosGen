import type { NextRequest } from "next/server";

export const GUEST_MODE = process.env.GUEST_MODE === "true";
export const GUEST_USER_ID = "guest";

export interface ResolvedUser {
  id: string;
  email: string | null;
}

// Returns the guest identity in guest mode, the verified Supabase user otherwise.
export async function resolveUser(req: NextRequest): Promise<ResolvedUser | null> {
  if (GUEST_MODE) return { id: GUEST_USER_ID, email: null };
  const { supabaseAdmin } = await import("./supabase/admin");
  const auth  = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const { data } = await supabaseAdmin.auth.getUser(token);
  if (!data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

// Returns GUEST_USER_ID in guest mode, Supabase user ID otherwise.
export async function resolveUserId(req: NextRequest): Promise<string | null> {
  return (await resolveUser(req))?.id ?? null;
}
