import { randomUUID } from "node:crypto"
import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import {
  assertScopedProviderVenueAccess,
  authenticate,
  requireProvider,
} from "../middleware/auth.js"

export const venuesRouter = new Hono()

const SORT_MAP: Record<string, { column: string; ascending: boolean }> = {
  rating: { column: "rating", ascending: false },
  newest: { column: "created_at", ascending: false },
  price_asc: { column: "price_per_person", ascending: true },
  price_desc: { column: "price_per_person", ascending: false },
  name: { column: "name", ascending: true },
}

const listQuerySchema = z.object({
  category: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  /** When set, Bearer token must belong to this provider (or admin). */
  provider_id: z.string().uuid().optional(),
  district: z.string().optional(),
  capacity: z.coerce.number().optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  search: z.string().optional(),
  featured: z.coerce.boolean().optional(),
  sort: z.enum(["rating", "newest", "price_asc", "price_desc", "name"]).default("rating"),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(12),
})

const emptyToUndef = (v: unknown) => (v === "" || v === null ? undefined : v)

const venueWritableBodySchema = z.object({
  name: z.string().trim().min(2, "Нэр хэт богино байна"),
  short_description: z.preprocess(emptyToUndef, z.string().trim().max(500).optional()),
  description: z.preprocess(emptyToUndef, z.string().trim().optional()),
  category_id: z.string().uuid("Ангилал сонгоно уу"),
  location: z.string().trim().min(2, "Байршил оруулна уу"),
  district: z.preprocess(emptyToUndef, z.string().trim().max(200).optional()),
  address: z.preprocess(emptyToUndef, z.string().trim().optional()),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
  capacity_min: z.coerce.number().int().min(1),
  capacity_max: z.coerce.number().int().min(1),
  price_per_person: z.coerce.number().int().min(0),
  contact_phone: z.preprocess(emptyToUndef, z.string().trim().max(50).optional()),
  contact_email: z.preprocess(emptyToUndef, z.string().trim().email().optional()),
  website: z.preprocess(emptyToUndef, z.string().trim().url().optional()),
  amenities: z.array(z.string().trim().min(1)).optional(),
  image_url: z.preprocess(emptyToUndef, z.string().trim().max(2000).optional()),
  images: z.array(z.string().trim().max(2000)).max(20).optional(),
  operating_hours: z.record(z.unknown()).optional(),
})

const createVenueBodySchema = venueWritableBodySchema.refine((data) => data.capacity_max >= data.capacity_min, {
  message: "capacity_max must be >= capacity_min",
  path: ["capacity_max"],
})

const patchVenueBodySchema = venueWritableBodySchema
  .partial()
  .omit({ category_id: true })
  .superRefine((val, ctx) => {
    if (
      val.capacity_min != null &&
      val.capacity_max != null &&
      val.capacity_max < val.capacity_min
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "capacity_max must be >= capacity_min",
        path: ["capacity_max"],
      })
    }
  })

const slugifyAscii = (input: string): string => {
  const s = input
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72)
  return s
}

const generateUniqueVenueSlug = async (name: string): Promise<string> => {
  let base = slugifyAscii(name)
  if (base.length < 3) base = `venue-${randomUUID().slice(0, 8)}`

  let candidate = base
  for (let attempt = 0; attempt < 24; attempt++) {
    const { data: clash } = await supabase.from("venues").select("id").eq("slug", candidate).maybeSingle()
    if (!clash) return candidate
    candidate = `${base}-${randomUUID().slice(0, 8)}`
  }
  return `${base}-${randomUUID().replace(/-/g, "").slice(0, 12)}`
}

// GET /venues — public listing; with `provider_id` + Bearer requires owner (or admin)
venuesRouter.get("/", zValidator("query", listQuerySchema), async (c) => {
  const {
    category,
    categoryId,
    provider_id,
    district,
    capacity,
    minPrice,
    maxPrice,
    search,
    featured,
    sort,
    page,
    limit,
  } = c.req.valid("query")
  const offset = (page - 1) * limit
  const sortOpt = SORT_MAP[sort]

  if (provider_id) {
    await assertScopedProviderVenueAccess(c.req.header("Authorization"), provider_id)
  }

  let query = supabase
    .from("venues")
    .select(
      "id, slug, name, short_description, location, district, capacity_min, capacity_max, price_per_person, rating, review_count, image_url, images, is_featured, is_new, created_at, categories(id, slug, name)",
      { count: "exact" },
    )
    .order(sortOpt.column, { ascending: sortOpt.ascending })
    .range(offset, offset + limit - 1)

  if (provider_id) {
    query = query.eq("provider_id", provider_id)
  }

  if (categoryId) {
    query = query.eq("category_id", categoryId)
  } else if (category) {
    const { data: cat } = await supabase.from("categories").select("id").eq("slug", category).maybeSingle()
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

// POST /venues — providers only: validated body + server-side slug
venuesRouter.post("/", authenticate, requireProvider, zValidator("json", createVenueBodySchema), async (c) => {
  const user = c.var.user
  const body = c.req.valid("json")

  const slug = await generateUniqueVenueSlug(body.name)

  const row = {
    slug,
    provider_id: user.id,
    category_id: body.category_id,
    name: body.name,
    short_description: body.short_description ?? null,
    description: body.description ?? null,
    location: body.location,
    district: body.district ?? null,
    address: body.address ?? null,
    latitude: body.latitude ?? null,
    longitude: body.longitude ?? null,
    capacity_min: body.capacity_min,
    capacity_max: body.capacity_max,
    price_per_person: body.price_per_person,
    contact_phone: body.contact_phone ?? null,
    contact_email: body.contact_email ?? null,
    website: body.website ?? null,
    amenities: body.amenities?.length ? body.amenities : null,
    image_url: body.image_url ?? null,
    images: body.images ?? null,
    operating_hours: body.operating_hours ?? {},
    is_new: true,
  }

  const { data, error } = await supabase.from("venues").insert(row).select("*, categories(slug, name)").single()

  if (error) {
    console.error("venues insert", error)
    return c.json({ error: error.message }, 400)
  }

  return c.json({ data }, 201)
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
  const month = c.req.query("month")

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

// PATCH /venues/:id — provider updates only their rows (admin: any)
venuesRouter.patch("/:id", authenticate, requireProvider, zValidator("json", patchVenueBodySchema), async (c) => {
  const venueId = c.req.param("id")
  const user = c.var.user
  const body = c.req.valid("json")

  const updates: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(body)) {
    if (val !== undefined) updates[key] = val
  }

  if (updates.website === "") updates.website = null
  if ("amenities" in updates && Array.isArray(updates.amenities) && (updates.amenities as string[]).length === 0) {
    updates.amenities = null
  }

  delete updates.slug
  delete updates.provider_id
  delete updates.category_id
  delete updates.rating
  delete updates.review_count

  if (Object.keys(updates).length === 0) {
    return c.json({ error: "Шинэчлэх талбар алга байна" }, 400)
  }

  let qb = supabase.from("venues").update(updates).eq("id", venueId)
  if (user.role !== "admin") {
    qb = qb.eq("provider_id", user.id)
  }

  const { data, error } = await qb.select("*, categories(slug, name)").maybeSingle()

  if (error) return c.json({ error: error.message }, 400)
  if (!data) return c.json({ error: "Venue not found or unauthorized" }, 404)

  return c.json({ data })
})
