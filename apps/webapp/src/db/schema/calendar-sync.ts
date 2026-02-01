import {
	boolean,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { organization, user } from "../auth-schema";
import { absenceEntry } from "./absence";
import { employee, team } from "./organization";

// ============================================
// CALENDAR SYNC ENUMS
// ============================================

/**
 * Supported calendar providers
 * - google: Google Calendar (Calendar API v3)
 * - microsoft365: Microsoft 365 (Graph API)
 * - icloud: Apple iCloud (future)
 * - caldav: Generic CalDAV (future)
 */
export const calendarProviderEnum = pgEnum("calendar_provider", [
	"google",
	"microsoft365",
	"icloud",
	"caldav",
]);

/**
 * ICS feed scope type
 */
export const icsFeedTypeEnum = pgEnum("ics_feed_type", ["user", "team"]);

/**
 * Calendar sync status for individual absences
 */
export const calendarSyncStatusEnum = pgEnum("calendar_sync_status", [
	"pending", // Queued for sync
	"synced", // Successfully synced
	"error", // Sync failed
	"deleted", // Deleted from external calendar
]);

/**
 * Calendar sync action type
 */
export const calendarSyncActionEnum = pgEnum("calendar_sync_action", [
	"create", // Create event in external calendar
	"update", // Update existing event
	"delete", // Delete event from external calendar
]);

// ============================================
// CALENDAR CONNECTIONS
// ============================================

/**
 * Calendar connections for employees
 *
 * Stores OAuth tokens and configuration for connecting external calendars.
 * Each employee can have one connection per provider.
 *
 * Token storage note: Access and refresh tokens are stored directly in the database.
 * For production, consider encrypting at rest using database-level encryption
 * or application-level encryption with a KMS.
 */
export const calendarConnection = pgTable(
	"calendar_connection",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Provider details
		provider: calendarProviderEnum("provider").notNull(),
		providerAccountId: text("provider_account_id").notNull(), // External user ID/email

		// OAuth tokens
		accessToken: text("access_token").notNull(),
		refreshToken: text("refresh_token"),
		expiresAt: timestamp("expires_at"),
		scope: text("scope"), // Granted OAuth scopes

		// Calendar selection
		calendarId: text("calendar_id").default("primary").notNull(), // Which calendar to sync to

		// Sync settings
		isActive: boolean("is_active").default(true).notNull(),
		pushEnabled: boolean("push_enabled").default(true).notNull(), // Push absences to external
		conflictDetectionEnabled: boolean("conflict_detection_enabled").default(true).notNull(),

		// Sync state
		lastSyncAt: timestamp("last_sync_at"),
		lastSyncError: text("last_sync_error"),
		consecutiveFailures: integer("consecutive_failures").default(0).notNull(),

		// Timestamps
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("calendarConnection_employeeId_idx").on(table.employeeId),
		index("calendarConnection_organizationId_idx").on(table.organizationId),
		index("calendarConnection_provider_idx").on(table.provider),
		// One active connection per employee per provider
		uniqueIndex("calendarConnection_employee_provider_idx").on(table.employeeId, table.provider),
	],
);

// ============================================
// SYNCED ABSENCES
// ============================================

/**
 * Tracks which absences have been synced to external calendars
 *
 * Maps Z8 absences to external calendar events for:
 * - Avoiding duplicate pushes
 * - Updating events when absence changes
 * - Deleting events when absence is cancelled
 */
export const syncedAbsence = pgTable(
	"synced_absence",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		absenceEntryId: uuid("absence_entry_id")
			.notNull()
			.references(() => absenceEntry.id, { onDelete: "cascade" }),
		calendarConnectionId: uuid("calendar_connection_id")
			.notNull()
			.references(() => calendarConnection.id, { onDelete: "cascade" }),

		// External event reference
		externalEventId: text("external_event_id").notNull(),
		externalCalendarId: text("external_calendar_id").notNull(),
		externalEventEtag: text("external_event_etag"), // For optimistic locking

		// Sync status
		syncStatus: calendarSyncStatusEnum("sync_status").default("synced").notNull(),
		lastAction: calendarSyncActionEnum("last_action").notNull(),
		lastSyncedAt: timestamp("last_synced_at").notNull(),

		// Error tracking
		syncError: text("sync_error"),
		retryCount: integer("retry_count").default(0).notNull(),

		// Timestamps
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("syncedAbsence_absenceEntryId_idx").on(table.absenceEntryId),
		index("syncedAbsence_calendarConnectionId_idx").on(table.calendarConnectionId),
		index("syncedAbsence_syncStatus_idx").on(table.syncStatus),
		// One sync record per absence per connection
		uniqueIndex("syncedAbsence_absence_connection_idx").on(
			table.absenceEntryId,
			table.calendarConnectionId,
		),
	],
);

