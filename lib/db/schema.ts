import {
  sqliteTable,
  integer,
  text,
  blob,
  index,
  primaryKey,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

/**
 * All timestamps are Unix milliseconds, UTC. They are formatted in
 * America/Boise on the client (see lib/time.ts). Booleans are 0/1 integers.
 */

export type TaskStatus = 'pending' | 'accepted' | 'done' | 'declined' | 'cancelled';
export type RecurrencePattern = 'daily' | 'weekly' | 'monthly';
export type SupplyStatus = 'requested' | 'ordered' | 'received';

export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    /** Null until the person enrols a PIN on their first login. */
    pinHash: text('pin_hash'),
    /** Admin gates exactly two things: the Supply Requests queue and full History. */
    isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
    /**
     * The account that activated the board with the setup code. Permanent:
     * it cannot be demoted or removed, because the buyer is the owner and
     * must never be able to lock themselves out of their own purchase.
     */
    isFounder: integer('is_founder', { mode: 'boolean' }).notNull().default(false),
    /** Has this user completed the first-run board walkthrough? */
    hasToured: integer('has_toured', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    /** Soft delete. Archived people vanish from pickers but keep their history. */
    archivedAt: integer('archived_at'),
  },
  (t) => [uniqueIndex('users_name_unique').on(t.name)],
);

/**
 * A tab across the top of the board. Only an admin creates one, renames one, or
 * decides who is in it; everyone in it can post work to it and see what is
 * there. The board always has one tab that is not a row here — the shared
 * "Tasqs" tab, which is every task whose `groupId` is null.
 */
export const groups = sqliteTable(
  'groups',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    /** Left-to-right tab order. Ties break on id, so a new tab lands last. */
    sortOrder: integer('sort_order').notNull().default(0),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at').notNull(),
    /** Soft delete, like people: the tab disappears, its tasks keep their history. */
    archivedAt: integer('archived_at'),
  },
  (t) => [uniqueIndex('groups_name_unique').on(t.name)],
);

/** Who can see and post to a group. Admins see every group without a row here. */
export const groupMembers = sqliteTable(
  'group_members',
  {
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    addedAt: integer('added_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    index('group_members_user_idx').on(t.userId),
  ],
);

export const recurrences = sqliteTable(
  'recurrences',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    title: text('title').notNull(),
    notes: text('notes'),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
    /** Null spawns the instance straight into the open pool ("Up for Grabs"). */
    defaultAssignee: integer('default_assignee').references(() => users.id),
    /** Which tab the spawned instance lands on. Null is the shared Tasqs tab. */
    groupId: integer('group_id').references((): AnySQLiteColumn => groups.id),
    isAsap: integer('is_asap', { mode: 'boolean' }).notNull().default(false),
    pattern: text('pattern').$type<RecurrencePattern>().notNull(),
    /** CSV of weekday numbers, 0 = Sunday. Used only when pattern = 'weekly'. */
    weekdays: text('weekdays'),
    /** 1-31. Used only when pattern = 'monthly'; clamped to the month's last day. */
    dayOfMonth: integer('day_of_month'),
    /** Local (America/Boise) time of day the instance appears, "HH:MM". */
    spawnTime: text('spawn_time').notNull().default('06:00'),
    /** Bounty in whole cents copied onto every spawned instance. */
    rewardCents: integer('reward_cents'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull(),
    /** Soft delete. A removed rule stops spawning and leaves the list, but the
        tasks it already spawned keep pointing at it. */
    archivedAt: integer('archived_at'),
    /**
     * Local date string "YYYY-MM-DD" of the last spawn. This is the scheduler's
     * idempotency guard: spawning twice for the same recurrence on the same
     * local date is a bug, so the spawn is a conditional UPDATE on this column.
     */
    lastSpawnedOn: text('last_spawned_on'),
  },
  (t) => [index('recurrences_active_idx').on(t.active)],
);

export const tasks = sqliteTable(
  'tasks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    title: text('title').notNull(),
    notes: text('notes'),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
    /** Null means the task sits in the open pool and anyone can claim it. */
    assignedTo: integer('assigned_to').references(() => users.id),
    /** Which tab it shows on. Null is the shared Tasqs tab everyone sees. */
    groupId: integer('group_id').references((): AnySQLiteColumn => groups.id),
    isAsap: integer('is_asap', { mode: 'boolean' }).notNull().default(false),
    dueAt: integer('due_at'),
    status: text('status').$type<TaskStatus>().notNull().default('pending'),
    claimedAt: integer('claimed_at'),
    acceptedAt: integer('accepted_at'),
    completedAt: integer('completed_at'),
    completedBy: integer('completed_by').references(() => users.id),
    declineReason: text('decline_reason'),
    recurrenceId: integer('recurrence_id').references(
      (): AnySQLiteColumn => recurrences.id,
    ),
    /** Set once when an overdue push has been sent, so it fires once, not repeatedly. */
    overdueNotifiedAt: integer('overdue_notified_at'),
    /** Bounty in whole cents offered by an admin; null means no cash value. */
    rewardCents: integer('reward_cents'),
    /**
     * When the admin settled this bounty with whoever finished it. Null on a
     * task that still owes money; the Payouts screen is exactly the set of
     * done, rewarded tasks where this is still null.
     */
    rewardPaidAt: integer('reward_paid_at'),
    rewardPaidBy: integer('reward_paid_by').references((): AnySQLiteColumn => users.id),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('tasks_status_idx').on(t.status),
    index('tasks_assigned_idx').on(t.assignedTo),
    index('tasks_asap_idx').on(t.isAsap),
    index('tasks_recurrence_idx').on(t.recurrenceId),
    index('tasks_group_idx').on(t.groupId),
    index('tasks_reward_unpaid_idx').on(t.rewardPaidAt),
  ],
);

