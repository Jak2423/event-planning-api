import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';

import { adminOrdersRouter } from './routes/admin/orders.js';
import { adminProvidersRouter } from './routes/admin/providers.js';
import { categoriesRouter } from './routes/categories.js';
import { eventPlansRouter } from './routes/event-plans.js';
import { monitoringRouter } from './routes/monitoring.js';
import { ordersRouter } from './routes/orders.js';
import { providerRouter } from './routes/provider.js';
import { servicesRouter } from './routes/services.js';
import { timeSlotsRouter } from './routes/time-slots.js';
import { uploadsRouter } from './routes/uploads.js';
import { venuesRouter } from './routes/venues.js';
import { wishlistRouter } from './routes/wishlist.js';

const CORS_ALLOW_HEADERS =
	'Authorization, Content-Type, Accept, Origin, X-Requested-With, X-CSRF-Token';
const CORS_ALLOW_METHODS = 'GET, POST, PATCH, PUT, DELETE, OPTIONS';

export const resolveAllowOrigin = (origin: string | undefined): string => origin ?? '*';

/** Safe on Vercel where c.req.raw may be Node IncomingMessage in error handlers. */
export const readRequestHeader = (c: Context, name: string): string | undefined => {
	try {
		const value = c.req.header(name);
		if (value) return value;
	} catch {
		// fall through
	}

	const raw = c.req.raw as unknown;
	if (raw instanceof Request) {
		return raw.headers.get(name) ?? undefined;
	}

	const headers = (raw as { headers?: unknown })?.headers;
	if (headers && typeof headers === 'object') {
		if (typeof (headers as Headers).get === 'function') {
			return (headers as Headers).get(name) ?? undefined;
		}
		const record = headers as Record<string, string | string[] | undefined>;
		const key = name.toLowerCase();
		const value = record[key] ?? record[name];
		if (Array.isArray(value)) return value[0];
		return value;
	}

	return undefined;
};

export const corsHeadersFor = (origin: string | undefined): Headers => {
	const headers = new Headers();
	const allowOrigin = resolveAllowOrigin(origin);
	headers.set('Access-Control-Allow-Origin', allowOrigin);
	if (allowOrigin !== '*') {
		headers.set('Access-Control-Allow-Credentials', 'true');
	}
	headers.set('Access-Control-Allow-Methods', CORS_ALLOW_METHODS);
	headers.set('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
	headers.set('Access-Control-Max-Age', '86400');
	headers.append('Vary', 'Origin');
	return headers;
};

export const applyCorsToResponse = (c: Context, res: Response): Response => {
	const merged = new Headers(res.headers);
	for (const [key, value] of corsHeadersFor(readRequestHeader(c, 'origin'))) {
		merged.set(key, value);
	}
	return new Response(res.body, { status: res.status, statusText: res.statusText, headers: merged });
};

const corsMiddleware: MiddlewareHandler = async (c, next) => {
	const origin = readRequestHeader(c, 'origin');

	if (c.req.method === 'OPTIONS') {
		return new Response(null, { status: 204, headers: corsHeadersFor(origin) });
	}

	if (c.req.method === 'OPTIONS') {
		return new Response(null, { status: 204, headers: corsHeadersFor(origin) });
	}

	await next();

	for (const [key, value] of corsHeadersFor(origin)) {
		c.res.headers.set(key, value);
	}
};

export const createApp = () => {
	const app = new Hono();

	app.use(logger());
	app.use('*', corsMiddleware);

	app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

	app.route('/venues', venuesRouter);
	app.route('/services', servicesRouter);
	app.route('/uploads', uploadsRouter);
	app.route('/time-slots', timeSlotsRouter);
	app.route('/categories', categoriesRouter);
	app.route('/orders', ordersRouter);
	app.route('/event-plans', eventPlansRouter);
	app.route('/wishlist', wishlistRouter);
	app.route('/provider', providerRouter);
	app.route('/admin/orders', adminOrdersRouter);
	app.route('/admin/providers', adminProvidersRouter);
	app.route('/monitoring', monitoringRouter);

	app.onError((err, c) => {
		if (err instanceof HTTPException) {
			return applyCorsToResponse(c, c.json({ error: err.message }, err.status));
		}

		console.error('[unhandled error]', err);
		return applyCorsToResponse(c, c.json({ error: 'Internal server error' }, 500));
	});

	app.notFound((c) => applyCorsToResponse(c, c.json({ error: 'Route not found' }, 404)));

	return app;
};

export const app = createApp();
