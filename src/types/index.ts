export interface AuthUser {
  id: string
  email: string | undefined
  role: "customer" | "provider" | "admin" | "authenticated"
}

// Extend Hono context variables
declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser
  }
}
