// ============================================
// TYPESCRIPT TYPE DEFINITIONS
// ============================================

// Auth method configuration type for custom domains
export type AuthConfig = {
	emailPasswordEnabled: boolean;
	socialProvidersEnabled: string[]; // ["google", "github", "linkedin", "apple"]
	ssoEnabled: boolean;
	ssoProviderId?: string; // Reference to ssoProvider.providerId
	passkeyEnabled: boolean;
};

// Type definitions for JSON fields
export type TimeRegulationBreakRulesPreset = {
	rules: Array<{
		workingMinutesThreshold: number;
		requiredBreakMinutes: number;
		options: Array<{
			splitCount: number | null;
			minimumSplitMinutes: number | null;
			minimumLongestSplitMinutes: number | null;
		}>;
	}>;
};

export type TimeRegulationViolationDetails = {
	actualMinutes?: number;
	limitMinutes?: number;
	breakTakenMinutes?: number;
	breakRequiredMinutes?: number;
	uninterruptedMinutes?: number;
	warningShownAt?: string;
	userContinued?: boolean;

	// Rest period violation details
	lastClockOutTime?: string; // ISO timestamp of last clock-out
	attemptedClockInTime?: string; // ISO timestamp of attempted clock-in
	restPeriodMinutes?: number; // Actual rest period (in minutes)
	requiredRestMinutes?: number; // Required rest period (typically 660 = 11h)

	// Overtime violation details
	overtimeMinutes?: number; // How many minutes of overtime
	overtimeThreshold?: number; // What the threshold was
	periodType?: "daily" | "weekly" | "monthly"; // What period this violation is for

	// Exception handling
	exceptionId?: string; // If an approved exception was used
	exceptionApprovedBy?: string; // Who approved the exception
};

// Type for work period auto-adjustment reason (break enforcement)
export type WorkPeriodAutoAdjustmentReason = {
	type: "break_enforcement";
	regulationId: string;
	regulationName: string;
	breakInsertedMinutes: number;
	breakInsertedAt: string; // ISO timestamp
	originalDurationMinutes: number;
	adjustedDurationMinutes: number;
	ruleApplied: {
		workingMinutesThreshold: number;
		requiredBreakMinutes: number;
	};
};

// Type for surcharge calculation details (stored as JSON)
export type SurchargeCalculationDetails = {
	workPeriodStartTime: string; // ISO timestamp
	workPeriodEndTime: string; // ISO timestamp
	rulesApplied: Array<{
		ruleId: string;
		ruleName: string;
		ruleType: string;
		percentage: number;
		qualifyingMinutes: number;
		surchargeMinutes: number;
	}>;
	overlapPolicy: "max_wins";
	calculatedAt: string; // ISO timestamp
};

// Type for dashboard widget order preferences
export type DashboardWidgetOrder = {
	order: string[];
	version: number;
};

// Type for work period pending changes (used when change policy requires approval)
export type WorkPeriodPendingChanges = {
	// Original times before the requested change
	originalStartTime: string; // ISO timestamp
	originalEndTime: string; // ISO timestamp
	originalDurationMinutes: number;
	// Requested changes
	requestedStartTime?: string; // ISO timestamp
	requestedEndTime?: string; // ISO timestamp
	requestedDurationMinutes?: number;
	// Metadata
	requestedAt: string; // ISO timestamp
	requestedBy: string; // User ID
	reason?: string;
	// For 0-day policy where clock-out itself triggers approval
	isNewClockOut?: boolean;
};

// ============================================
// COMPLIANCE TYPES
// ============================================

/**
 * Proactive compliance alert shown to employees during work sessions
 */
export type ComplianceAlert = {
	alertType:
		| "rest_period"
		| "overtime_daily"
		| "overtime_weekly"
		| "overtime_monthly"
		| "daily_hours"
		| "weekly_hours"
		| "monthly_hours"
		| "uninterrupted_work"
		| "break_required";
	severity: "info" | "warning" | "critical" | "violation";
	message: string;
	minutesRemaining?: number; // Minutes until limit reached
	thresholdMinutes?: number; // The configured limit
	currentMinutes?: number; // Current value
	percentOfLimit?: number; // Current as percentage of limit (0-100+)
	canRequestException?: boolean; // Whether employee can request an exception for this
};

/**
 * Aggregated overtime statistics for an employee
 */
export type OvertimeStats = {
	daily: {
		workedMinutes: number;
		thresholdMinutes: number | null;
		overtimeMinutes: number;
		percentOfThreshold: number | null;
	};
	weekly: {
		workedMinutes: number;
		thresholdMinutes: number | null;
		overtimeMinutes: number;
		percentOfThreshold: number | null;
	};
	monthly: {
		workedMinutes: number;
		thresholdMinutes: number | null;
		overtimeMinutes: number;
		percentOfThreshold: number | null;
	};
};

/**
 * Result of a rest period compliance check
 */
export type RestPeriodCheckResult = {
	canClockIn: boolean;
	enforcement: "block" | "warn" | "none";
	violation: {
		lastClockOutTime: string;
		restPeriodMinutes: number;
		requiredMinutes: number;
		shortfallMinutes: number;
	} | null;
	hasValidException: boolean;
	exceptionId?: string;
	minutesUntilAllowed?: number; // Minutes until rest period is complete
	nextAllowedClockIn?: Date; // When clock-in will be allowed
};

/**
 * Full compliance status for an employee
 */
export type ComplianceStatus = {
	isCompliant: boolean;
	alerts: ComplianceAlert[];
	stats: OvertimeStats;
	pendingExceptions: number;
	unacknowledgedViolations: number;
};

// Social OAuth provider type
export type SocialOAuthProvider = "google" | "github" | "linkedin" | "apple";

/**
 * Provider-specific configuration for social OAuth
 * Most providers just need clientId + clientSecret (stored in Vault)
 * Apple Sign In requires additional configuration
 */
export type SocialOAuthProviderConfig = {
	// Apple Sign In specific configuration
	apple?: {
		teamId: string; // Apple Developer Team ID
		keyId: string; // Key ID from Apple Developer Console
		// Private key is stored in Vault at: secret/organizations/{orgId}/social/apple/private_key
	};
};
