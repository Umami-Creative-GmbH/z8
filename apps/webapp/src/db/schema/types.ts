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
