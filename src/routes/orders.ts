import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';

export const ordersRouter = new Hono();

const orderItemSchema = z.object({
	venueId: z.string(),
	name: z.string(),
	providerLabel: z.string(),
	category: z.string(),
	categoryLabel: z.string(),
	image: z.string().optional().default(''),
	guestCount: z.number().int().min(1),
	price: z.number().min(0),
	bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const createOrderSchema = z.object({
	form: z.object({
		fullName: z.string().min(1),
		email: z.string().email(),
		phone: z.string().min(1),
		paymentMethod: z.string(),
		notes: z.string().optional(),
	}),
	items: z.array(orderItemSchema).min(1),
	subtotal: z.number().min(0),
	total: z.number().min(0),
});

const orderListQuerySchema = z.object({
	page: z.coerce.number().min(1).default(1),
	limit: z.coerce.number().min(1).max(100).default(20),
	status: z.string().min(1).optional(),
});

const orderIdParamSchema = z.object({
	id: z.string().uuid(),
});

ordersRouter.post('/make-order', authenticate, async (c) => {
	const user = c.var.user;

	const body = await c.req.json();
	const parsed = createOrderSchema.safeParse(body);

	if (!parsed.success) {
		return c.json({ error: 'Мэдээлэл буруу байна. Формоо шалгана уу.' }, 400);
	}

	const { form, items, subtotal, total } = parsed.data;

	const recomputed = items.reduce((s, i) => s + i.price, 0);
	if (recomputed !== subtotal || total !== subtotal) {
		return c.json({ error: 'Дүн тохирохгүй байна. Сагсаа дахин ачаална уу.' }, 400);
	}

	const { data, error } = await supabase
		.from('orders')
		.insert({
			user_id: user.id,
			customer_name: form.fullName.trim(),
			customer_email: form.email.trim().toLowerCase(),
			customer_phone: form.phone.trim(),
			payment_method: form.paymentMethod,
			notes: form.notes?.trim() || null,
			items,
			subtotal,
			total,
			status: 'pending',
		})
		.select('*')
		.single();

	if (error) {
		console.error('orders insert', error);
		return c.json({ error: 'Захиалга хадгалагдаагүй байна.' }, 500);
	}

	return c.json({ data: { orderId: data.id, order: data } }, 201);
});

ordersRouter.get('/', authenticate, zValidator('query', orderListQuerySchema), async (c) => {
	const user = c.var.user;
	const { page, limit, status } = c.req.valid('query');
	const offset = (page - 1) * limit;

	let query = supabase
		.from('orders')
		.select('id, status, total, subtotal, created_at, customer_name, payment_method', {
			count: 'exact',
		})
		.eq('user_id', user.id)
		.order('created_at', { ascending: false })
		.range(offset, offset + limit - 1);

	if (status) query = query.eq('status', status);

	const { data, error, count } = await query;

	if (error) {
		console.error('orders list', error);
		return c.json({ error: 'Захиалгууд ачааллаагүй байна.' }, 500);
	}

	const total = count ?? 0;

	return c.json({
		data: data ?? [],
		meta: {
			total,
			page,
			limit,
			totalPages: Math.ceil(total / limit),
		},
	});
});

ordersRouter.get('/:id', authenticate, zValidator('param', orderIdParamSchema), async (c) => {
	const orderId = c.req.valid('param').id;
	const user = c.var.user;

	const { data, error } = await supabase
		.from('orders')
		.select('*')
		.eq('id', orderId)
		.maybeSingle();

	if (error) {
		console.error('orders detail', error);
		return c.json({ error: 'Захиалга ачааллаагүй байна.' }, 500);
	}
	if (!data) return c.json({ error: 'Order not found' }, 404);

	if (user.role === 'admin') {
		return c.json({ data });
	}

	if (data.user_id !== user.id) {
		return c.json({ error: 'Unauthorized' }, 403);
	}

	return c.json({ data });
});
