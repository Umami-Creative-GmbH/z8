import {
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

// Import auth tables for FK references
import { organization, user, session, passkey } from "../auth-schema";

// ============================================
// CONDITIONAL ACCESS MODULE ENUMS
// ============================================

export const deviceTrustSourceEnum = pgEnum("device_trust_source", [
	"passkey", // Device with registered passkey
	"admin_registered", // Manually registered by admin
	"remember_device", // User opted to remember device
	"mdm", // MDM-enrolled device
]);

export const accessViolationTypeEnum = pgEnum("access_violation_type", [
	"ip_blocked",
	"ip_not_whitelisted",
	"country_blocked",
	"country_not_allowed",
	"untrusted_device",
	"mfa_required",
	"passkey_required",
	"session_expired",
	"session_idle_timeout",
	"concurrent_session_limit",
]);

export const accessViolationActionEnum = pgEnum("access_violation_action", [
	"blocked", // Access denied
	"challenged", // Prompted for additional auth (MFA, device trust)
	"logged", // Allowed but logged for review
]);

// ============================================
// ACCESS POLICY
// Organization-level conditional access policies
// ============================================

export const accessPolicy = pgTable(
	"access_policy",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Policy metadata
		name: text("name").notNull(),
		description: text("description"),
		enabled: boolean("enabled").default(true).notNull(),
		// Higher priority = evaluated first (allows override policies)
		priority: integer("priority").default(0).notNull(),

		// IP restrictions (CIDR notation, e.g., ["10.0.0.0/8", "192.168.1.0/24"])
		// If whitelist is set, ONLY these IPs are allowed
		ipWhitelist: jsonb("ip_whitelist").$type<string[]>(),
		// If blacklist is set, these IPs are blocked
		ipBlacklist: jsonb("ip_blacklist").$type<string[]>(),

		// Geolocation restrictions (ISO 3166-1 alpha-2 country codes)
		// If set, ONLY these countries are allowed
		allowedCountries: jsonb("allowed_countries").$type<string[]>(),
		// If set, these countries are blocked
		blockedCountries: jsonb("blocked_countries").$type<string[]>(),

		// Device trust requirements
		requireTrustedDevice: boolean("require_trusted_device").default(false).notNull(),
		requirePasskey: boolean("require_passkey").default(false).notNull(),

		// MFA enforcement
		requireMfa: boolean("require_mfa").default(false).notNull(),
		// Require hardware MFA (passkey or security key, not TOTP)
		requireHardwareMfa: boolean("require_hardware_mfa").default(false).notNull(),

		// Session constraints
		// Max session duration in minutes (null = use Better Auth default)
		maxSessionDurationMinutes: integer("max_session_duration_minutes"),
		// Idle timeout in minutes (null = no idle timeout)
		idleTimeoutMinutes: integer("idle_timeout_minutes"),
		// Allow multiple concurrent sessions
		allowConcurrentSessions: boolean("allow_concurrent_sessions").default(true).notNull(),
		// Max concurrent sessions per user (if allowConcurrentSessions = true)
		maxConcurrentSessions: integer("max_concurrent_sessions").default(5),

		// Audit
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id),
	},
	(table) => [
		index("accessPolicy_organizationId_idx").on(table.organizationId),
		index("accessPolicy_enabled_idx").on(table.enabled),
		index("accessPolicy_priority_idx").on(table.priority),
	],
);

// ============================================
// TRUSTED DEVICE
// Devices that are trusted for a user in an organization
// ============================================

