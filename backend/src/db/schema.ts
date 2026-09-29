import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const emailStatus = pgEnum('email_status', [
  'scheduled',
  'sending',
  'sent',
  'failed',
  'cancelled',
]);

// ============================================================
// USERS
// ============================================================

export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .primaryKey()
      .defaultRandom(),

    googleId: text('google_id'),

    email: text('email')
      .notNull()
      .unique(),

    name: text('name')
      .notNull(),

    avatarUrl: text('avatar_url'),

    passwordHash: text('password_hash'),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('users_google_id_uq')
      .on(table.googleId),
  ],
);

// ============================================================
// SENDERS
// ============================================================

export const senders = pgTable(
  'senders',
  {
    id: uuid('id')
      .primaryKey()
      .defaultRandom(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, {
        onDelete: 'cascade',
      }),

    email: text('email')
      .notNull(),

    smtpHost: text('smtp_host')
      .notNull(),

    smtpPort: integer('smtp_port')
      .notNull(),

    smtpUser: text('smtp_user')
      .notNull(),

    smtpPassEnc: text('smtp_pass_enc')
      .notNull(),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('senders_user_email_uq')
      .on(table.userId, table.email),
  ],
);

// ============================================================
// CAMPAIGNS
// ============================================================

export const campaigns = pgTable('campaigns', {
  id: uuid('id')
    .primaryKey()
    .defaultRandom(),

  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, {
      onDelete: 'cascade',
    }),

  senderId: uuid('sender_id')
    .notNull()
    .references(() => senders.id),

  subject: text('subject')
    .notNull(),

  bodyHtml: text('body_html')
    .notNull(),

  bodyText: text('body_text')
    .notNull(),

  startAt: timestamp('start_at', {
    withTimezone: true,
  }).notNull(),

  delaySeconds: integer('delay_seconds')
    .notNull(),

  hourlyLimit: integer('hourly_limit')
    .notNull(),

  createdAt: timestamp('created_at', {
    withTimezone: true,
  })
    .notNull()
    .defaultNow(),
});

// ============================================================
// EMAILS
// ============================================================

export const emails = pgTable(
  'emails',
  {
    id: uuid('id')
      .primaryKey()
      .defaultRandom(),

    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, {
        onDelete: 'cascade',
      }),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, {
        onDelete: 'cascade',
      }),

    senderId: uuid('sender_id')
      .notNull()
      .references(() => senders.id),

    position: integer('position')
      .notNull()
      .default(0),

    toEmail: text('to_email')
      .notNull(),

    subject: text('subject')
      .notNull(),

    bodyHtml: text('body_html')
      .notNull(),

    bodyText: text('body_text')
      .notNull(),

    status: emailStatus('status')
      .notNull()
      .default('scheduled'),

    scheduledAt: timestamp('scheduled_at', {
      withTimezone: true,
    }).notNull(),

    sentAt: timestamp('sent_at', {
      withTimezone: true,
    }),

    attempts: integer('attempts')
      .notNull()
      .default(0),

    lastError: text('last_error'),

    messageId: text('message_id'),

    previewUrl: text('preview_url'),

    idempotencyKey: text('idempotency_key'),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('emails_user_status_sched_idx')
      .on(
        table.userId,
        table.status,
        table.scheduledAt,
      ),

    index('emails_sender_status_idx')
      .on(
        table.senderId,
        table.status,
      ),

    uniqueIndex('emails_idem_uq')
      .on(
        table.userId,
        table.idempotencyKey,
      ),
  ],
);

// ============================================================
// SLACK CONNECTIONS
// ============================================================

export const slackConnections = pgTable(
  'slack_connections',
  {
    id: uuid('id')
      .primaryKey()
      .defaultRandom(),

    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, {
        onDelete: 'cascade',
      }),

    teamId: text('team_id')
      .notNull(),

    teamName: text('team_name')
      .notNull(),

    channelId: text('channel_id')
      .notNull(),

    accessTokenEnc: text('access_token_enc')
      .notNull(),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
);

// ============================================================
// TYPES
// ============================================================

export type User = typeof users.$inferSelect;

export type NewUser = typeof users.$inferInsert;

export type Sender = typeof senders.$inferSelect;

export type Campaign = typeof campaigns.$inferSelect;

export type Email = typeof emails.$inferSelect;

export type EmailStatus =
  (typeof emailStatus.enumValues)[number];


import { relations } from 'drizzle-orm'

export const emailsRelations = relations(emails, ({ one }) => ({
  sender: one(senders, {
    fields: [emails.senderId],
    references: [senders.id],
  }),
}))
