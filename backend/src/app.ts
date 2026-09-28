import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { ZodError } from 'zod';

import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { HttpError } from './lib/errors.js';
import passport from './auth/passport.js';
import { sessionMiddleware } from './auth/session.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger }));

  app.use(sessionMiddleware);
  app.use(passport.initialize());
  app.use(passport.session());

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    if (err instanceof ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: err.flatten(),
      });
    }

    if (err instanceof HttpError) {
      return res.status(err.status).json({
        error: err.message,
        details: err.details,
      });
    }

    req.log.error({ err }, 'unhandled error');
    return res.status(500).json({ error: 'Internal server error' });
  };

  app.use(errorHandler);

  return app;
}
