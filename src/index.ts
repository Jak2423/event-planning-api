import 'dotenv/config';
import { serve } from '@hono/node-server';
import { app } from './app.js';

const port = parseInt(process.env.PORT ?? '4000', 10);

serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => {
	console.log(`🚀 Nairly API running on http://localhost:${port}`);
});
