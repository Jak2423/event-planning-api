import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { authenticate } from "../middleware/auth.js"

export const ordersRouter = new Hono()

const orderItemSchema = z.object({
  venueId:      z.string(),
  name:         z.string(),
  providerLabel: z.string(),
  category:     z.string(),
  categoryLabel: z.string(),
  image:        z.string(),
  guestCount:   z.number().int().min(1),
  price:        z.number().min(0),
  bookingDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

const createOrderSchema = z.object({
  form: z.object({
    fullName:      z.string().min(1),
    email:         z.string().email(),
    phone:         z.string().min(1),
    paymentMethod: z.string(),
    notes:         z.string().optional(),
  }),
  items:    z.array(orderItemSchema).min(1),
  subtotal: z.number().min(0),
  total:    z.number().min(0),
})

// POST /orders — create checkout order (auth optional — guest checkout allowed)
ordersRouter.post("/", async (c) => {
  const body = await c.req.json()
  const parsed = createOrderSchema.safeParse(body)

  if (!parsed.success) {
    return c.json({ error: "Мэдээлэл буруу байна. Формоо шалгана уу." }, 400)
  }

  const { form, items, subtotal, total } = parsed.data

  // Guard against price tampering
  const recomputed = items.reduce((s, i) => s + i.price, 0)
  if (recomputed !== subtotal || total !== subtotal) {
    return c.json({ error: "Дүн тохирохгүй байна. Сагсаа дахин ачаална уу." }, 400)
  }

  // Try to get user id from optional Bearer token
  let userId: string | null = null
  const authHeader = c.req.header("Authorization")
  if (authHeader?.startsWith("Bearer ")) {
    const { data } = await supabase.auth.getUser(authHeader.slice(7))
    userId = data.user?.id ?? null
  }

  const { data, error } = await supabase
    .from("orders")
    .insert({
      user_id:          userId,
      customer_name:    form.fullName.trim(),
      customer_email:   form.email.trim().toLowerCase(),
      customer_phone:   form.phone.trim(),
      payment_method:   form.paymentMethod,
      notes:            form.notes?.trim() || null,
      items,
      subtotal,
      total,
      status:           "pending",
    })
    .select("id")
    .single()

  if (error) {
    console.error("orders insert", error)
    return c.json({ error: "Захиалга хадгалагдаагүй байна." }, 500)
  }

  return c.json({ data: { orderId: data.id } }, 201)
})

// GET /orders/:id — fetch order (auth required — owner or admin)
ordersRouter.get("/:id", authenticate, async (c) => {
  const orderId = c.req.param("id")
  const user = c.var.user

  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle()

  if (error) return c.json({ error: error.message }, 500)
  if (!data) return c.json({ error: "Order not found" }, 404)

  if (data.user_id && data.user_id !== user.id && user.role !== "admin") {
    return c.json({ error: "Unauthorized" }, 403)
  }

  return c.json({ data })
})
