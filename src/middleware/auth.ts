import { createMiddleware } from "hono/factory"
import { HTTPException } from "hono/http-exception"
import { supabase } from "../lib/supabase.js"
import type { AuthUser } from "../types/index.js"

// Verifies the Bearer token from Authorization header and sets c.var.user
export const authenticate = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization")

  if (!authHeader?.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "Missing or invalid Authorization header" })
  }

  const token = authHeader.slice(7)
  const { data, error } = await supabase.auth.getUser(token)

  if (error || !data.user) {
    throw new HTTPException(401, { message: "Invalid or expired token" })
  }

  const user = data.user
  const role = (user.app_metadata?.role ?? user.user_metadata?.role ?? "authenticated") as AuthUser["role"]

  c.set("user", {
    id: user.id,
    email: user.email,
    role,
  })

  await next()
})

// Must be used after authenticate — rejects non-admin users
export const requireAdmin = createMiddleware(async (c, next) => {
  const user = c.var.user

  if (!user || user.role !== "admin") {
    throw new HTTPException(403, { message: "Admin access required" })
  }

  await next()
})

// Must be used after authenticate — rejects non-provider users
export const requireProvider = createMiddleware(async (c, next) => {
  const user = c.var.user

  if (!user || (user.role !== "provider" && user.role !== "admin")) {
    throw new HTTPException(403, { message: "Provider access required" })
  }

  await next()
})