// ============================================
// ICS FEEDS
// ============================================

/**
 * ICS feed configurations for users and teams
 *
 * Enables read-only calendar subscriptions via standard ICS/iCal format.
 * URLs are secured with a random token (not authentication headers)
 * for compatibility with all calendar clients.
 */
export const icsFeed = pgTable(
	"ics_feed",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Feed type and target
		feedType: icsFeedTypeEnum("feed_type").notNull(),
		employeeId: uuid("employee_id").references(() => employee.id, { onDelete: "cascade" }),
		teamId: uuid("team_id").references(() => team.id, { onDelete: "cascade" }),

		// Secret token for URL authentication (64-char hex string)
		secret: text("secret").notNull().unique(),

		// Feed configuration
		includeApproved: boolean("include_approved").default(true).notNull(),
		includePending: boolean("include_pending").default(true).notNull(),

		// Status
		isActive: boolean("is_active").default(true).notNull(),

		// Usage tracking
		lastAccessedAt: timestamp("last_accessed_at"),

		// Audit
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("icsFeed_organizationId_idx").on(table.organizationId),
		index("icsFeed_employeeId_idx").on(table.employeeId),
		index("icsFeed_teamId_idx").on(table.teamId),
		index("icsFeed_secret_idx").on(table.secret),
	],
);

// ============================================
// ORGANIZATION CALENDAR SETTINGS
// ============================================

/**
 * Organization-level calendar sync settings and policies
 *
 * Allows admins to configure defaults and restrictions for calendar sync.
 */
export const organizationCalendarSettings = pgTable(
	"organization_calendar_settings",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" })
			.unique(),

		// Enabled providers
		googleEnabled: boolean("google_enabled").default(true).notNull(),
		microsoft365Enabled: boolean("microsoft365_enabled").default(true).notNull(),

		// ICS feed settings
		icsFeedsEnabled: boolean("ics_feeds_enabled").default(true).notNull(),
		teamIcsFeedsEnabled: boolean("team_ics_feeds_enabled").default(true).notNull(),

		// Sync settings
		autoSyncOnApproval: boolean("auto_sync_on_approval").default(true).notNull(),
		conflictDetectionRequired: boolean("conflict_detection_required").default(false).notNull(),

		// Event customization
		eventTitleTemplate: text("event_title_template").default("Out of Office - {categoryName}"),
		eventDescriptionTemplate: text("event_description_template"),

		// Timestamps
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		uniqueIndex("organizationCalendarSettings_organizationId_idx").on(table.organizationId),
	],
);

// Type exports
export type CalendarConnection = typeof calendarConnection.$inferSelect;
export type NewCalendarConnection = typeof calendarConnection.$inferInsert;
export type CalendarProvider = CalendarConnection["provider"];

export type SyncedAbsence = typeof syncedAbsence.$inferSelect;
export type NewSyncedAbsence = typeof syncedAbsence.$inferInsert;
export type CalendarSyncStatus = SyncedAbsence["syncStatus"];
export type CalendarSyncAction = SyncedAbsence["lastAction"];

export type ICSFeed = typeof icsFeed.$inferSelect;
export type NewICSFeed = typeof icsFeed.$inferInsert;
export type ICSFeedType = ICSFeed["feedType"];

export type OrganizationCalendarSettings = typeof organizationCalendarSettings.$inferSelect;
export type NewOrganizationCalendarSettings = typeof organizationCalendarSettings.$inferInsert;
