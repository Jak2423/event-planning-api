import 'dotenv/config';
import { handle } from 'hono/vercel';
import { app, corsHeadersFor } from '../src/app.js';

const honoHandler = handle(app);

export default async function handler(request: Request): Promise<Response> {
	try {
		return await honoHandler(request);
	} catch (err) {
		console.error('[vercel] unhandled handler error', err);
		const headers = corsHeadersFor(request.headers.get('origin') ?? undefined);
		headers.set('Content-Type', 'application/json');
		return new Response(JSON.stringify({ error: 'Internal server error' }), {
			status: 500,
			headers,
		});
	}
}

export const config = {
	api: {
		bodyParser: false,
	},
};
