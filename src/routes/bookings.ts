import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { authenticate } from "../middleware/auth.js"

export const bookingsRouter = new Hono()

// All booking routes require authentication
bookingsRouter.use("*", authenticate)

const createBookingSchema = z.object({
  venue_id: z.string().uuid(),
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  guest_count: z.number().int().min(1),
  total_price: z.number().min(0),
})

const updateStatusSchema = z.object({
  status: z.enum(["pending", "confirmed", "cancelled"]),
})

// GET /bookings — current user's bookings
bookingsRouter.get("/", async (c) => {
  const user = c.var.user

  const { data, error } = await supabase
    .from("venue_bookings")
    .select("*, venues(id, name, slug, image_url, location, district)")
    .eq("user_id", user.id)
    .order("booking_date", { ascending: false })

  if (error) return c.json({ error: error.message }, 500)

  return c.json({ data })
})

// GET /bookings/:id — single booking (owner or admin)
bookingsRouter.get("/:id", async (c) => {
  const bookingId = c.req.param("id")
  const user = c.var.user

  const { data, error } = await supabase
    .from("venue_bookings")
    .select("*, venues(id, name, slug, image_url, location, district, contact_phone)")
    .eq("id", bookingId)
    .maybeSingle()

  if (error) return c.json({ error: error.message }, 500)
  if (!data) return c.json({ error: "Booking not found" }, 404)

  // Only owner or admin can view
  if (data.user_id !== user.id && user.role !== "admin") {
    return c.json({ error: "Unauthorized" }, 403)
  }

  return c.json({ data })
})

// POST /bookings — create a booking
bookingsRouter.post("/", zValidator("json", createBookingSchema), async (c) => {
  const user = c.var.user
  const body = c.req.valid("json")

  // Check the day is not already booked
  const { data: existing } = await supabase
    .from("venue_bookings")
    .select("id")
    .eq("venue_id", body.venue_id)
    .eq("booking_date", body.booking_date)
    .eq("status", "confirmed")
    .maybeSingle()

  if (existing) {
    return c.json({ error: "This date is already booked" }, 409)
  }

  const { data, error } = await supabase
    .from("venue_bookings")
    .insert({
      ...body,
      user_id: user.id,
      status: "pending",
    })
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 400)

  return c.json({ data }, 201)
})

// PATCH /bookings/:id/status — cancel a booking (owner) or confirm/cancel (admin/provider)
bookingsRouter.patch("/:id/status", zValidator("json", updateStatusSchema), async (c) => {
  const bookingId = c.req.param("id")
  const user = c.var.user
  const { status } = c.req.valid("json")

  // Fetch the booking first
  const { data: booking, error: fetchErr } = await supabase
    .from("venue_bookings")
    .select("id, user_id, status")
    .eq("id", bookingId)
    .maybeSingle()

  if (fetchErr) return c.json({ error: fetchErr.message }, 500)
  if (!booking) return c.json({ error: "Booking not found" }, 404)

  const isOwner = booking.user_id === user.id
  const isAdminOrProvider = user.role === "admin" || user.role === "provider"

  // Customers can only cancel their own bookings
  if (!isAdminOrProvider && !(isOwner && status === "cancelled")) {
    return c.json({ error: "Unauthorized" }, 403)
  }

  const { data, error } = await supabase
    .from("venue_bookings")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", bookingId)
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 400)

  return c.json({ data })
})
