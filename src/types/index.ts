export interface AuthUser {
  id: string
  email: string | undefined
  role: "customer" | "provider" | "admin" | "authenticated"
  /** Supabase `user_metadata.user_type` from JWT (e.g. `user` | `provider`) */
  userType?: string
}

// Extend Hono context variables
declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser
  }
}
