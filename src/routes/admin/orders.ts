import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { authenticate, requireAdmin } from "../../middleware/auth.js"

export const adminOrdersRouter = new Hono()

adminOrdersRouter.use("*", authenticate, requireAdmin)

const listQuerySchema = z.object({
  status: z.enum(["pending", "confirmed", "cancelled"]).optional(),
  venue_id: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
})

// GET /admin/orders — all bookings with filters
adminOrdersRouter.get("/", zValidator("query", listQuerySchema), async (c) => {
  const { status, venue_id, from, to, page, limit } = c.req.valid("query")
  const offset = (page - 1) * limit

  let query = supabase
    .from("venue_bookings")
    .select(
      "*, venues(id, name, slug, location, district), users:user_id(id, email)",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq("status", status)
  if (venue_id) query = query.eq("venue_id", venue_id)
  if (from) query = query.gte("booking_date", from)
  if (to) query = query.lte("booking_date", to)

  const { data, error, count } = await query

  if (error) return c.json({ error: error.message }, 500)

  return c.json({
    data,
    meta: {
      total: count ?? 0,
      page,
      limit,
      totalPages: Math.ceil((count ?? 0) / limit),
    },
  })
})

// GET /admin/orders/stats — summary counts and revenue
adminOrdersRouter.get("/stats", async (c) => {
  const [pending, confirmed, cancelled, revenue] = await Promise.all([
    supabase.from("venue_bookings").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("venue_bookings").select("id", { count: "exact", head: true }).eq("status", "confirmed"),
    supabase.from("venue_bookings").select("id", { count: "exact", head: true }).eq("status", "cancelled"),
    supabase.from("venue_bookings").select("total_price").eq("status", "confirmed"),
  ])

  const totalRevenue = (revenue.data ?? []).reduce((sum, b) => sum + (b.total_price ?? 0), 0)

  return c.json({
    data: {
      pending: pending.count ?? 0,
      confirmed: confirmed.count ?? 0,
      cancelled: cancelled.count ?? 0,
      totalRevenue,
    },
  })
})

// PATCH /admin/orders/:id — update booking status
adminOrdersRouter.patch(
  "/:id",
  zValidator("json", z.object({ status: z.enum(["pending", "confirmed", "cancelled"]) })),
  async (c) => {
    const bookingId = c.req.param("id")
    const { status } = c.req.valid("json")

    const { data, error } = await supabase
      .from("venue_bookings")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", bookingId)
      .select()
      .single()

    if (error) return c.json({ error: error.message }, 400)
    if (!data) return c.json({ error: "Booking not found" }, 404)

    return c.json({ data })
  }
)