export const supplyRequests = sqliteTable(
  'supply_requests',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    item: text('item').notNull(),
    notes: text('notes'),
    requestedBy: integer('requested_by')
      .notNull()
      .references(() => users.id),
    /** Free text on purpose — "2 tubes", "a case", "whatever fits". */
    quantity: text('quantity'),
    status: text('status').$type<SupplyStatus>().notNull().default('requested'),
    createdAt: integer('created_at').notNull(),
    orderedAt: integer('ordered_at'),
    receivedAt: integer('received_at'),
  },
  (t) => [index('supply_status_idx').on(t.status)],
);

/** Append-only. Never updated, never deleted. */
export const activityLog = sqliteTable(
  'activity_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Null for events the scheduler causes rather than a person. */
    actorId: integer('actor_id').references(() => users.id),
    verb: text('verb').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: integer('subject_id'),
    /** Rendered to human-readable text at write time so History never decodes IDs. */
    summary: text('summary').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('activity_created_idx').on(t.createdAt),
    index('activity_actor_idx').on(t.actorId),
  ],
);

export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: integer('created_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
  },
  (t) => [uniqueIndex('push_endpoint_unique').on(t.endpoint)],
);

/**
 * Deployment-level settings that are not a person's to edit one field at a
 * time: the business name, and the push keys when they were generated here
 * rather than passed in through the environment.
 */
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/**
 * One-time codes. An `initial` code activates a fresh install — the door
 * closes behind the first admin. A `recovery` code is minted from the machine
 * (npm run recover) precisely when that door needs reopening: it adds another
 * admin to a live board. Both are stored hashed; plaintext never persists.
 */
export const setupCodes = sqliteTable(
  'setup_codes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** SHA-256 of the code. The code itself only ever exists in transit. */
    codeHash: text('code_hash').notNull(),
    kind: text('kind')
      .$type<'initial' | 'recovery'>()
      .notNull()
      .default('initial'),
    createdAt: integer('created_at').notNull(),
    usedAt: integer('used_at'),
  },
  (t) => [index('setup_codes_unused_idx').on(t.usedAt)],
);

/**
 * One browser that has asked to reach this board.
 *
 * The whitelist is off by default: a board on the shop LAN is already behind
 * the front door. It is meant for the case where the board is published to the
 * open internet through a tunnel — then having the address is no longer enough,
 * and the owner has to let each device in by hand.
 *
 * A "device" is a browser profile, identified by an opaque random token in a
 * long-lived cookie. Only the SHA-256 of that token is stored, so the table is
 * useless to anyone who reads the database. A MAC address is not visible to a
 * web page from any browser, and a fingerprint would be both weaker and
 * creepier — this is a bearer token the owner explicitly approves.
 */
export const devices = sqliteTable(
  'devices',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** SHA-256 of the cookie value. The token itself only exists in the browser. */
    tokenHash: text('token_hash').notNull(),
    /** Guessed from the user agent, and renameable — "Chris's iPhone". */
    label: text('label').notNull(),
    userAgent: text('user_agent'),
    status: text('status')
      .$type<'pending' | 'approved' | 'blocked'>()
      .notNull()
      .default('pending'),
    firstSeenAt: integer('first_seen_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    approvedBy: integer('approved_by').references((): AnySQLiteColumn => users.id),
    approvedAt: integer('approved_at'),
    /** Last account signed in here — the thing that makes a row recognisable. */
    lastUserId: integer('last_user_id').references((): AnySQLiteColumn => users.id),
  },
  (t) => [
    uniqueIndex('devices_token_unique').on(t.tokenHash),
    index('devices_status_idx').on(t.status),
  ],
);

/**
 * Login throttle state, kept out of `users` so editing a person in Settings
 * never touches their lockout. A 4-digit PIN is only 10,000 combinations, so
 * this is the real defence — the hash is the second one.
 */
export const loginThrottle = sqliteTable('login_throttle', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id),
  failedCount: integer('failed_count').notNull().default(0),
  /** Unix ms; attempts before this instant are rejected without touching the hash. */
  lockedUntil: integer('locked_until'),
  /** Number of lockouts served in a row. Each one doubles the next duration. */
  lockoutLevel: integer('lockout_level').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});

/**
 * Optional photo proof, one per task. The bytes live in SQLite as JPEG blobs:
 * a full image (client-downscaled to ~1280px long edge, quality 70) and a small
 * ~320px thumbnail the board serves, so opening the board never pulls the
 * full-size photo. Replacement overwrites the row — never duplicated.
 */
export const taskPhotos = sqliteTable('task_photos', {
  taskId: integer('task_id')
    .primaryKey()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  mime: text('mime').notNull().default('image/jpeg'),
  bytes: blob('bytes', { mode: 'buffer' }).notNull(),
  thumbBytes: blob('thumb_bytes', { mode: 'buffer' }).notNull(),
  createdAt: integer('created_at').notNull(),
  /** Changes on every replace — the <img> cache-busting query param. */
  updatedAt: integer('updated_at').notNull(),
});

export type User = typeof users.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type Device = typeof devices.$inferSelect;
export type GroupMember = typeof groupMembers.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Recurrence = typeof recurrences.$inferSelect;
export type SupplyRequest = typeof supplyRequests.$inferSelect;
export type ActivityEntry = typeof activityLog.$inferSelect;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type SetupCode = typeof setupCodes.$inferSelect;
