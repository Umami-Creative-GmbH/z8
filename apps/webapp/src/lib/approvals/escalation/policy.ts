import type {
	ApprovalEscalationChannel,
	ApprovalEscalationPolicyConflict,
	ApprovalEscalationPolicyProvenance,
	ApprovalEscalationPolicySource,
} from "@/db/schema";

/** Response window used only when no enabled active source supplies a valid one. */
export const DEFAULT_ESCALATION_RESPONSE_WINDOW_HOURS = 24;
export const MAX_ESCALATION_RESPONSE_WINDOW_HOURS = 24 * 30;

export const ESCALATION_CHANNELS: readonly ApprovalEscalationChannel[] = [
	"slack",
	"telegram",
	"discord",
	"teams",
];

export interface EscalationPolicySourceInput {
	channel: ApprovalEscalationChannel;
	sourceId: string;
	displayName: string | null;
	setupStatus: string;
	escalationEnabled: boolean;
	escalationTimeoutHours: number;
}

export interface MigratedEscalationPolicy {
	enabled: boolean;
	responseWindowHours: number;
	provenance: ApprovalEscalationPolicyProvenance;
	conflictReviewStatus: "none" | "pending";
}

export function isValidEscalationResponseWindowHours(hours: number): boolean {
	return (
		Number.isInteger(hours) &&
		hours >= 1 &&
		hours <= MAX_ESCALATION_RESPONSE_WINDOW_HOURS
	);
}

function compareSources(
	a: EscalationPolicySourceInput,
	b: EscalationPolicySourceInput,
) {
	const channelOrder =
		ESCALATION_CHANNELS.indexOf(a.channel) -
		ESCALATION_CHANNELS.indexOf(b.channel);
	if (channelOrder !== 0) return channelOrder;
	return a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0;
}

/**
 * Settings migration from per-integration escalation settings to the single
 * organization policy (#251 §4):
 *
 * - Enabled when at least one *active* integration enables escalation.
 * - Response window is the shortest valid timeout among those sources, which
 *   preserves the earliest point at which existing automation could act.
 * - Each integration keeps its own toggle as its escalation-delivery
 *   preference, so a disabled channel never starts sending as a side effect.
 * - Otherwise the policy starts disabled.
 *
 * Every inspected source and any conflicting settings are returned as
 * provenance so administrators can review what the migration decided.
 */
export function deriveMigratedEscalationPolicy(
	inputs: readonly EscalationPolicySourceInput[],
): MigratedEscalationPolicy {
	const ordered = [...inputs].sort(compareSources);
	const isActive = (source: EscalationPolicySourceInput) =>
		source.setupStatus === "active";
	const enabledActive = ordered.filter(
		(source) => isActive(source) && source.escalationEnabled,
	);
	const validEnabledActive = enabledActive.filter((source) =>
		isValidEscalationResponseWindowHours(source.escalationTimeoutHours),
	);
	const enabled = enabledActive.length > 0;
	const responseWindowHours =
		validEnabledActive.length > 0
			? Math.min(
					...validEnabledActive.map((source) => source.escalationTimeoutHours),
				)
			: DEFAULT_ESCALATION_RESPONSE_WINDOW_HOURS;

	const conflicts: ApprovalEscalationPolicyConflict[] = [];
	const addConflict = (
		code: ApprovalEscalationPolicyConflict["code"],
		sources: EscalationPolicySourceInput[],
	) => {
		if (sources.length > 0) {
			conflicts.push({
				code,
				sourceIds: sources.map((source) => source.sourceId),
			});
		}
	};

	const distinctTimeouts = new Set(
		validEnabledActive.map((source) => source.escalationTimeoutHours),
	);
	addConflict(
		"differing_timeouts",
		distinctTimeouts.size > 1 ? validEnabledActive : [],
	);
	addConflict(
		"invalid_timeout",
		enabledActive.filter(
			(source) =>
				!isValidEscalationResponseWindowHours(source.escalationTimeoutHours),
		),
	);
	addConflict(
		"disabled_active_source",
		enabled
			? ordered.filter(
					(source) => isActive(source) && !source.escalationEnabled,
				)
			: [],
	);
	addConflict(
		"inactive_source_enabled",
		ordered.filter((source) => !isActive(source) && source.escalationEnabled),
	);

	const contributing = new Set(
		validEnabledActive.map((source) => source.sourceId),
	);
	const sources: ApprovalEscalationPolicySource[] = ordered.map((source) => ({
		channel: source.channel,
		sourceId: source.sourceId,
		displayName: source.displayName,
		setupStatus: source.setupStatus,
		active: isActive(source),
		escalationEnabled: source.escalationEnabled,
		escalationTimeoutHours: source.escalationTimeoutHours,
		contributed: contributing.has(source.sourceId),
	}));

	return {
		enabled,
		responseWindowHours,
		provenance: {
			rule: "active_escalation_enabled_shortest_timeout@1",
			outcome: enabled ? "enabled_from_sources" : "disabled_no_enabled_source",
			sources,
			conflicts,
		},
		conflictReviewStatus: conflicts.length > 0 ? "pending" : "none",
	};
}

export interface EscalationChannelDeliveryPreference {
	channel: ApprovalEscalationChannel;
	sourceId: string;
	displayName: string | null;
	active: boolean;
	/** The integration's own escalation toggle, now a delivery preference only. */
	deliversEscalations: boolean;
	/** Legacy per-channel timeout; no longer an escalation deadline once the organization owns escalation. */
	legacyTimeoutHours: number;
	/** The legacy timeout differs from the organization response window. */
	legacyTimeoutDiffers: boolean;
}

/** Current per-channel settings compared against the organization policy. */
export function describeChannelDeliveryPreferences(
	inputs: readonly EscalationPolicySourceInput[],
	policy: { responseWindowHours: number },
): EscalationChannelDeliveryPreference[] {
	return [...inputs].sort(compareSources).map((source) => ({
		channel: source.channel,
		sourceId: source.sourceId,
		displayName: source.displayName,
		active: source.setupStatus === "active",
		deliversEscalations: source.escalationEnabled,
		legacyTimeoutHours: source.escalationTimeoutHours,
		legacyTimeoutDiffers:
			source.escalationEnabled &&
			source.escalationTimeoutHours !== policy.responseWindowHours,
	}));
}
