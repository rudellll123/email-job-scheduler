import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { eq } from 'drizzle-orm';

import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { users, type NewUser } from '../db/schema.js';

passport.use(
  new GoogleStrategy(
    {
      clientID: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${env.BASE_URL}/api/auth/google/callback`,
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const googleId = profile.id;
        const email = profile.emails?.[0]?.value;

        if (!email) {
          return done(
            new Error('Google account did not provide an email address'),
          );
        }

        const name = profile.displayName ?? profile.name?.givenName ?? email.split('@')[0] ?? 'Google User';

        const avatarUrl = profile.photos?.[0]?.value ?? null;

        const existingUser = await db.query.users.findFirst({
          where: eq(users.googleId, googleId),
        });

        if (existingUser) {
          const [updatedUser] = await db
            .update(users)
            .set({
              email,
              name,
              avatarUrl,
            })
            .where(eq(users.id, existingUser.id))
            .returning();

          return done(null, updatedUser);
        }

        const newUserValues: NewUser = {
          googleId,
          email,
          name,
          avatarUrl,
          passwordHash: null,
        };

        const [newUser] = await db
          .insert(users)
          .values(newUserValues)
          .returning();

        return done(null, newUser);
      } catch (error) {
        return done(error as Error);
      }
    },
  ),
);

passport.serializeUser((user, done) => {
  done(null, (user as { id: string }).id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, String(id)),
    });

    if (!user) {
      return done(null, false);
    }

    return done(null, user);
  } catch (error) {
    return done(error);
  }
});

export default passport;

