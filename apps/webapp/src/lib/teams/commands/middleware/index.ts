/**
 * Teams Bot Command Middleware
 *
 * Exports rate limiting and permission middleware for command handlers.
 */

export {
	checkPermissions,
	compose,
	getManagedEmployeeIds,
	type PermissionCheckResult,
	type RequiredRole,
	withPermission,
} from "./permissions.middleware";
export {
	COMMAND_RATE_LIMITS,
	type CommandRateLimitConfig,
	checkCommandRateLimit,
	type RateLimitResult,
	withRateLimit,
} from "./rate-limit.middleware";
