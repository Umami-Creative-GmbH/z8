import { and, eq, sql } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import {
	type ChatInstallationProvider,
	approvalDeliveryControl,
	approvalEscalationPolicy,
	chatProviderSettings,
	discordBotConfig,
	slackWorkspaceConfig,
	teamsTenantConfig,
	telegramBotConfig,
} from "@/db/schema";
import { parseApprovalLifecycleMode, resolveApprovalAuthority } from "@/lib/approvals/authority";
import {
	getApprovalPilotAdmission,
	PILOT_WORKFLOW_TYPES,
	type PilotAdmissionMode,
	type PilotAuthority,
	type PilotWorkflowType,
} from "@/lib/approvals/pilot/readiness";
import type { ChatEffectiveSettings } from "./types";

export type ApprovalKindSupportMode = "in_chat_decision" | "review_in_z8" | "unverified";

export type ChatFeatureCapabilityKind =
	| "notifications"
	| "commands"
	| "daily_digest"
	| "escalations"
	| "approvals";

export type ChatFeatureCapabilityNoteCode =
	| "slack_review_in_z8"
	| "escalation_policy_owns_timing"
	| null;

export interface ApprovalKindDisclosure {
	workflowType: PilotWorkflowType;
	authority: PilotAuthority;
	supportMode: ApprovalKindSupportMode;
	deliveryActive: boolean;
}

export interface ChatFeatureCapabilityItem {
	capability: ChatFeatureCapabilityKind;
	enabled: boolean;
	supported: boolean;
	noteCode: ChatFeatureCapabilityNoteCode;
}

export interface EscalationPolicyDisclosure {
	policyOwned: boolean;
	policyEnabled: boolean | null;
	responseWindowHours: number | null;
	/** True when `approval_escalation_policy` owns timing, so the channel setting controls delivery only. */
	channelControlsDeliveryOnly: boolean;
}

export interface ProviderCapabilityDisclosure {
	provider: ChatInstallationProvider;
	escalationPolicy: EscalationPolicyDisclosure;
	capabilities: ChatFeatureCapabilityItem[];
	approvalKinds: ApprovalKindDisclosure[];
}

export type CapabilityDisclosureDb = Pick<typeof defaultDb, "select" | "execute">;

export function mapPilotAdmissionToSupportMode(mode: PilotAdmissionMode): ApprovalKindSupportMode {
	switch (mode) {
		case "actionable":
			return "in_chat_decision";
		case "review_only":
			return "review_in_z8";
		case "unverified":
			return "unverified";
	}
}

/**
 * Pure builder deriving feature & approval-kind readiness directly from the
 * existing approval pilot admission matrix, authority modes, delivery controls,
 * effective channel settings, and `approval_escalation_policy`.
 */
export function buildProviderCapabilityDisclosure(input: {
	provider: ChatInstallationProvider;
	effectiveSettings: ChatEffectiveSettings | null;
	authorityByWorkflowType: Record<PilotWorkflowType, PilotAuthority>;
	deliveryActiveWorkflowTypes: ReadonlySet<PilotWorkflowType>;
	escalationPolicy: {
		enabled: boolean;
		responseWindowHours: number;
	} | null;
}): ProviderCapabilityDisclosure {
	const approvalKinds: ApprovalKindDisclosure[] = PILOT_WORKFLOW_TYPES.map((workflowType) => {
		const authority = input.authorityByWorkflowType[workflowType];
		const admission = getApprovalPilotAdmission(workflowType, authority, input.provider);
		return {
			workflowType,
			authority,
			supportMode: mapPilotAdmissionToSupportMode(admission),
			deliveryActive: input.deliveryActiveWorkflowTypes.has(workflowType),
		};
	});

	const escalationPolicy: EscalationPolicyDisclosure = input.escalationPolicy
		? {
				policyOwned: true,
				policyEnabled: input.escalationPolicy.enabled,
				responseWindowHours: input.escalationPolicy.responseWindowHours,
				channelControlsDeliveryOnly: true,
			}
		: {
				policyOwned: false,
				policyEnabled: null,
				responseWindowHours: null,
				channelControlsDeliveryOnly: false,
			};

	const settings = input.effectiveSettings;
	const capabilities: ChatFeatureCapabilityItem[] = [
		{
			capability: "notifications",
			enabled: settings !== null,
			supported: true,
			noteCode: null,
		},
		{
			capability: "commands",
			enabled: settings?.enableCommands ?? false,
			supported: true,
			noteCode: null,
		},
		{
			capability: "daily_digest",
			enabled: settings?.enableDailyDigest ?? false,
			supported: true,
			noteCode: null,
		},
		{
			capability: "escalations",
			enabled: settings?.enableEscalations ?? false,
			supported: true,
			noteCode: escalationPolicy.channelControlsDeliveryOnly
				? "escalation_policy_owns_timing"
				: null,
		},
		{
			capability: "approvals",
			enabled: settings?.enableApprovals ?? false,
			supported: approvalKinds.some((kind) => kind.supportMode !== "unverified"),
			noteCode: input.provider === "slack" ? "slack_review_in_z8" : null,
		},
	];

	return {
		provider: input.provider,
		escalationPolicy,
		capabilities,
		approvalKinds,
	};
}

