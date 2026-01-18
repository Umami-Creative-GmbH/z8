import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

// Import auth tables for FK references
import { organization, user } from "../auth-schema";
import { notificationChannelEnum, notificationTypeEnum } from "./enums";

// ============================================
// NOTIFICATIONS
// ============================================

// In-app notifications for users
export const notification = pgTable(
	"notification",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		type: notificationTypeEnum("type").notNull(),
		title: text("title").notNull(),
		message: text("message").notNull(),

		// Optional link to related entity
		entityType: text("entity_type"), // "absence_entry" | "work_period" | "team" | etc.
		entityId: uuid("entity_id"),
		actionUrl: text("action_url"), // Deep link to relevant page

		// Read status
		isRead: boolean("is_read").default(false).notNull(),
		readAt: timestamp("read_at"),

		// Metadata
		metadata: text("metadata"), // JSON for additional context

		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("notification_userId_idx").on(table.userId),
		index("notification_organizationId_idx").on(table.organizationId),
		index("notification_isRead_idx").on(table.isRead),
		index("notification_createdAt_idx").on(table.createdAt),
		index("notification_type_idx").on(table.type),
		index("notification_userId_orgId_isRead_idx").on(
			table.userId,
			table.organizationId,
			table.isRead,
		),
		index("notification_userId_orgId_createdAt_idx").on(
			table.userId,
			table.organizationId,
			table.createdAt,
		),
	],
);

// User notification preferences per channel and type (user-level, not org-specific)
export const notificationPreference = pgTable(
	"notification_preference",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		// organizationId kept for backwards compatibility but nullable (preferences are user-level)
		organizationId: text("organization_id").references(() => organization.id, {
			onDelete: "cascade",
		}),

		notificationType: notificationTypeEnum("notification_type").notNull(),
		channel: notificationChannelEnum("channel").notNull(),
		enabled: boolean("enabled").default(true).notNull(),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("notificationPreference_userId_idx").on(table.userId),
		// Unique constraint: one preference per user per type per channel (user-level)
		uniqueIndex("notificationPreference_unique_idx").on(
			table.userId,
			table.notificationType,
			table.channel,
		),
	],
);

// Push notification subscriptions (Web Push API)
export const pushSubscription = pgTable(
	"push_subscription",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),

		// Web Push subscription data
		endpoint: text("endpoint").notNull(),
		p256dh: text("p256dh").notNull(), // Public key
		auth: text("auth").notNull(), // Auth secret

		// Device/browser info for management
		userAgent: text("user_agent"),
		deviceName: text("device_name"), // User-friendly name

		// Status
		isActive: boolean("is_active").default(true).notNull(),
		lastUsedAt: timestamp("last_used_at"),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("pushSubscription_userId_idx").on(table.userId),
		index("pushSubscription_endpoint_idx").on(table.endpoint),
		index("pushSubscription_isActive_idx").on(table.isActive),
		index("pushSubscription_userId_isActive_idx").on(table.userId, table.isActive),
	],
);
