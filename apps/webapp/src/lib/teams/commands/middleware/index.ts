/**
 * Teams Bot Command Middleware
 *
 * Exports rate limiting and permission middleware for command handlers.
 */

export {
	withRateLimit,
	checkCommandRateLimit,
	COMMAND_RATE_LIMITS,
	type CommandRateLimitConfig,
	type RateLimitResult,
} from "./rate-limit.middleware";

export {
	withPermission,
	checkPermissions,
	getManagedEmployeeIds,
	compose,
	type RequiredRole,
	type PermissionCheckResult,
} from "./permissions.middleware";