function rows(result: unknown): Array<Record<string, unknown>> {
	if (!result || typeof result !== "object" || !("rows" in result)) return [];
	return Array.isArray(result.rows) ? (result.rows as Array<Record<string, unknown>>) : [];
}

async function loadEffectiveSettings(
	db: CapabilityDisclosureDb,
	organizationId: string,
	provider: ChatInstallationProvider,
): Promise<ChatEffectiveSettings | null> {
	const [authoritative] = await db
		.select()
		.from(chatProviderSettings)
		.where(
			and(
				eq(chatProviderSettings.organizationId, organizationId),
				eq(chatProviderSettings.provider, provider),
			),
		)
		.limit(1);

	if (authoritative?.isAuthoritative) {
		return {
			enableApprovals: authoritative.enableApprovals,
			enableCommands: authoritative.enableCommands,
			enableDailyDigest: authoritative.enableDailyDigest,
			enableEscalations: authoritative.enableEscalations,
			digestTime: authoritative.digestTime,
			digestTimezone: authoritative.digestTimezone,
			escalationTimeoutHours: authoritative.escalationTimeoutHours,
		};
	}

	if (provider === "slack") {
		const [row] = await db
			.select()
			.from(slackWorkspaceConfig)
			.where(eq(slackWorkspaceConfig.organizationId, organizationId))
			.limit(1);
		if (row && row.setupStatus !== "disconnected") return row;
	} else if (provider === "telegram") {
		const [row] = await db
			.select()
			.from(telegramBotConfig)
			.where(eq(telegramBotConfig.organizationId, organizationId))
			.limit(1);
		if (row && row.setupStatus !== "disconnected") return row;
	} else if (provider === "discord") {
		const [row] = await db
			.select()
			.from(discordBotConfig)
			.where(eq(discordBotConfig.organizationId, organizationId))
			.limit(1);
		if (row && row.setupStatus !== "disconnected") return row;
	} else if (provider === "teams") {
		const found = await db
			.select()
			.from(teamsTenantConfig)
			.where(eq(teamsTenantConfig.organizationId, organizationId));
		const primary =
			found.find((row) => row.setupStatus === "active") ??
			found.find((row) => row.setupStatus !== "disconnected") ??
			null;
		if (primary) return primary;
	}

	return null;
}

/**
 * Loads organization-scoped feature and approval-kind capability disclosures for one provider.
 */
export async function getProviderCapabilityDisclosure(
	organizationId: string,
	provider: ChatInstallationProvider,
	deps?: { db?: CapabilityDisclosureDb },
): Promise<ProviderCapabilityDisclosure> {
	const db = deps?.db ?? defaultDb;

	const [effectiveSettings, rolloutResult, deliveryControls, policyRows] = await Promise.all([
		loadEffectiveSettings(db, organizationId, provider),
		db.execute(sql`
			select workflow_type, lifecycle_mode
			from approval_workflow_rollout
			where organization_id = ${organizationId}
		`),
		db
			.select({ workflowType: approvalDeliveryControl.workflowType })
			.from(approvalDeliveryControl)
			.where(
				and(
					eq(approvalDeliveryControl.organizationId, organizationId),
					eq(approvalDeliveryControl.provider, provider),
				),
			),
		db
			.select({
				enabled: approvalEscalationPolicy.enabled,
				responseWindowHours: approvalEscalationPolicy.responseWindowHours,
			})
			.from(approvalEscalationPolicy)
			.where(eq(approvalEscalationPolicy.organizationId, organizationId))
			.limit(1),
	]);

	const lifecycleModeByType = new Map<string, string>();
	for (const row of rows(rolloutResult)) {
		if (typeof row.workflow_type === "string" && typeof row.lifecycle_mode === "string") {
			lifecycleModeByType.set(row.workflow_type, row.lifecycle_mode);
		}
	}

	const authorityByWorkflowType = {} as Record<PilotWorkflowType, PilotAuthority>;
	for (const workflowType of PILOT_WORKFLOW_TYPES) {
		const rawMode = lifecycleModeByType.get(workflowType) ?? null;
		const parsedMode = rawMode !== null ? parseApprovalLifecycleMode(rawMode) : null;
		authorityByWorkflowType[workflowType] = resolveApprovalAuthority(parsedMode).authority;
	}

	const deliveryActiveWorkflowTypes = new Set<PilotWorkflowType>(
		deliveryControls
			.map((row) => row.workflowType)
			.filter((wt): wt is PilotWorkflowType =>
				(PILOT_WORKFLOW_TYPES as readonly string[]).includes(wt),
			),
	);

	const policy = policyRows[0] ?? null;

	return buildProviderCapabilityDisclosure({
		provider,
		effectiveSettings,
		authorityByWorkflowType,
		deliveryActiveWorkflowTypes,
		escalationPolicy: policy
			? {
					enabled: policy.enabled,
					responseWindowHours: policy.responseWindowHours,
				}
			: null,
	});
}