export const trustedDevice = pgTable(
	"trusted_device",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Device identification
		// Hash of device characteristics (user-agent, platform, screen, etc.)
		deviceFingerprint: text("device_fingerprint").notNull(),
		// User-friendly name for display
		deviceName: text("device_name"),
		// Raw user agent string
		userAgent: text("user_agent"),
		// Platform (windows, macos, linux, ios, android)
		platform: text("platform"),

		// Trust source
		trustSource: deviceTrustSourceEnum("trust_source").notNull(),

		// For passkey-based trust: link to passkey table
		passkeyId: text("passkey_id").references(() => passkey.id, {
			onDelete: "set null",
		}),

		// For MDM-enrolled devices
		mdmProvider: text("mdm_provider"), // "intune", "jamf", "workspace_one", etc.
		mdmDeviceId: text("mdm_device_id"),
		mdmCompliant: boolean("mdm_compliant"), // Is device compliant with MDM policies?
		mdmLastCheckedAt: timestamp("mdm_last_checked_at"),

		// Status
		isActive: boolean("is_active").default(true).notNull(),
		// For remember_device: when the trust expires
		expiresAt: timestamp("expires_at"),

		// Last activity
		lastUsedAt: timestamp("last_used_at"),
		lastIpAddress: text("last_ip_address"),

		// Audit
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		revokedAt: timestamp("revoked_at"),
		revokedBy: text("revoked_by").references(() => user.id),
		revokeReason: text("revoke_reason"),
	},
	(table) => [
		index("trustedDevice_userId_idx").on(table.userId),
		index("trustedDevice_organizationId_idx").on(table.organizationId),
		index("trustedDevice_isActive_idx").on(table.isActive),
		index("trustedDevice_fingerprint_idx").on(table.deviceFingerprint),
		// Unique: one fingerprint per user per org
		uniqueIndex("trustedDevice_user_org_fingerprint_idx").on(
			table.userId,
			table.organizationId,
			table.deviceFingerprint,
		),
	],
);

// ============================================
// SESSION EXTENSION
// Additional metadata for Better Auth sessions
// ============================================

export const sessionExtension = pgTable(
	"session_extension",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		sessionId: text("session_id")
			.notNull()
			.references(() => session.id, { onDelete: "cascade" })
			.unique(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Device info
		trustedDeviceId: uuid("trusted_device_id").references(() => trustedDevice.id, {
			onDelete: "set null",
		}),
		deviceFingerprint: text("device_fingerprint"),

		// Geolocation at session creation
		country: text("country"), // ISO 3166-1 alpha-2
		region: text("region"),
		city: text("city"),

		// Policy enforcement
		accessPolicyId: uuid("access_policy_id").references(() => accessPolicy.id, {
			onDelete: "set null",
		}),

		// MFA verification tracking
		mfaVerifiedAt: timestamp("mfa_verified_at"),
		mfaMethod: text("mfa_method"), // "totp", "passkey", "sms", etc.

		// Activity tracking
		lastActivityAt: timestamp("last_activity_at").defaultNow().notNull(),
		requestCount: integer("request_count").default(0).notNull(),

		// Audit
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("sessionExtension_sessionId_idx").on(table.sessionId),
		index("sessionExtension_organizationId_idx").on(table.organizationId),
		index("sessionExtension_trustedDeviceId_idx").on(table.trustedDeviceId),
		index("sessionExtension_lastActivityAt_idx").on(table.lastActivityAt),
	],
);

// ============================================
// ACCESS VIOLATION LOG
// Compliance audit trail for access policy violations
// ============================================

export const accessViolationLog = pgTable(
	"access_violation_log",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Affected user (may be null if violation occurred before auth)
		userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
		sessionId: text("session_id").references(() => session.id, {
			onDelete: "set null",
		}),

		// Violation details
		violationType: accessViolationTypeEnum("violation_type").notNull(),
		// Policy that triggered the violation
		policyId: uuid("policy_id").references(() => accessPolicy.id, {
			onDelete: "set null",
		}),

		// Request context
		ipAddress: text("ip_address"),
		country: text("country"),
		userAgent: text("user_agent"),
		requestPath: text("request_path"),
		requestMethod: text("request_method"),

		// Violation details
		metadata: jsonb("metadata").$type<{
			reason?: string;
			blockedIp?: string;
			blockedCountry?: string;
			requiredMfaType?: string;
			deviceFingerprint?: string;
			concurrentSessionCount?: number;
		}>(),

		// Action taken
		actionTaken: accessViolationActionEnum("action_taken").notNull(),

		// Audit
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("accessViolationLog_organizationId_idx").on(table.organizationId),
		index("accessViolationLog_userId_idx").on(table.userId),
		index("accessViolationLog_violationType_idx").on(table.violationType),
		index("accessViolationLog_createdAt_idx").on(table.createdAt),
		index("accessViolationLog_policyId_idx").on(table.policyId),
	],
);
