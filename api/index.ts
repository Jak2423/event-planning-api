import 'dotenv/config';
import { handle } from 'hono/vercel';
import { app } from '../src/app.js';

export default handle(app);

// Required for multipart uploads — Vercel must not pre-parse the body.
export const config = {
	api: {
		bodyParser: false,
	},
};
