import { Context, Effect, Layer } from "effect";
import { and, eq, desc, isNull, or, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/auth-schema";
import {
	accessPolicy,
	trustedDevice,
	sessionExtension,
	accessViolationLog,
} from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { getActiveAccessPolicies } from "./cached-queries";

const logger = createLogger("ConditionalAccess");

// ============================================
// Types
// ============================================

export interface AccessContext {
	userId: string;
	sessionId: string;
	organizationId: string;
	ipAddress: string;
	country?: string;
	region?: string;
	city?: string;
	userAgent?: string;
	deviceFingerprint?: string;
	mfaVerified: boolean;
	mfaMethod?: string;
	passkeyUsed: boolean;
}

export interface AccessDecision {
	allowed: boolean;
	reason?: string;
	violationType?: string;
	requiresAction?: "mfa" | "passkey" | "device_trust";
	policyId?: string;
}

// ============================================
// Conditional Access Service
// Evaluates access policies and enforces security requirements
// ============================================

export interface ConditionalAccessService {
	/**
	 * Evaluate access policies for a request
	 */
	readonly evaluateAccess: (context: AccessContext) => Effect.Effect<AccessDecision, Error>;

	/**
	 * Check if a device is trusted for a user in an organization
	 */
	readonly isDeviceTrusted: (params: {
		userId: string;
		organizationId: string;
		deviceFingerprint: string;
	}) => Effect.Effect<boolean, Error>;

	/**
	 * Register a trusted device
	 */
	readonly registerTrustedDevice: (params: {
		userId: string;
		organizationId: string;
		deviceFingerprint: string;
		deviceName?: string;
		userAgent?: string;
		platform?: string;
		trustSource: "passkey" | "admin_registered" | "remember_device" | "mdm";
		passkeyId?: string;
		expiresAt?: Date;
		createdBy: string;
	}) => Effect.Effect<typeof trustedDevice.$inferSelect, Error>;

	/**
	 * Revoke a trusted device
	 */
	readonly revokeTrustedDevice: (params: {
		deviceId: string;
		revokedBy: string;
		reason?: string;
	}) => Effect.Effect<void, Error>;

	/**
	 * Create or update session extension with access context
	 */
	readonly createSessionExtension: (params: {
		sessionId: string;
		organizationId: string;
		accessContext: AccessContext;
		policyId?: string;
	}) => Effect.Effect<typeof sessionExtension.$inferSelect, Error>;

	/**
	 * Update session activity (for idle timeout tracking)
	 */
	readonly updateSessionActivity: (sessionId: string) => Effect.Effect<void, Error>;

	/**
	 * Log an access violation
	 */
	readonly logViolation: (params: {
		organizationId: string;
		userId?: string;
		sessionId?: string;
		violationType: string;
		policyId?: string;
		context: AccessContext;
		actionTaken: "blocked" | "challenged" | "logged";
	}) => Effect.Effect<void, Error>;

	/**
	 * Get active policies for an organization
	 */
	readonly getActivePolicies: (
		organizationId: string,
	) => Effect.Effect<(typeof accessPolicy.$inferSelect)[], Error>;

	/**
	 * Check concurrent session limit
	 */
	readonly checkConcurrentSessions: (params: {
		userId: string;
		organizationId: string;
		maxSessions: number;
	}) => Effect.Effect<{ allowed: boolean; currentCount: number }, Error>;

	/**
	 * Terminate excess sessions when limit exceeded
	 */
	readonly terminateExcessSessions: (params: {
		userId: string;
		organizationId: string;
		maxSessions: number;
		keepSessionId: string;
	}) => Effect.Effect<number, Error>;
}

export const ConditionalAccessService = Context.GenericTag<ConditionalAccessService>(
	"@z8/ConditionalAccessService",
);

// ============================================
// Helper functions
// ============================================

/**
 * Cache for IP-to-number conversions to avoid repeated parsing.
 * Uses module-level Map for cross-request caching (LRU behavior via size limit).
 * @see js-cache-function-results rule
 */
const ipToNumberCache = new Map<string, number | null>();
const IP_CACHE_MAX_SIZE = 1000;

/**
 * Convert IP address string to numeric value (cached)
 */
function ipToNumber(ip: string): number | null {
	// Check cache first
	if (ipToNumberCache.has(ip)) {
		return ipToNumberCache.get(ip)!;
	}

	// Parse IP
	const parts = ip.split(".");
	if (parts.length !== 4) {
		ipToNumberCache.set(ip, null);
		return null;
	}

	let num = 0;
	for (let i = 0; i < 4; i++) {
		const part = parseInt(parts[i], 10);
		if (isNaN(part) || part < 0 || part > 255) {
			ipToNumberCache.set(ip, null);
			return null;
		}
		num = (num << 8) + part;
	}
	const result = num >>> 0; // Convert to unsigned

	// LRU-style eviction: clear oldest entries when cache gets too large
	if (ipToNumberCache.size >= IP_CACHE_MAX_SIZE) {
		const firstKey = ipToNumberCache.keys().next().value;
		if (firstKey) ipToNumberCache.delete(firstKey);
	}

	ipToNumberCache.set(ip, result);
	return result;
}

/**
 * Cache for CIDR bitmask calculations
 */
const bitmaskCache = new Map<number, number>();

/**
 * Get bitmask for CIDR notation (cached)
 */
function getBitmask(bits: number): number {
	if (bitmaskCache.has(bits)) {
		return bitmaskCache.get(bits)!;
	}
	const mask = ~(2 ** (32 - bits) - 1);
	bitmaskCache.set(bits, mask);
	return mask;
}

/**
 * Check if an IP address matches a CIDR range
 */
function ipMatchesCidr(ip: string, cidr: string): boolean {
	const [range, bitsStr] = cidr.split("/");
	const bits = bitsStr ? parseInt(bitsStr, 10) : 32;

	// Use cached conversions
	const ipNum = ipToNumber(ip);
	const rangeNum = ipToNumber(range);

	if (ipNum === null || rangeNum === null) return false;

	// Use cached bitmask
	const bitmask = getBitmask(bits);

	return (ipNum & bitmask) === (rangeNum & bitmask);
}

/**
 * Check if IP is in any of the CIDR ranges
 */
function ipInRanges(ip: string, ranges: string[]): boolean {
	// Pre-compute IP number once for all range checks
	const ipNum = ipToNumber(ip);
	if (ipNum === null) return false;

	return ranges.some((cidr) => {
		const [range, bitsStr] = cidr.split("/");
		const bits = bitsStr ? parseInt(bitsStr, 10) : 32;
		const rangeNum = ipToNumber(range);
		if (rangeNum === null) return false;
		const bitmask = getBitmask(bits);
		return (ipNum & bitmask) === (rangeNum & bitmask);
	});
}

// ============================================
// Service Implementation
// ============================================

export const ConditionalAccessServiceLive = Layer.succeed(
	ConditionalAccessService,
	ConditionalAccessService.of({
		evaluateAccess: (context: AccessContext) =>
			Effect.gen(function* () {
				// Get active policies using cached query (deduplicated per request)
				// @see server-cache-react rule
				const policies = yield* Effect.tryPromise(() =>
					getActiveAccessPolicies(context.organizationId),
				);

				// If no policies, allow access
				if (policies.length === 0) {
					return { allowed: true };
				}

				// Evaluate each policy
				for (const policy of policies) {
					// Check IP blacklist
					if (policy.ipBlacklist && policy.ipBlacklist.length > 0) {
						if (ipInRanges(context.ipAddress, policy.ipBlacklist)) {
							return {
								allowed: false,
								reason: "IP address is blocked",
								violationType: "ip_blocked",
								policyId: policy.id,
							};
						}
					}

					// Check IP whitelist (if set, IP MUST be in whitelist)
					if (policy.ipWhitelist && policy.ipWhitelist.length > 0) {
						if (!ipInRanges(context.ipAddress, policy.ipWhitelist)) {
							return {
								allowed: false,
								reason: "IP address not in allowed list",
								violationType: "ip_not_whitelisted",
								policyId: policy.id,
							};
						}
					}

					// Check blocked countries
					if (policy.blockedCountries && policy.blockedCountries.length > 0) {
						if (context.country && policy.blockedCountries.includes(context.country)) {
							return {
								allowed: false,
								reason: "Access from your country is not allowed",
								violationType: "country_blocked",
								policyId: policy.id,
							};
						}
					}

					// Check allowed countries (if set, country MUST be in list)
					if (policy.allowedCountries && policy.allowedCountries.length > 0) {
						if (!context.country || !policy.allowedCountries.includes(context.country)) {
							return {
								allowed: false,
								reason: "Access is only allowed from specific countries",
								violationType: "country_not_allowed",
								policyId: policy.id,
							};
						}
					}

					// Check trusted device requirement
					if (policy.requireTrustedDevice) {
						if (!context.deviceFingerprint) {
							return {
								allowed: false,
								reason: "Device fingerprint is required for trusted device verification",
								violationType: "untrusted_device",
								requiresAction: "device_trust",
								policyId: policy.id,
							};
						}

						const fingerprint = context.deviceFingerprint;
						const trusted = yield* Effect.tryPromise(() =>
							db.query.trustedDevice.findFirst({
								where: and(
									eq(trustedDevice.userId, context.userId),
									eq(trustedDevice.organizationId, context.organizationId),
									eq(trustedDevice.deviceFingerprint, fingerprint),
									eq(trustedDevice.isActive, true),
									or(isNull(trustedDevice.expiresAt), gte(trustedDevice.expiresAt, new Date())),
								),
							}),
						);

						if (!trusted) {
							return {
								allowed: false,
								reason: "This device is not trusted. Please register your device.",
								violationType: "untrusted_device",
								requiresAction: "device_trust",
								policyId: policy.id,
							};
						}
					}

					// Check passkey requirement
					if (policy.requirePasskey && !context.passkeyUsed) {
						return {
							allowed: false,
							reason: "Passkey authentication is required",
							violationType: "passkey_required",
							requiresAction: "passkey",
							policyId: policy.id,
						};
					}

					// Check MFA requirement
					if (policy.requireMfa && !context.mfaVerified) {
						return {
							allowed: false,
							reason: "Multi-factor authentication is required",
							violationType: "mfa_required",
							requiresAction: "mfa",
							policyId: policy.id,
						};
					}

					// Check hardware MFA requirement (passkey or security key, not TOTP)
					if (policy.requireHardwareMfa) {
						const isHardwareMfa = context.passkeyUsed || context.mfaMethod === "security_key";
						if (!isHardwareMfa) {
							return {
								allowed: false,
								reason: "Hardware security key or passkey is required",
								violationType: "passkey_required",
								requiresAction: "passkey",
								policyId: policy.id,
							};
						}
					}

					// Check concurrent session limit
					if (
						!policy.allowConcurrentSessions ||
						(policy.maxConcurrentSessions && policy.maxConcurrentSessions > 0)
					) {
						const maxSessions = policy.allowConcurrentSessions
							? (policy.maxConcurrentSessions ?? 5)
							: 1;

						const sessionCheck = yield* Effect.tryPromise(async () => {
							const extensions = await db.query.sessionExtension.findMany({
								where: eq(sessionExtension.organizationId, context.organizationId),
								with: {
									session: true,
								},
							});

							// Filter to sessions for this user that are still valid
							const userSessions = extensions.filter(
								(ext) =>
									ext.session?.userId === context.userId &&
									ext.session?.expiresAt > new Date() &&
									ext.sessionId !== context.sessionId,
							);

							return userSessions.length;
						});

						if (sessionCheck >= maxSessions) {
							return {
								allowed: false,
								reason: `Maximum ${maxSessions} concurrent session(s) allowed`,
								violationType: "concurrent_session_limit",
								policyId: policy.id,
							};
						}
					}
				}

				// All checks passed
				return { allowed: true };
			}),

		isDeviceTrusted: ({ userId, organizationId, deviceFingerprint }) =>
			Effect.gen(function* () {
				const device = yield* Effect.tryPromise(() =>
					db.query.trustedDevice.findFirst({
						where: and(
							eq(trustedDevice.userId, userId),
							eq(trustedDevice.organizationId, organizationId),
							eq(trustedDevice.deviceFingerprint, deviceFingerprint),
							eq(trustedDevice.isActive, true),
						),
					}),
				);

				if (!device) return false;

				// Check expiration
				if (device.expiresAt && device.expiresAt < new Date()) {
					return false;
				}

				return true;
			}),

		registerTrustedDevice: (params) =>
			Effect.gen(function* () {
				// Check if device already exists
				const existing = yield* Effect.tryPromise(() =>
					db.query.trustedDevice.findFirst({
						where: and(
							eq(trustedDevice.userId, params.userId),
							eq(trustedDevice.organizationId, params.organizationId),
							eq(trustedDevice.deviceFingerprint, params.deviceFingerprint),
						),
					}),
				);

				if (existing) {
					// Reactivate if it was revoked
					if (!existing.isActive) {
						const [updated] = yield* Effect.tryPromise(() =>
							db
								.update(trustedDevice)
								.set({
									isActive: true,
									trustSource: params.trustSource,
									expiresAt: params.expiresAt,
									revokedAt: null,
									revokedBy: null,
									revokeReason: null,
								})
								.where(eq(trustedDevice.id, existing.id))
								.returning(),
						);
						return updated;
					}
					return existing;
				}

				// Create new trusted device
				const [created] = yield* Effect.tryPromise(() =>
					db
						.insert(trustedDevice)
						.values({
							userId: params.userId,
							organizationId: params.organizationId,
							deviceFingerprint: params.deviceFingerprint,
							deviceName: params.deviceName,
							userAgent: params.userAgent,
							platform: params.platform,
							trustSource: params.trustSource,
							passkeyId: params.passkeyId,
							expiresAt: params.expiresAt,
							isActive: true,
							createdBy: params.createdBy,
						})
						.returning(),
				);

				logger.info(
					{ userId: params.userId, organizationId: params.organizationId },
					"Trusted device registered",
				);

				return created;
			}),

		revokeTrustedDevice: ({ deviceId, revokedBy, reason }) =>
			Effect.gen(function* () {
				yield* Effect.tryPromise(() =>
					db
						.update(trustedDevice)
						.set({
							isActive: false,
							revokedAt: new Date(),
							revokedBy,
							revokeReason: reason,
						})
						.where(eq(trustedDevice.id, deviceId)),
				);

				logger.info({ deviceId, revokedBy }, "Trusted device revoked");
			}),

		createSessionExtension: ({ sessionId, organizationId, accessContext, policyId }) =>
			Effect.gen(function* () {
				// Check if extension exists
				const existing = yield* Effect.tryPromise(() =>
					db.query.sessionExtension.findFirst({
						where: eq(sessionExtension.sessionId, sessionId),
					}),
				);

				if (existing) {
					// Update existing extension
					const [updated] = yield* Effect.tryPromise(() =>
						db
							.update(sessionExtension)
							.set({
								lastActivityAt: new Date(),
								requestCount: existing.requestCount + 1,
								mfaVerifiedAt: accessContext.mfaVerified ? new Date() : existing.mfaVerifiedAt,
								mfaMethod: accessContext.mfaMethod ?? existing.mfaMethod,
							})
							.where(eq(sessionExtension.id, existing.id))
							.returning(),
					);
					return updated;
				}

				// Find trusted device if fingerprint provided
				let trustedDeviceId: string | undefined;
				if (accessContext.deviceFingerprint) {
					const device = yield* Effect.tryPromise(() =>
						db.query.trustedDevice.findFirst({
							where: and(
								eq(trustedDevice.userId, accessContext.userId),
								eq(trustedDevice.organizationId, organizationId),
								eq(trustedDevice.deviceFingerprint, accessContext.deviceFingerprint!),
								eq(trustedDevice.isActive, true),
							),
						}),
					);
					trustedDeviceId = device?.id;
				}

				// Create new extension
				const [created] = yield* Effect.tryPromise(() =>
					db
						.insert(sessionExtension)
						.values({
							sessionId,
							organizationId,
							trustedDeviceId,
							deviceFingerprint: accessContext.deviceFingerprint,
							country: accessContext.country,
							region: accessContext.region,
							city: accessContext.city,
							accessPolicyId: policyId,
							mfaVerifiedAt: accessContext.mfaVerified ? new Date() : undefined,
							mfaMethod: accessContext.mfaMethod,
							lastActivityAt: new Date(),
							requestCount: 1,
						})
						.returning(),
				);

				return created;
			}),

		updateSessionActivity: (sessionId: string) =>
			Effect.gen(function* () {
				yield* Effect.tryPromise(() =>
					db
						.update(sessionExtension)
						.set({
							lastActivityAt: new Date(),
							requestCount: sql`${sessionExtension.requestCount} + 1`,
						})
						.where(eq(sessionExtension.sessionId, sessionId)),
				);
			}),

		logViolation: (params) =>
			Effect.gen(function* () {
				yield* Effect.tryPromise(() =>
					db.insert(accessViolationLog).values({
						organizationId: params.organizationId,
						userId: params.userId,
						sessionId: params.sessionId,
						violationType: params.violationType as typeof accessViolationLog.$inferInsert.violationType,
						policyId: params.policyId,
						ipAddress: params.context.ipAddress,
						country: params.context.country,
						userAgent: params.context.userAgent,
						actionTaken: params.actionTaken,
						metadata: {
							deviceFingerprint: params.context.deviceFingerprint,
						},
					}),
				);

				logger.warn(
					{
						userId: params.userId,
						organizationId: params.organizationId,
						violationType: params.violationType,
						actionTaken: params.actionTaken,
					},
					"Access violation logged",
				);
			}),

		getActivePolicies: (organizationId: string) =>
			Effect.tryPromise(() =>
				db.query.accessPolicy.findMany({
					where: and(eq(accessPolicy.organizationId, organizationId), eq(accessPolicy.enabled, true)),
					orderBy: [desc(accessPolicy.priority)],
				}),
			),

		checkConcurrentSessions: ({ userId, organizationId, maxSessions }) =>
			Effect.gen(function* () {
				const extensions = yield* Effect.tryPromise(() =>
					db.query.sessionExtension.findMany({
						where: eq(sessionExtension.organizationId, organizationId),
						with: {
							session: true,
						},
					}),
				);

				// Filter to valid sessions for this user
				const validSessions = extensions.filter(
					(ext) => ext.session?.userId === userId && ext.session?.expiresAt > new Date(),
				);

				return {
					allowed: validSessions.length < maxSessions,
					currentCount: validSessions.length,
				};
			}),

		terminateExcessSessions: ({ userId, organizationId, maxSessions, keepSessionId }) =>
			Effect.gen(function* () {
				const extensions = yield* Effect.tryPromise(() =>
					db.query.sessionExtension.findMany({
						where: eq(sessionExtension.organizationId, organizationId),
						with: {
							session: true,
						},
						orderBy: [desc(sessionExtension.lastActivityAt)],
					}),
				);

				// Filter to valid sessions for this user, excluding the current one
				const sessionsToTerminate = extensions
					.filter(
						(ext) =>
							ext.session?.userId === userId &&
							ext.session?.expiresAt > new Date() &&
							ext.sessionId !== keepSessionId,
					)
					.slice(maxSessions - 1); // Keep the most recent ones up to limit

				// Terminate excess sessions
				for (const ext of sessionsToTerminate) {
					yield* Effect.tryPromise(() =>
						db
							.update(schema.session)
							.set({ expiresAt: new Date() }) // Expire immediately
							.where(eq(schema.session.id, ext.sessionId)),
					);
				}

				logger.info(
					{ userId, organizationId, terminatedCount: sessionsToTerminate.length },
					"Excess sessions terminated",
				);

				return sessionsToTerminate.length;
			}),
	}),
);
