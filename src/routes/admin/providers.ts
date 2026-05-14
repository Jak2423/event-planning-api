import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { authenticate, mapSupabaseUserToAuthUser, requireAdmin } from "../../middleware/auth.js"

export const adminProvidersRouter = new Hono()

adminProvidersRouter.use("*", authenticate, requireAdmin)

// GET /admin/providers — list all providers with their venue counts
adminProvidersRouter.get("/", async (c) => {
  // Fetch users with provider role via app_metadata
  const { data: { users }, error } = await supabase.auth.admin.listUsers()

  if (error) return c.json({ error: error.message }, 500)

  const providers = users.filter((u) => mapSupabaseUserToAuthUser(u).role === "provider")

  // Fetch venue counts per provider
  const providerIds = providers.map(p => p.id)
  const { data: venues } = await supabase
    .from("venues")
    .select("id, provider_id, name, slug, is_featured")
    .in("provider_id", providerIds)

  const result = providers.map(p => ({
    id: p.id,
    email: p.email,
    created_at: p.created_at,
    verified: p.app_metadata?.provider_verified ?? false,
    venues: (venues ?? []).filter(v => v.provider_id === p.id),
  }))

  return c.json({ data: result })
})

// GET /admin/providers/:id — single provider detail
adminProvidersRouter.get("/:id", async (c) => {
  const providerId = c.req.param("id")

  const { data: { user }, error } = await supabase.auth.admin.getUserById(providerId)

  if (error || !user) return c.json({ error: "Provider not found" }, 404)

  const { data: venues } = await supabase
    .from("venues")
    .select("id, name, slug, rating, review_count, price_per_person, is_featured, created_at")
    .eq("provider_id", providerId)

  const { data: bookings } = await supabase
    .from("venue_bookings")
    .select("id, status, booking_date, total_price, venues!inner(provider_id)")
    .eq("venues.provider_id", providerId)
    .order("booking_date", { ascending: false })
    .limit(50)

  return c.json({
    data: {
      id: user.id,
      email: user.email,
      created_at: user.created_at,
      verified: user.app_metadata?.provider_verified ?? false,
      venues: venues ?? [],
      recentBookings: bookings ?? [],
    },
  })
})

// PATCH /admin/providers/:id/verify — approve or revoke provider
adminProvidersRouter.patch(
  "/:id/verify",
  zValidator("json", z.object({ verified: z.boolean() })),
  async (c) => {
    const providerId = c.req.param("id")
    const { verified } = c.req.valid("json")

    const { data: { user }, error } = await supabase.auth.admin.updateUserById(providerId, {
      app_metadata: { role: "provider", provider_verified: verified },
    })

    if (error || !user) return c.json({ error: error?.message ?? "Update failed" }, 400)

    return c.json({
      data: {
        id: user.id,
        email: user.email,
        verified,
      },
    })
  }
)

// PATCH /admin/providers/:id/role — promote user to provider or demote
adminProvidersRouter.patch(
  "/:id/role",
  zValidator("json", z.object({ role: z.enum(["customer", "provider", "admin"]) })),
  async (c) => {
    const userId = c.req.param("id")
    const { role } = c.req.valid("json")

    const { data: { user }, error } = await supabase.auth.admin.updateUserById(userId, {
      app_metadata: { role },
    })

    if (error || !user) return c.json({ error: error?.message ?? "Update failed" }, 400)

    return c.json({ data: { id: user.id, email: user.email, role } })
  }
)
