import { createClient, SupabaseClient, User } from "https://esm.sh/@supabase/supabase-js@2";

export type AuthResult = {
  user: User;
  supabase: SupabaseClient;
  serviceClient: SupabaseClient;
};

/**
 * Validate the Authorization header and return both a user-scoped client
 * (for RLS queries as the user) and a service-role client (for admin writes
 * like usage logging and subscription management).
 */
export async function authenticateUser(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    throw new AuthError("Missing authorization header", 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  // User-scoped client (respects RLS)
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    throw new AuthError("Unauthorized", 401);
  }

  // Service-role client (bypasses RLS — for admin writes)
  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

  return { user, supabase, serviceClient };
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
