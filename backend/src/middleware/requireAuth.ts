import type { NextFunction, Request, Response } from 'express'

import { unauthorized } from '../lib/errors.js'

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.isAuthenticated() || !req.user) {
    return next(unauthorized('Login required'))
  }
  next()
}
