import type { User as DatabaseUser } from '../db/schema.js';

declare global {
  namespace Express {
    interface User extends DatabaseUser {}
  }
}

export {};
