import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { authenticate, requireProvider } from "../middleware/auth.js"

export const venuesRouter = new Hono()

const SORT_MAP: Record<string, { column: string; ascending: boolean }> = {
  rating:     { column: "rating",          ascending: false },
  newest:     { column: "created_at",      ascending: false },
  price_asc:  { column: "price_per_person", ascending: true  },
  price_desc: { column: "price_per_person", ascending: false },
  name:       { column: "name",            ascending: true  },
}

const listQuerySchema = z.object({
  // category filters — pass slug OR uuid
  category:   z.string().optional(),   // slug
  categoryId: z.string().uuid().optional(), // uuid
  district:   z.string().optional(),
  capacity:   z.coerce.number().optional(),
  minPrice:   z.coerce.number().optional(),
  maxPrice:   z.coerce.number().optional(),
  search:     z.string().optional(),
  featured:   z.coerce.boolean().optional(),
  sort:       z.enum(["rating", "newest", "price_asc", "price_desc", "name"]).default("rating"),
  page:       z.coerce.number().min(1).default(1),
  limit:      z.coerce.number().min(1).max(50).default(12),
})

// GET /venues — public listing with filters
venuesRouter.get("/", zValidator("query", listQuerySchema), async (c) => {
  const { category, categoryId, district, capacity, minPrice, maxPrice, search, featured, sort, page, limit } = c.req.valid("query")
  const offset = (page - 1) * limit
  const sortOpt = SORT_MAP[sort]

  let query = supabase
    .from("venues")
    .select(
      "id, slug, name, short_description, location, district, capacity_min, capacity_max, price_per_person, rating, review_count, image_url, images, is_featured, is_new, created_at, categories(id, slug, name)",
      { count: "exact" }
    )
    .order(sortOpt.column, { ascending: sortOpt.ascending })
    .range(offset, offset + limit - 1)

  if (categoryId) {
    query = query.eq("category_id", categoryId)
  } else if (category) {
    // Resolve slug → id first
    const { data: cat } = await supabase
      .from("categories")
      .select("id")
      .eq("slug", category)
      .maybeSingle()
    if (cat?.id) query = query.eq("category_id", cat.id)
  }

  if (district) query = query.ilike("district", `%${district}%`)
  if (capacity) query = query.lte("capacity_min", capacity).gte("capacity_max", capacity)
  if (minPrice != null) query = query.gte("price_per_person", minPrice)
  if (maxPrice != null) query = query.lte("price_per_person", maxPrice)
  if (featured) query = query.eq("is_featured", true)
  if (search) {
    query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%,location.ilike.%${search}%`)
  }

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

// GET /venues/:slug — public single venue
venuesRouter.get("/:slug", async (c) => {
  const slug = c.req.param("slug")

  const { data, error } = await supabase
    .from("venues")
    .select("*, categories(slug, name)")
    .eq("slug", slug)
    .maybeSingle()

  if (error) return c.json({ error: error.message }, 500)
  if (!data) return c.json({ error: "Venue not found" }, 404)

  return c.json({ data })
})

// GET /venues/:id/availability — time slots + bookings for a month
venuesRouter.get("/:id/availability", async (c) => {
  const venueId = c.req.param("id")
  const month = c.req.query("month") // e.g. "2026-05"

  let startDate: string
  let endDate: string

  if (month) {
    const [year, mon] = month.split("-").map(Number)
    startDate = new Date(year, mon - 1, 1).toISOString().split("T")[0]
    endDate = new Date(year, mon, 0).toISOString().split("T")[0]
  } else {
    const now = new Date()
    startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0]
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0]
  }

  const [{ data: slots, error: slotsErr }, { data: bookings, error: bookingsErr }] = await Promise.all([
    supabase.from("venue_time_slots").select("*").eq("venue_id", venueId),
    supabase
      .from("venue_bookings")
      .select("id, booking_date, status")
      .eq("venue_id", venueId)
      .gte("booking_date", startDate)
      .lte("booking_date", endDate)
      .eq("status", "confirmed"),
  ])

  if (slotsErr || bookingsErr) {
    return c.json({ error: slotsErr?.message ?? bookingsErr?.message }, 500)
  }

  return c.json({ data: { slots, bookings, startDate, endDate } })
})

// POST /venues — provider creates a venue (auth required)
venuesRouter.post("/", authenticate, requireProvider, async (c) => {
  const body = await c.req.json()
  const user = c.var.user

  const { data, error } = await supabase
    .from("venues")
    .insert({ ...body, provider_id: user.id })
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 400)

  return c.json({ data }, 201)
})

// PATCH /venues/:id — provider updates their own venue
venuesRouter.patch("/:id", authenticate, requireProvider, async (c) => {
  const venueId = c.req.param("id")
  const user = c.var.user
  const body = await c.req.json()

  // Providers can only update their own venues; admins can update any
  let query = supabase.from("venues").update(body).eq("id", venueId)
  if (user.role !== "admin") {
    query = query.eq("provider_id", user.id)
  }

  const { data, error } = await query.select().single()

  if (error) return c.json({ error: error.message }, 400)
  if (!data) return c.json({ error: "Venue not found or unauthorized" }, 404)

  return c.json({ data })
})
