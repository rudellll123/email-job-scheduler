import { Router } from 'express';
import { pool } from '../db/client.js';
import { redis } from '../lib/redis.js';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  const [dbOk, redisOk] = await Promise.all([
    pool.query('select 1').then(() => true, () => false),
    redis.ping().then(() => true, () => false),
  ]);
  res.status(dbOk && redisOk ? 200 : 503).json({ db: dbOk, redis: redisOk });
});
