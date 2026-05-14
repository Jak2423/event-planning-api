export interface AuthUser {
  id: string
  email: string | undefined
  role: "customer" | "provider" | "admin" | "authenticated"
  userType?: string
}

declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser
  }
}
