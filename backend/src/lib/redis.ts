import { Redis } from 'ioredis';
import { env } from '../config/env.js';

// BullMQ requires maxRetriesPerRequest: null for blocking connections.
export const createRedis = () => new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
export const redis = createRedis();
