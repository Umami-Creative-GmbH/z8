import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { db as defaultDb } from "@/db";
import {
	type ApprovalDeliveryEffect,
	type ApprovalDeliveryLifecycle,
	type ApprovalDeliveryProvider,
	type ApprovalDeliveryReconciliationContext,
	type ApprovalDispatchAttemptState,
	type ChatCredentialSource,
	type ChatInstallationStatus,
	type ChatLegacyTableName,
	approvalDeliveryWork,
	chatInstallation,
	chatInstallationConversation,
	chatInstallationCredentialRevision,
	chatProviderSettings,
} from "@/db/schema";
import { type Instant, instantFromDate, systemClock } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { getOrgSecret } from "@/lib/vault";
import {
	type ClosedUnknownApprovalDeliveryWorkRow,
	closeExpiredUncertainApprovalDeliveryWork,
} from "./store";

const logger = createLogger("ApprovalDeliveryInstallationOrigin");

/**
 * Unresolved `uncertain_across_switch` approval delivery attempts close with an
 * explicit `unknown` outcome and Z8 inbox fallback after 7 full days (#2043).
 */
export const APPROVAL_DELIVERY_UNCERTAIN_CLOSURE_DAYS = 7;
export const APPROVAL_DELIVERY_UNCERTAIN_CLOSURE_DURATION = Temporal.Duration.from({
	hours: APPROVAL_DELIVERY_UNCERTAIN_CLOSURE_DAYS * 24,
});

export interface ChatInstallationOriginRecord {
	id: string;
	organizationId: string;
	provider: ApprovalDeliveryProvider;
	credentialSource: ChatCredentialSource;
	status: ChatInstallationStatus;
	routeId: string;
	externalAppId: string | null;
	externalBotId: string | null;
	externalSpaceId: string | null;
	receiverScope: string | null;
	activeCredentialRevisionId: string | null;
	legacyTable: ChatLegacyTableName | null;
	legacyRecordId: string | null;
	retirementDeadlineAt: Date | null;
	retiredAt: Date | null;
	revokedAt: Date | null;
}

export type ActiveApprovalDeliveryInstallationResolution =
	| { kind: "active"; installation: ChatInstallationOriginRecord }
	| { kind: "legacy"; installation: ChatInstallationOriginRecord }
	| { kind: "legacy_multi_tenant"; installations: ChatInstallationOriginRecord[] }
	| { kind: "remediation_required"; installations: ChatInstallationOriginRecord[] }
	| { kind: "none" }
	| { kind: "legacy_untracked" };

export type CardOriginResolution =
	| {
			kind: "serviceable";
			installation: ChatInstallationOriginRecord;
			matchedBy: "installation_id" | "receiver_scope";
			isRetiring: boolean;
	  }
	| {
			kind: "revoked";
			installationId: string;
			revokedAt: Date | null;
			fallback: "z8_inbox";
	  }
	| {
			kind: "retirement_expired";
			installationId: string;
			retirementDeadlineAt: Date | null;
			retiredAt: Date | null;
			fallback: "z8_inbox";
	  }
	| {
			kind: "ambiguous_inbox_fallback";
			reason:
				| "multiple_matching_installations"
				| "unrecognized_receiver_scope"
				| "missing_origin_evidence"
				| "installation_not_found"
				| "installation_not_serviceable";
			fallback: "z8_inbox";
	  }
	| {
			kind: "legacy_untracked";
	  };

export type InboundOriginEligibilityResult =
	| { allowed: true; installationId: string | null; isRetiring: boolean }
	| {
			allowed: false;
			reason:
				| "installation_revoked"
				| "installation_retirement_expired"
				| "origin_ambiguous"
				| "installation_mismatch";
			fallback: "z8_inbox";
	  };

export interface InstallationOutstandingApprovalCounts {
	organizationId: string;
	installationId: string;
	provider: ApprovalDeliveryProvider | null;
	openTrackedMessages: number;
	openCanonicalMessages: number;
	openLegacyOwnerMessages: number;
	outstandingWork: {
		total: number;
		initial: number;
		replacement: number;
		refresh: number;
		uncertainAcrossSwitch: number;
	};
	pendingLegacyCards: number;
	totalOutstanding: number;
}

export interface UncertainApprovalDeliveryOperationItem {
	workId: string;
	organizationId: string;
	provider: ApprovalDeliveryProvider;
	effect: ApprovalDeliveryEffect;
	lifecycle: ApprovalDeliveryLifecycle;
	workflowId: string | null;
	assignmentId: string | null;
	legacyApprovalRequestId: string | null;
	recipientEmployeeId: string;
	installationId: string | null;
	credentialRevisionId: string | null;
	dispatchIntentAt: string | null;
	dispatchAttemptState: "uncertain_across_switch" | "closed_unknown";
	reconciliationRequiredAt: string | null;
	unknownClosedAt: string | null;
	reconciliationContext: ApprovalDeliveryReconciliationContext | null;
	attemptCount: number;
	lastOutcome: string | null;
	fallback: "z8_inbox";
}

