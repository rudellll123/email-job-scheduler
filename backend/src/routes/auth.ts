import { Router } from 'express';

import passport from '../auth/passport.js';
import { env } from '../config/env.js';

export const authRouter = Router();

authRouter.get(
  '/google',
  passport.authenticate('google', {
    scope: ['openid', 'email', 'profile'],
    session: true,
  }),
);

authRouter.get(
  '/google/callback',
  passport.authenticate('google', {
    failureRedirect: '/api/auth/login-failed',
    session: true,
  }),
  (_req, res) => {
    return res.redirect(env.FRONTEND_URL);
  },
);

authRouter.get('/login-failed', (_req, res) => {
  return res.status(401).json({
    error: 'Google authentication failed',
  });
});

authRouter.get('/me', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({
      authenticated: false,
      user: null,
    });
  }

  const user = req.user;

  return res.json({
    authenticated: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
    },
  });
});

authRouter.post('/logout', (req, res, next) => {
  req.logout((logoutError) => {
    if (logoutError) {
      return next(logoutError);
    }

    req.session.destroy((sessionError) => {
      if (sessionError) {
        return next(sessionError);
      }

      res.clearCookie('connect.sid');

      return res.json({
        message: 'Logged out successfully',
      });
    });
  });
});
