import { handle } from '@hono/node-server/vercel';
import 'dotenv/config';
import { app } from '../src/app.js';

export default handle(app);