function rows(result: unknown): Record<string, unknown>[] {
	if (!result || typeof result !== "object" || !("rows" in result)) return [];
	const value = (result as { rows?: unknown }).rows;
	return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function toOriginRecord(row: typeof chatInstallation.$inferSelect): ChatInstallationOriginRecord {
	return {
		id: row.id,
		organizationId: row.organizationId,
		provider: row.provider,
		credentialSource: row.credentialSource,
		status: row.status,
		routeId: row.routeId,
		externalAppId: row.externalAppId,
		externalBotId: row.externalBotId,
		externalSpaceId: row.externalSpaceId,
		receiverScope: row.receiverScope,
		activeCredentialRevisionId: row.activeCredentialRevisionId,
		legacyTable: row.legacyTable,
		legacyRecordId: row.legacyRecordId,
		retirementDeadlineAt: row.retirementDeadlineAt,
		retiredAt: row.retiredAt,
		revokedAt: row.revokedAt,
	};
}

/**
 * Normalizes a card or invocation receiver scope to match the installation's
 * recorded `receiver_scope`. For Teams, inbound invocations append
 * `:conversation:<id>` to the tenant-level `teams-bot:<app>:tenant:<tenant>` scope.
 */
function normalizeReceiverScopeForInstallationMatch(scope: string): string {
	const trimmed = scope.trim();
	const conversationMarker = ":conversation:";
	const markerIndex = trimmed.indexOf(conversationMarker);
	if (trimmed.startsWith("teams-bot:") && markerIndex > 0) {
		return trimmed.slice(0, markerIndex);
	}
	return trimmed;
}

function evaluateInstallationServiceability(
	installation: ChatInstallationOriginRecord,
	matchedBy: "installation_id" | "receiver_scope",
	now: Instant,
): CardOriginResolution {
	if (installation.status === "revoked" || installation.revokedAt !== null) {
		return {
			kind: "revoked",
			installationId: installation.id,
			revokedAt: installation.revokedAt,
			fallback: "z8_inbox",
		};
	}

	if (installation.status === "retired" || installation.retiredAt !== null) {
		return {
			kind: "retirement_expired",
			installationId: installation.id,
			retirementDeadlineAt: installation.retirementDeadlineAt,
			retiredAt: installation.retiredAt,
			fallback: "z8_inbox",
		};
	}

	if (installation.status === "retiring") {
		if (
			installation.retirementDeadlineAt !== null &&
			Temporal.Instant.compare(instantFromDate(installation.retirementDeadlineAt), now) <= 0
		) {
			return {
				kind: "retirement_expired",
				installationId: installation.id,
				retirementDeadlineAt: installation.retirementDeadlineAt,
				retiredAt: installation.retiredAt,
				fallback: "z8_inbox",
			};
		}
		return {
			kind: "serviceable",
			installation,
			matchedBy,
			isRetiring: true,
		};
	}

	if (installation.status === "active" || installation.status === "legacy_active") {
		return {
			kind: "serviceable",
			installation,
			matchedBy,
			isRetiring: false,
		};
	}

	// ADR 0003: Legacy traffic stays on its existing route during remediation.
	// Candidate installations never service production approval cards.
	if (installation.status === "remediation_required" && installation.legacyTable !== null) {
		return {
			kind: "serviceable",
			installation,
			matchedBy,
			isRetiring: false,
		};
	}

	return {
		kind: "ambiguous_inbox_fallback",
		reason: "installation_not_serviceable",
		fallback: "z8_inbox",
	};
}

/**
 * Pure origin resolution over an organization's installations for a provider.
 * Uses recorded `installationId` first, then unique evidenced `receiverScope`
 * among non-candidate installations. Never guesses when multiple installations match.
 */
export function resolveOriginFromInstallations(input: {
	installations: readonly ChatInstallationOriginRecord[];
	installationId?: string | null;
	receiverScope?: string | null;
	now: Instant;
}): CardOriginResolution {
	if (input.installations.length === 0) {
		if (input.installationId) {
			return {
				kind: "ambiguous_inbox_fallback",
				reason: "installation_not_found",
				fallback: "z8_inbox",
			};
		}
		return { kind: "legacy_untracked" };
	}

	if (input.installationId) {
		const exact = input.installations.find((row) => row.id === input.installationId);
		if (!exact) {
			return {
				kind: "ambiguous_inbox_fallback",
				reason: "installation_not_found",
				fallback: "z8_inbox",
			};
		}
		return evaluateInstallationServiceability(exact, "installation_id", input.now);
	}

	const rawScope = input.receiverScope?.trim() ?? "";
	if (!rawScope) {
		return {
			kind: "ambiguous_inbox_fallback",
			reason: "missing_origin_evidence",
			fallback: "z8_inbox",
		};
	}

	const normalizedScope = normalizeReceiverScopeForInstallationMatch(rawScope);
	const eligibleCandidates = input.installations.filter((row) => row.status !== "candidate");
	const matches = eligibleCandidates.filter((row) => {
		if (!row.receiverScope) return false;
		return (
			row.receiverScope === rawScope ||
			normalizeReceiverScopeForInstallationMatch(row.receiverScope) === normalizedScope
		);
	});

	if (matches.length === 0) {
		return {
			kind: "ambiguous_inbox_fallback",
			reason: "unrecognized_receiver_scope",
			fallback: "z8_inbox",
		};
	}

	if (matches.length > 1) {
		return {
			kind: "ambiguous_inbox_fallback",
			reason: "multiple_matching_installations",
			fallback: "z8_inbox",
		};
	}

	const [matched] = matches;
	if (!matched) {
		return {
			kind: "ambiguous_inbox_fallback",
			reason: "unrecognized_receiver_scope",
			fallback: "z8_inbox",
		};
	}

	return evaluateInstallationServiceability(matched, "receiver_scope", input.now);
}

/**
 * Pure gate for inbound button presses on existing cards: ensures the card's
 * originating installation is still serviceable (not revoked, not past retirement
 * deadline, not ambiguous) and matches the inbound installation when known.
 */
export function evaluateInboundOriginEligibility(input: {
	origin: CardOriginResolution;
	incomingInstallationId?: string | null;
}): InboundOriginEligibilityResult {
	switch (input.origin.kind) {
		case "legacy_untracked":
			return { allowed: true, installationId: null, isRetiring: false };
		case "revoked":
			return { allowed: false, reason: "installation_revoked", fallback: "z8_inbox" };
		case "retirement_expired":
			return {
				allowed: false,
				reason: "installation_retirement_expired",
				fallback: "z8_inbox",
			};
		case "ambiguous_inbox_fallback":
			return { allowed: false, reason: "origin_ambiguous", fallback: "z8_inbox" };
		case "serviceable": {
			if (
				input.incomingInstallationId &&
				input.incomingInstallationId !== input.origin.installation.id
			) {
				return { allowed: false, reason: "installation_mismatch", fallback: "z8_inbox" };
			}
			return {
				allowed: true,
				installationId: input.origin.installation.id,
				isRetiring: input.origin.isRetiring,
			};
		}
	}
}

/**
 * Determines whether an in-flight / crashed / ambiguous approval delivery work
 * row must be quarantined into `uncertain_across_switch` instead of retried or
 * rerouted. Only `intent_recorded` attempts whose target installation is no
 * longer the organization's live installation are quarantined; `confirmed_unsent`
 * attempts may safely reroute to the new active installation under existing dedupe.
 */
export function shouldQuarantineAcrossSwitch(input: {
	dispatchAttemptState: ApprovalDispatchAttemptState | null;
	attemptedInstallationId: string | null;
	attemptedInstallationStatus: ChatInstallationStatus | null;
	activeInstallationId: string | null;
}): boolean {
	if (input.dispatchAttemptState !== "intent_recorded") {
		return false;
	}
	if (!input.attemptedInstallationId) {
		return false;
	}
	if (input.activeInstallationId && input.activeInstallationId !== input.attemptedInstallationId) {
		return true;
	}
	if (
		input.attemptedInstallationStatus !== null &&
		input.attemptedInstallationStatus !== "active" &&
		input.attemptedInstallationStatus !== "legacy_active"
	) {
		return true;
	}
	return false;
}

/**
 * Builds a strictly redacted diagnostic payload for `reconciliation_context`
 * and server error reporting. Never accepts tokens, secrets, or user content.
 */
export function buildRedactedReconciliationContext(input: {
	reason: ApprovalDeliveryReconciliationContext["reason"];
	provider: ApprovalDeliveryProvider;
	effect: ApprovalDeliveryEffect;
	attemptedInstallationId: string;
	attemptedCredentialRevisionId: string | null;
	activeInstallationId: string | null;
	dispatchIntentAt: Instant | null;
	detectedAt: Instant;
	failureReason?: string | null;
	attemptCount: number;
}): ApprovalDeliveryReconciliationContext {
	return {
		reason: input.reason,
		provider: input.provider,
		effect: input.effect,
		attemptedInstallationId: input.attemptedInstallationId,
		attemptedCredentialRevisionId: input.attemptedCredentialRevisionId,
		activeInstallationId: input.activeInstallationId,
		dispatchIntentAt: input.dispatchIntentAt ? input.dispatchIntentAt.toString() : null,
		detectedAt: input.detectedAt.toString(),
		...(input.failureReason ? { failureReason: input.failureReason } : {}),
		attemptCount: input.attemptCount,
		fallback: "z8_inbox",
	};
}

/**
 * Pure 7-day boundary check for closing unresolved uncertain delivery attempts.
 */
export function isUncertainWorkExpiredForUnknownClosure(input: {
	reconciliationRequiredAt: Instant;
	now: Instant;
}): boolean {
	const expiresAt = input.reconciliationRequiredAt.add(
		APPROVAL_DELIVERY_UNCERTAIN_CLOSURE_DURATION,
	);
	return Temporal.Instant.compare(input.now, expiresAt) >= 0;
}

async function loadOrganizationProviderInstallations(
	organizationId: string,
	provider: ApprovalDeliveryProvider,
): Promise<ChatInstallationOriginRecord[]> {
	const found = await defaultDb
		.select()
		.from(chatInstallation)
		.where(
			and(
				eq(chatInstallation.organizationId, organizationId),
				eq(chatInstallation.provider, provider),
			),
		)
		.orderBy(asc(chatInstallation.createdAt), asc(chatInstallation.id));
	return found.map(toOriginRecord);
}

/**
 * Resolves the organization's current active installation for new approval sends.
 * Returns `legacy_untracked` when the organization has no `chat_installation`
 * rows for the provider so legacy deployments and existing suites continue cleanly.
 */
export async function resolveActiveApprovalDeliveryInstallation(
	organizationId: string,
	provider: ApprovalDeliveryProvider,
): Promise<ActiveApprovalDeliveryInstallationResolution> {
	const installations = await loadOrganizationProviderInstallations(organizationId, provider);
	if (installations.length === 0) {
		return { kind: "legacy_untracked" };
	}

	const active = installations.find((row) => row.status === "active");
	if (active) {
		return { kind: "active", installation: active };
	}

	const legacyActive = installations.filter((row) => row.status === "legacy_active");
	if (legacyActive.length === 1 && legacyActive[0]) {
		return { kind: "legacy", installation: legacyActive[0] };
	}
	if (legacyActive.length > 1) {
		return { kind: "legacy_multi_tenant", installations: legacyActive };
	}

	const remediation = installations.filter((row) => row.status === "remediation_required");
	if (remediation.length > 0) {
		return { kind: "remediation_required", installations: remediation };
	}

	return { kind: "none" };
}

/**
 * Resolves a single installation row by `(organizationId, installationId)`.
 */
export async function loadOrganizationInstallationById(
	organizationId: string,
	installationId: string,
): Promise<ChatInstallationOriginRecord | null> {
	const [row] = await defaultDb
		.select()
		.from(chatInstallation)
		.where(
			and(
				eq(chatInstallation.organizationId, organizationId),
				eq(chatInstallation.id, installationId),
			),
		)
		.limit(1);
	return row ? toOriginRecord(row) : null;
}

/**
 * Resolves the originating installation for an existing approval card.
 * Checks recorded `installationId` first, then unique evidenced
 * `(organizationId, provider, receiverScope)`, honoring retirement deadlines
 * and revocations and falling back to Z8 inbox when historical origin is ambiguous.
 */
export async function resolveCardOriginInstallation(input: {
	organizationId: string;
	provider: ApprovalDeliveryProvider;
	installationId?: string | null;
	receiverScope?: string | null;
	now?: Instant;
}): Promise<CardOriginResolution> {
	const installations = await loadOrganizationProviderInstallations(
		input.organizationId,
		input.provider,
	);
	return resolveOriginFromInstallations({
		installations,
		installationId: input.installationId ?? null,
		receiverScope: input.receiverScope ?? null,
		now: input.now ?? systemClock.nowInstant(),
	});
}

/**
 * Checks whether an inbound approval card action arriving on a provider bot is
 * authorized by installation origin & retirement rules before invoking the
 * approval decision owner.
 */
export async function checkInboundApprovalCardInstallationEligibility(input: {
	organizationId: string;
	provider: ApprovalDeliveryProvider;
	incomingInstallationId?: string | null;
	incomingReceiverScope?: string | null;
	messageInstallationId?: string | null;
	messageReceiverScope?: string | null;
	now?: Instant;
}): Promise<InboundOriginEligibilityResult> {
	const origin = await resolveCardOriginInstallation({
		organizationId: input.organizationId,
		provider: input.provider,
		installationId: input.messageInstallationId ?? input.incomingInstallationId ?? null,
		receiverScope: input.messageReceiverScope ?? input.incomingReceiverScope ?? null,
		now: input.now,
	});
	return evaluateInboundOriginEligibility({
		origin,
		incomingInstallationId: input.incomingInstallationId ?? null,
	});
}

function buildRevisionSecretKey(prefix: string, key: string): string {
	const normalizedPrefix = prefix.replace(/\/+$/, "");
	const normalizedKey = key.replace(/^\/+/, "");
	if (!normalizedPrefix) return normalizedKey;
	if (normalizedKey.startsWith(`${normalizedPrefix}/`)) return normalizedKey;
	return `${normalizedPrefix}/${normalizedKey}`;
}

/**
 * Reads a secret value for a chat installation from its active immutable
 * credential revision (Vault / Scaleway), returning null if not configured or
 * if no revision exists. Callers may fall back to legacy secret keys only when
 * the installation is a legacy-backed row (`legacyTable !== null`).
 */
export async function resolveInstallationSecret(input: {
	installation: Pick<
		ChatInstallationOriginRecord,
		"id" | "organizationId" | "activeCredentialRevisionId"
	>;
	candidateKeyNames: readonly string[];
}): Promise<string | null> {
	if (!input.installation.activeCredentialRevisionId) {
		return null;
	}
	const [revision] = await defaultDb
		.select({
			id: chatInstallationCredentialRevision.id,
			secretKeyPrefix: chatInstallationCredentialRevision.secretKeyPrefix,
			secretKeys: chatInstallationCredentialRevision.secretKeys,
			status: chatInstallationCredentialRevision.status,
		})
		.from(chatInstallationCredentialRevision)
		.where(
			and(
				eq(chatInstallationCredentialRevision.id, input.installation.activeCredentialRevisionId),
				eq(chatInstallationCredentialRevision.installationId, input.installation.id),
				eq(chatInstallationCredentialRevision.organizationId, input.installation.organizationId),
			),
		)
		.limit(1);

	if (!revision || revision.status === "revoked" || revision.status === "cleaned_up") {
		return null;
	}

	const keysToTry: string[] = [];
	for (const candidate of input.candidateKeyNames) {
		const matched = revision.secretKeys.find(
			(stored) => stored === candidate || stored.endsWith(`/${candidate}`),
		);
		if (matched) {
			keysToTry.push(buildRevisionSecretKey(revision.secretKeyPrefix, matched));
		}
	}
	if (keysToTry.length === 0) {
		for (const candidate of input.candidateKeyNames) {
			keysToTry.push(buildRevisionSecretKey(revision.secretKeyPrefix, candidate));
		}
	}

	for (const secretKey of keysToTry) {
		const value = await getOrgSecret(input.installation.organizationId, secretKey);
		if (value) return value;
	}
	return null;
}

/**
 * Reads authoritative organization-level provider approval/escalation flags from
 * `chat_provider_settings` when `is_authoritative` is true. Returns null before
 * the first switch so legacy tables keep authority.
 */
export async function resolveAuthoritativeProviderApprovalSettings(
	organizationId: string,
	provider: ApprovalDeliveryProvider,
): Promise<{ enableApprovals: boolean; enableEscalations: boolean } | null> {
	const [settings] = await defaultDb
		.select({
			isAuthoritative: chatProviderSettings.isAuthoritative,
			enableApprovals: chatProviderSettings.enableApprovals,
			enableEscalations: chatProviderSettings.enableEscalations,
		})
		.from(chatProviderSettings)
		.where(
			and(
				eq(chatProviderSettings.organizationId, organizationId),
				eq(chatProviderSettings.provider, provider),
			),
		)
		.limit(1);

	if (!settings?.isAuthoritative) {
		return null;
	}
	return {
		enableApprovals: settings.enableApprovals,
		enableEscalations: settings.enableEscalations,
	};
}

/**
 * Resolves an active installation-scoped conversation for a user.
 */
export async function findActiveInstallationConversation(input: {
	organizationId: string;
	installationId: string;
	userId: string;
	conversationTypes?: readonly string[];
}): Promise<typeof chatInstallationConversation.$inferSelect | null> {
	const conditions = [
		eq(chatInstallationConversation.organizationId, input.organizationId),
		eq(chatInstallationConversation.installationId, input.installationId),
		eq(chatInstallationConversation.userId, input.userId),
		eq(chatInstallationConversation.isActive, true),
	];
	if (input.conversationTypes && input.conversationTypes.length > 0) {
		conditions.push(
			inArray(chatInstallationConversation.conversationType, [...input.conversationTypes]),
		);
	}
	const [conversation] = await defaultDb
		.select()
		.from(chatInstallationConversation)
		.where(and(...conditions))
		.orderBy(
			desc(chatInstallationConversation.verifiedAt),
			desc(chatInstallationConversation.lastUsedAt),
			desc(chatInstallationConversation.updatedAt),
		)
		.limit(1);
	return conversation ?? null;
}

/**
 * Finds the best-effort installationId to tag newly created legacy provider card
 * rows (`slack_approval_message`, `teams_approval_card`, `telegram_approval_message`,
 * `discord_approval_message`). Returns null if none is uniquely evidenced.
 */
export async function resolveLegacyCardInstallationId(input: {
	organizationId: string;
	provider: ApprovalDeliveryProvider;
	tenantId?: string | null;
}): Promise<string | null> {
	const active = await resolveActiveApprovalDeliveryInstallation(
		input.organizationId,
		input.provider,
	);
	if (active.kind === "active" || active.kind === "legacy") {
		return active.installation.id;
	}
	if (active.kind === "legacy_multi_tenant" && input.tenantId) {
		const matched = active.installations.find((row) => row.externalSpaceId === input.tenantId);
		return matched?.id ?? null;
	}
	return null;
}

/**
 * Counts outstanding approval cards and delivery work belonging to one
 * originating chat installation (#2043):
 * - Open canonical & legacy-owner `approval_delivery_message` rows (`state = 'current'`)
 *   attributed via `installation_id` or unique evidenced `receiver_scope`.
 * - Outstanding `initial`, `replacement`, `refresh`, and `uncertain_across_switch`
 *   `approval_delivery_work` rows for that installation (including refresh work
 *   pointing to an evidenced message of that installation).
 * - Legacy provider card rows (`slack_approval_message`, `teams_approval_card`,
 *   `telegram_approval_message`, `discord_approval_message`) ONLY where the
 *   underlying `approval_request.status = 'pending'` (a saved `status = 'sent'`
 *   alone never counts a decided or cancelled request).
 */
export async function countOutstandingApprovalWorkByInstallation(
	organizationId: string,
	installationId: string,
): Promise<InstallationOutstandingApprovalCounts> {
	const empty: InstallationOutstandingApprovalCounts = {
		organizationId,
		installationId,
		provider: null,
		openTrackedMessages: 0,
		openCanonicalMessages: 0,
		openLegacyOwnerMessages: 0,
		outstandingWork: {
			total: 0,
			initial: 0,
			replacement: 0,
			refresh: 0,
			uncertainAcrossSwitch: 0,
		},
		pendingLegacyCards: 0,
		totalOutstanding: 0,
	};

	const target = await loadOrganizationInstallationById(organizationId, installationId);
	if (!target) {
		return empty;
	}

	const providerInstallations = await loadOrganizationProviderInstallations(
		organizationId,
		target.provider,
	);
	const nonCandidateInstallations = providerInstallations.filter(
		(row) => row.status !== "candidate",
	);

	// A historical row with installation_id IS NULL can only be attributed to this
	// installation via receiver_scope if no other non-candidate installation shares it.
	const uniqueReceiverScope =
		target.receiverScope &&
		nonCandidateInstallations.filter((row) => row.receiverScope === target.receiverScope).length ===
			1
			? target.receiverScope
			: null;

	const messageRows = rows(
		await defaultDb.execute(sql`
			select m.lifecycle, count(*)::int as cnt
			from approval_delivery_message m
			where m.organization_id = ${organizationId}
				and m.provider = ${target.provider}
				and m.state = 'current'
				and (
					m.installation_id = ${installationId}::uuid
					${
						uniqueReceiverScope
							? sql`or (m.installation_id is null and m.receiver_scope = ${uniqueReceiverScope})`
							: sql``
					}
				)
			group by m.lifecycle
		`),
	);

	let openCanonicalMessages = 0;
	let openLegacyOwnerMessages = 0;
	for (const row of messageRows) {
		const count = Number(row.cnt ?? 0);
		if (row.lifecycle === "canonical") openCanonicalMessages += count;
		else if (row.lifecycle === "legacy") openLegacyOwnerMessages += count;
	}
	const openTrackedMessages = openCanonicalMessages + openLegacyOwnerMessages;

	const workRows = rows(
		await defaultDb.execute(sql`
			select d.effect,
				coalesce(d.dispatch_attempt_state, 'none') as attempt_state,
				count(*)::int as cnt
			from approval_delivery_work d
			left join approval_delivery_message m
				on m.id = d.message_id
				and m.organization_id = d.organization_id
			where d.organization_id = ${organizationId}
				and d.provider = ${target.provider}
				and (
					d.status in ('pending', 'processing', 'awaiting_repair', 'exhausted')
					or (
						d.dispatch_attempt_state = 'uncertain_across_switch'
						and d.unknown_closed_at is null
					)
				)
				and coalesce(d.dispatch_attempt_state, 'none') <> 'closed_unknown'
				and (
					d.installation_id = ${installationId}::uuid
					or (
						d.effect = 'refresh'
						and d.installation_id is null
						and m.id is not null
						and (
							m.installation_id = ${installationId}::uuid
							${
								uniqueReceiverScope
									? sql`or (m.installation_id is null and m.receiver_scope = ${uniqueReceiverScope})`
									: sql``
							}
						)
					)
				)
			group by d.effect, coalesce(d.dispatch_attempt_state, 'none')
		`),
	);

	let initialWork = 0;
	let replacementWork = 0;
	let refreshWork = 0;
	let uncertainWork = 0;
	let totalWork = 0;
	for (const row of workRows) {
		const count = Number(row.cnt ?? 0);
		totalWork += count;
		if (row.attempt_state === "uncertain_across_switch") {
			uncertainWork += count;
		}
		if (row.effect === "initial") initialWork += count;
		else if (row.effect === "replacement") replacementWork += count;
		else if (row.effect === "refresh") refreshWork += count;
	}

	const legacyInstallationsForProvider = nonCandidateInstallations.filter(
		(row) => row.legacyTable !== null,
	);
	const isUniqueLegacyInstallation =
		target.legacyTable !== null && legacyInstallationsForProvider.length === 1;

	const pendingLegacyCards = await countPendingLegacyCardsForInstallation({
		organizationId,
		installation: target,
		isUniqueLegacyInstallation,
	});

	return {
		organizationId,
		installationId,
		provider: target.provider,
		openTrackedMessages,
		openCanonicalMessages,
		openLegacyOwnerMessages,
		outstandingWork: {
			total: totalWork,
			initial: initialWork,
			replacement: replacementWork,
			refresh: refreshWork,
			uncertainAcrossSwitch: uncertainWork,
		},
		pendingLegacyCards,
		totalOutstanding: openTrackedMessages + totalWork + pendingLegacyCards,
	};
}

async function countPendingLegacyCardsForInstallation(input: {
	organizationId: string;
	installation: ChatInstallationOriginRecord;
	isUniqueLegacyInstallation: boolean;
}): Promise<number> {
	const { organizationId, installation, isUniqueLegacyInstallation } = input;
	switch (installation.provider) {
		case "telegram": {
			const [row] = rows(
				await defaultDb.execute(sql`
					select count(*)::int as cnt
					from telegram_approval_message c
					join approval_request r
						on r.id = c.approval_request_id
						and r.organization_id = c.organization_id
					where c.organization_id = ${organizationId}
						and c.status = 'sent'
						and r.status = 'pending'
						and (
							c.installation_id = ${installation.id}::uuid
							${isUniqueLegacyInstallation ? sql`or c.installation_id is null` : sql``}
						)
				`),
			);
			return Number(row?.cnt ?? 0);
		}
		case "slack": {
			const [row] = rows(
				await defaultDb.execute(sql`
					select count(*)::int as cnt
					from slack_approval_message c
					join approval_request r
						on r.id = c.approval_request_id
						and r.organization_id = c.organization_id
					where c.organization_id = ${organizationId}
						and c.status = 'sent'
						and r.status = 'pending'
						and (
							c.installation_id = ${installation.id}::uuid
							${isUniqueLegacyInstallation ? sql`or c.installation_id is null` : sql``}
						)
				`),
			);
			return Number(row?.cnt ?? 0);
		}
		case "discord": {
			const [row] = rows(
				await defaultDb.execute(sql`
					select count(*)::int as cnt
					from discord_approval_message c
					join approval_request r
						on r.id = c.approval_request_id
						and r.organization_id = c.organization_id
					where c.organization_id = ${organizationId}
						and c.status = 'sent'
						and r.status = 'pending'
						and (
							c.installation_id = ${installation.id}::uuid
							${isUniqueLegacyInstallation ? sql`or c.installation_id is null` : sql``}
						)
				`),
			);
			return Number(row?.cnt ?? 0);
		}
		case "teams": {
			const legacyTenantMatch =
				installation.legacyTable === "teams_tenant_config" && installation.externalSpaceId
					? isUniqueLegacyInstallation
						? sql`or c.installation_id is null`
						: sql`or (
								c.installation_id is null
								and exists (
									select 1 from teams_conversation tc
									where tc.organization_id = c.organization_id
										and tc.teams_conversation_id = c.teams_conversation_id
										and tc.teams_tenant_id = ${installation.externalSpaceId}
								)
							)`
					: sql``;
			const [row] = rows(
				await defaultDb.execute(sql`
					select count(*)::int as cnt
					from teams_approval_card c
					join approval_request r
						on r.id = c.approval_request_id
						and r.organization_id = c.organization_id
					where c.organization_id = ${organizationId}
						and c.status = 'sent'
						and r.status = 'pending'
						and (
							c.installation_id = ${installation.id}::uuid
							${legacyTenantMatch}
						)
				`),
			);
			return Number(row?.cnt ?? 0);
		}
	}
}

/**
 * Closes unresolved `uncertain_across_switch` approval delivery attempts whose
 * reconciliation period has reached or exceeded 7 full days, transitioning them
 * to explicit `closed_unknown` with Z8 inbox fallback (#2043).
 */
export async function closeExpiredUncertainApprovalDeliveries(
	input: { organizationId?: string; now?: Instant } | Instant = {},
): Promise<{
	closedCount: number;
	closedWork: ClosedUnknownApprovalDeliveryWorkRow[];
}> {
	const normalized = input instanceof Temporal.Instant ? { now: input } : input;
	const now = normalized.now ?? systemClock.nowInstant();
	const cutoff = now.subtract(APPROVAL_DELIVERY_UNCERTAIN_CLOSURE_DURATION);
	const closedWork = await closeExpiredUncertainApprovalDeliveryWork({
		...(normalized.organizationId ? { organizationId: normalized.organizationId } : {}),
		cutoff,
		now,
	});
	if (closedWork.length > 0) {
		logger.warn(
			{
				closedCount: closedWork.length,
				workIds: closedWork.map((row) => row.id),
				organizationId: normalized.organizationId ?? null,
				closedAt: now.toString(),
				fallback: "z8_inbox",
			},
			"Closed expired uncertain approval delivery attempts as unknown after 7 days",
		);
	}
	return { closedCount: closedWork.length, closedWork };
}

/**
 * Lists uncertain-across-switch (and optionally closed-unknown) approval delivery
 * work rows for platform operations investigation with redacted context (#2043).
 */
export async function listUncertainApprovalDeliveriesForOperations(input: {
	organizationId: string;
	includeClosed?: boolean;
	limit?: number;
}): Promise<UncertainApprovalDeliveryOperationItem[]> {
	const states: Array<"uncertain_across_switch" | "closed_unknown"> = input.includeClosed
		? ["uncertain_across_switch", "closed_unknown"]
		: ["uncertain_across_switch"];
	const found = await defaultDb
		.select({
			id: approvalDeliveryWork.id,
			organizationId: approvalDeliveryWork.organizationId,
			provider: approvalDeliveryWork.provider,
			effect: approvalDeliveryWork.effect,
			lifecycle: approvalDeliveryWork.lifecycle,
			workflowId: approvalDeliveryWork.workflowId,
			assignmentId: approvalDeliveryWork.assignmentId,
			legacyApprovalRequestId: approvalDeliveryWork.legacyApprovalRequestId,
			recipientEmployeeId: approvalDeliveryWork.recipientEmployeeId,
			installationId: approvalDeliveryWork.installationId,
			credentialRevisionId: approvalDeliveryWork.credentialRevisionId,
			dispatchIntentAt: approvalDeliveryWork.dispatchIntentAt,
			dispatchAttemptState: approvalDeliveryWork.dispatchAttemptState,
			reconciliationRequiredAt: approvalDeliveryWork.reconciliationRequiredAt,
			unknownClosedAt: approvalDeliveryWork.unknownClosedAt,
			reconciliationContext: approvalDeliveryWork.reconciliationContext,
			attemptCount: approvalDeliveryWork.attemptCount,
			lastOutcome: approvalDeliveryWork.lastOutcome,
		})
		.from(approvalDeliveryWork)
		.where(
			and(
				eq(approvalDeliveryWork.organizationId, input.organizationId),
				inArray(approvalDeliveryWork.dispatchAttemptState, states),
				...(input.includeClosed ? [] : [isNull(approvalDeliveryWork.unknownClosedAt)]),
			),
		)
		.orderBy(desc(approvalDeliveryWork.reconciliationRequiredAt), asc(approvalDeliveryWork.id))
		.limit(input.limit ?? 100);

	return found
		.filter(
			(
				row,
			): row is typeof row & {
				dispatchAttemptState: "uncertain_across_switch" | "closed_unknown";
			} =>
				row.dispatchAttemptState === "uncertain_across_switch" ||
				row.dispatchAttemptState === "closed_unknown",
		)
		.map((row) => ({
			workId: row.id,
			organizationId: row.organizationId,
			provider: row.provider,
			effect: row.effect,
			lifecycle: row.lifecycle,
			workflowId: row.workflowId,
			assignmentId: row.assignmentId,
			legacyApprovalRequestId: row.legacyApprovalRequestId,
			recipientEmployeeId: row.recipientEmployeeId,
			installationId: row.installationId,
			credentialRevisionId: row.credentialRevisionId,
			dispatchIntentAt: row.dispatchIntentAt?.toISOString() ?? null,
			dispatchAttemptState: row.dispatchAttemptState,
			reconciliationRequiredAt: row.reconciliationRequiredAt?.toISOString() ?? null,
			unknownClosedAt: row.unknownClosedAt?.toISOString() ?? null,
			reconciliationContext: row.reconciliationContext,
			attemptCount: row.attemptCount,
			lastOutcome: row.lastOutcome,
			fallback: "z8_inbox",
		}));
}
