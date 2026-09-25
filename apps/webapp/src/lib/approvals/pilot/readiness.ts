import { and, eq, type SQL, sql } from "drizzle-orm";
import { db } from "@/db";
import {
	APPROVAL_DELIVERY_PROVIDERS,
	type ApprovalDeliveryProvider,
	type ApprovalDeliveryStatus,
	absenceEntry,
	approvalDeliveryControl,
	approvalEscalationControl,
	approvalEscalationPolicy,
	travelExpenseClaim,
} from "@/db/schema";
import { readApprovalPresentationMode } from "../evidence/invocation";
import { readApprovalEvidenceMode } from "../evidence/store";
import {
	type AbsenceReviewEvidence,
	prepareAbsenceReviewEvidence,
} from "../presentation/absence-review";
import {
	prepareTravelExpenseReviewEvidence,
	type TravelExpenseReviewEvidence,
} from "../presentation/travel-expense-review";
import type { ApprovalDatabase } from "../server/types";

/**
 * Read-only readiness report for the non-time approval pilot (#328 / T63):
 * one organization's absence and expense card combinations, classified from a
 * single consistent snapshot. It changes nothing; repairs, backfills and
 * control changes stay with the separately authorized adoption writer.
 */

export const PILOT_WORKFLOW_TYPES = ["absence", "travel_expense"] as const;
export type PilotWorkflowType = (typeof PILOT_WORKFLOW_TYPES)[number];

export type PilotVerdict = "ready" | "hold" | "blocked";

/**
 * Card combinations the pilot admits: absence cards on every provider (Slack
 * review-only, #294), expense cards on Telegram only (#296). Anything else has
 * no verified card path and must not be activated.
 */
const PILOT_ADMISSION: Record<
	PilotWorkflowType,
	Record<ApprovalDeliveryProvider, "actionable" | "review_only" | "unverified">
> = {
	absence: {
		telegram: "actionable",
		teams: "actionable",
		discord: "actionable",
		slack: "review_only",
	},
	travel_expense: {
		telegram: "actionable",
		teams: "unverified",
		discord: "unverified",
		slack: "unverified",
	},
};

export type PilotFindingCode =
	| "authority_not_canonical"
	| "authority_not_legacy"
	| "attention_open"
	| "combination_unverified"
	| "delivery_awaiting_repair"
	| "delivery_exhausted"
	| "delivery_failed"
	| "delivery_lease_expired"
	| "escalation_legacy_owner"
	| "escalation_owner_unrecognized"
	| "escalation_paused"
	| "escalation_policy_conflicts_unreviewed"
	| "escalation_policy_missing"
	| "evidence_capture_inactive"
	| "evidence_held"
	| "in_flight_before_activation"
	| "legacy_cards_historical_only"
	| "legacy_transfer_without_replacement"
	| "presentation_actionable_unverified"
	| "presentation_not_actionable"
	| "provider_not_configured";

export interface PilotFinding {
	code: PilotFindingCode;
	/** A blocker prevents activation; a hold needs an explicit operator decision. */
	severity: "blocker" | "hold";
	/** Number of affected lifecycles or rows, when the finding counts them. */
	count?: number;
}

export interface PilotCombinationReadiness {
	workflowType: PilotWorkflowType;
	provider: ApprovalDeliveryProvider;
	/** Whether the delivery owner already owns this combination's cards. */
	delivery: {
		active: boolean;
		activatedAt: string | null;
		/** Delivery work rows by status (only statuses that occur). */
		work: Partial<Record<ApprovalDeliveryStatus, number>>;
	};
	verdict: PilotVerdict;
	findings: PilotFinding[];
}

/** Pending lifecycles of a kind by the state of their submitted evidence. */
export interface PilotPendingEvidence {
	total: number;
	/** Evidenced and still matching: decidable from a bound card. */
	current: number;
	/** No submitted revision (e.g. submitted before capture); held while capture is on. */
	notCaptured: number;
	/** Live facts changed after submission; held until a supported resubmission. */
	materialChange: number;
	/** Evidence of another authority that the current one cannot bind to. */
	authorityChange: number;
}

export interface PilotKindReadiness {
	workflowType: PilotWorkflowType;
	/** The authority that decides this kind now. */
	authority: "canonical" | "legacy";
	/** Stored rollout mode; null when the organization has no rollout row. */
	lifecycleMode: string | null;
	evidenceMode: string;
	pending: PilotPendingEvidence;
}

/**
 * Organization-wide escalation state, separate from card readiness: who owns
 * scheduled transfers, the migrated policy, committed transfer history and
 * incidents that still need an administrator.
 */
export interface PilotEscalationReadiness {
	/** Stored owner; `legacy` also when no control row exists (additive default). */
	owner: string;
	automationPaused: boolean;
	ownedSince: string | null;
	policy: {
		enabled: boolean;
		responseWindowHours: number;
		revision: number;
		conflictReviewStatus: string;
	} | null;
	transfers: {
		canonical: number;
		legacy: number;
		/** Legacy transfer events without replacement delivery (#408). */
		pendingLegacyEvents: number;
	};
	/** Open administrative-attention incidents by reason. */
	openAttention: Record<string, number>;
	verdict: PilotVerdict;
	findings: PilotFinding[];
}

export interface ApprovalPilotReadiness {
	organizationId: string;
	kinds: PilotKindReadiness[];
	combinations: PilotCombinationReadiness[];
	escalation: PilotEscalationReadiness;
}

function rows(result: unknown): Array<Record<string, unknown>> {
	if (!result || typeof result !== "object" || !("rows" in result)) return [];
	return Array.isArray(result.rows) ? (result.rows as Array<Record<string, unknown>>) : [];
}

function verdictOf(findings: readonly PilotFinding[]): PilotVerdict {
	if (findings.some((finding) => finding.severity === "blocker")) return "blocked";
	return findings.length > 0 ? "hold" : "ready";
}

async function loadLifecycleMode(
	database: ApprovalDatabase,
	organizationId: string,
	workflowType: PilotWorkflowType,
): Promise<string | null> {
	const [row] = rows(
		await database.execute(sql`
			select lifecycle_mode from approval_workflow_rollout
			where organization_id = ${organizationId} and workflow_type = ${workflowType}
		`),
	);
	return typeof row?.lifecycle_mode === "string" ? row.lifecycle_mode : null;
}

/** Providers with an active integration that has approvals enabled. */
async function loadConfiguredProviders(
	database: ApprovalDatabase,
	organizationId: string,
): Promise<Set<ApprovalDeliveryProvider>> {
	const result = rows(
		await database.execute(sql`
			select 'telegram' as provider from telegram_bot_config
				where organization_id = ${organizationId} and setup_status = 'active' and enable_approvals
			union select 'teams' from teams_tenant_config
				where organization_id = ${organizationId} and setup_status = 'active' and enable_approvals
			union select 'slack' from slack_workspace_config
				where organization_id = ${organizationId} and setup_status = 'active' and enable_approvals
			union select 'discord' from discord_bot_config
				where organization_id = ${organizationId} and setup_status = 'active' and enable_approvals
		`),
	);
	return new Set(result.map((row) => row.provider as ApprovalDeliveryProvider));
}

async function loadDeliveryActivation(
	database: ApprovalDatabase,
	input: PilotScope,
): Promise<Date | null> {
	const [control] = await database
		.select({ activatedAt: approvalDeliveryControl.activatedAt })
		.from(approvalDeliveryControl)
		.where(
			and(
				eq(approvalDeliveryControl.organizationId, input.organizationId),
				eq(approvalDeliveryControl.workflowType, input.workflowType),
				eq(approvalDeliveryControl.provider, input.provider),
			),
		)
		.limit(1);
	return control?.activatedAt ?? null;
}

interface PilotScope {
	organizationId: string;
	workflowType: PilotWorkflowType;
	provider: ApprovalDeliveryProvider;
}

/**
 * Pending canonical workflows the delivery owner will never card: it plans only
 * from lifecycle intents created at or after the control's activation (the
 * same comparison as intent expansion, in SQL at full precision), so a
 * workflow without such an intent stays web-inbox-only (decision of
 * 2026-09-25: no backfill). Without a control, every pending workflow would
 * be in flight at activation.
 */
async function countCanonicalInFlight(
	database: ApprovalDatabase,
	input: PilotScope,
): Promise<number> {
	const [row] = rows(
		await database.execute(sql`
			select count(*)::int as count from approval_workflow w
			where w.organization_id = ${input.organizationId}
				and w.workflow_type = ${input.workflowType}
				and w.status = 'pending'
				and not exists (
					select 1 from approval_outbox o
					join approval_delivery_control c
						on c.organization_id = o.organization_id
						and c.workflow_type = w.workflow_type
						and c.provider = ${input.provider}
					where o.organization_id = w.organization_id
						and o.workflow_id = w.id
						and o.event_type <> 'workflow.legacy_observed'
						and c.activated_at <= o.created_at
				)
		`),
	);
	return Number(row?.count ?? 0);
}

/**
 * Legacy-authoritative counterpart (#296): submitted expense claims without a
 * lifecycle intent at or after activation. The owner plans a legacy lifecycle
 * only from such intents, so these claims stay web-inbox-only.
 */
async function countLegacyExpenseInFlight(
	database: ApprovalDatabase,
	input: PilotScope,
): Promise<number> {
	const [row] = rows(
		await database.execute(sql`
			select count(*)::int as count from travel_expense_claim claim
			where claim.organization_id = ${input.organizationId}
				and claim.status = 'submitted'
				and not exists (
					select 1 from approval_delivery_intent i
					join approval_delivery_control c
						on c.organization_id = i.organization_id
						and c.workflow_type = i.workflow_type
						and c.provider = ${input.provider}
					where i.organization_id = claim.organization_id
						and i.workflow_type = 'travel_expense'
						and i.source_type = 'travel_expense_claim'
						and i.source_id = claim.id
						and c.activated_at <= i.created_at
				)
		`),
	);
	return Number(row?.count ?? 0);
}

interface DeliveryWorkHealth {
	byStatus: Partial<Record<ApprovalDeliveryStatus, number>>;
	/** Claimed work whose lease ran out: its worker died or stalled mid-send. */
	leaseExpired: number;
}

/** The combination's delivery work, legacy rows by their own kind. */
async function loadDeliveryWorkHealth(
	database: ApprovalDatabase,
	input: PilotScope,
): Promise<DeliveryWorkHealth> {
	const byStatus: Partial<Record<ApprovalDeliveryStatus, number>> = {};
	let leaseExpired = 0;
	for (const row of rows(
		await database.execute(sql`
			select work.status, count(*)::int as count,
				count(*) filter (
					where work.status = 'processing' and work.lease_expires_at < now()
				)::int as lease_expired
			from approval_delivery_work work
			left join approval_workflow w
				on w.id = work.workflow_id and w.organization_id = work.organization_id
			where work.organization_id = ${input.organizationId}
				and work.provider = ${input.provider}
				and coalesce(w.workflow_type, work.workflow_type) = ${input.workflowType}
			group by work.status order by work.status
		`),
	)) {
		byStatus[row.status as ApprovalDeliveryStatus] = Number(row.count);
		leaseExpired += Number(row.lease_expired);
	}
	return { byStatus, leaseExpired };
}

/** Work that stays stuck until an operator or a repaired destination acts. */
function deliveryFindings(health: DeliveryWorkHealth): PilotFinding[] {
	const findings: PilotFinding[] = [];
	const stuck = [
		["awaiting_repair", "delivery_awaiting_repair"],
		["exhausted", "delivery_exhausted"],
		["failed", "delivery_failed"],
	] as const;
	for (const [status, code] of stuck) {
		const count = health.byStatus[status] ?? 0;
		if (count > 0) findings.push({ code, severity: "hold", count });
	}
	if (health.leaseExpired > 0) {
		findings.push({ code: "delivery_lease_expired", severity: "hold", count: health.leaseExpired });
	}
	return findings;
}

/** Tables of the pre-owner card paths, which the delivery owner never refreshes. */
const LEGACY_CARD_TABLES: Record<ApprovalDeliveryProvider, SQL> = {
	telegram: sql.raw("telegram_approval_message"),
	teams: sql.raw("teams_approval_card"),
	slack: sql.raw("slack_approval_message"),
	discord: sql.raw("discord_approval_message"),
};

const LEGACY_ENTITY_TYPES: Record<PilotWorkflowType, string> = {
	absence: "absence_entry",
	travel_expense: "travel_expense_claim",
};

/**
 * Unanswered old-path cards of still-pending approvals. They stay
 * historical-only: not refreshed by the owner, and a press revalidates at
 * commit instead of deciding from the card.
 */
async function countLegacyCards(database: ApprovalDatabase, input: PilotScope): Promise<number> {
	const [row] = rows(
		await database.execute(sql`
			select count(*)::int as count from ${LEGACY_CARD_TABLES[input.provider]} card
			join approval_request r
				on r.id = card.approval_request_id and r.organization_id = card.organization_id
			where card.organization_id = ${input.organizationId}
				and card.status = 'sent'
				and r.status = 'pending'
				and r.entity_type = ${LEGACY_ENTITY_TYPES[input.workflowType]}
		`),
	);
	return Number(row?.count ?? 0);
}

type EvidenceClass = Exclude<keyof PilotPendingEvidence, "total">;

function classifyAbsence(evidence: AbsenceReviewEvidence | null): EvidenceClass {
	// null: the entity could not be matched to its evidence, which the
	// decision owner cannot bind either.
	if (!evidence || evidence.status === "not_captured") return "notCaptured";
	if (evidence.authorityChange) return "authorityChange";
	return evidence.comparison.kind === "material_change" ? "materialChange" : "current";
}

function classifyTravelExpense(evidence: TravelExpenseReviewEvidence): EvidenceClass {
	if (evidence.status === "not_captured") return "notCaptured";
	return evidence.comparison.kind === "material_change" ? "materialChange" : "current";
}

/**
 * Submitted evidence of every pending lifecycle of the kind, through the same
 * review preparation that the inbox and the decision owner use, so a held
 * lifecycle here is exactly one that cannot be decided from a card.
 */
async function classifyPendingEvidence(
	database: ApprovalDatabase,
	organizationId: string,
	workflowType: PilotWorkflowType,
): Promise<PilotPendingEvidence> {
	const classes: EvidenceClass[] = [];
	if (workflowType === "absence") {
		const pending = await database.query.absenceEntry.findMany({
			where: and(
				eq(absenceEntry.organizationId, organizationId),
				eq(absenceEntry.status, "pending"),
			),
			with: { category: { columns: { name: true } } },
		});
		for (const entity of pending) {
			classes.push(
				classifyAbsence(await prepareAbsenceReviewEvidence({ organizationId, entity }, database)),
			);
		}
	} else {
		const pending = await database
			.select({ id: travelExpenseClaim.id })
			.from(travelExpenseClaim)
			.where(
				and(
					eq(travelExpenseClaim.organizationId, organizationId),
					eq(travelExpenseClaim.status, "submitted"),
				),
			);
		for (const claim of pending) {
			classes.push(
				classifyTravelExpense(
					await prepareTravelExpenseReviewEvidence({ organizationId, claimId: claim.id }, database),
				),
			);
		}
	}
	const count = (kind: EvidenceClass) => classes.filter((entry) => entry === kind).length;
	return {
		total: classes.length,
		current: count("current"),
		notCaptured: count("notCaptured"),
		materialChange: count("materialChange"),
		authorityChange: count("authorityChange"),
	};
}

async function assessEscalation(
	database: ApprovalDatabase,
	organizationId: string,
): Promise<PilotEscalationReadiness> {
	const [[control], [policy]] = await Promise.all([
		database
			.select()
			.from(approvalEscalationControl)
			.where(eq(approvalEscalationControl.organizationId, organizationId))
			.limit(1),
		database
			.select()
			.from(approvalEscalationPolicy)
			.where(eq(approvalEscalationPolicy.organizationId, organizationId))
			.limit(1),
	]);
	const [transfers] = rows(
		await database.execute(sql`
			select
				count(*) filter (where t.authority_mode = 'canonical')::int as canonical,
				count(*) filter (where t.authority_mode = 'legacy')::int as legacy,
				(select count(*)::int from approval_escalation_transfer_event e
					join approval_escalation_transfer lt
						on lt.id = e.transfer_id and lt.organization_id = e.organization_id
					where e.organization_id = ${organizationId}
						and e.expansion_status = 'pending'
						and lt.authority_mode = 'legacy') as pending_legacy_events
			from approval_escalation_transfer t
			where t.organization_id = ${organizationId}
		`),
	);
	const openAttention: Record<string, number> = {};
	for (const row of rows(
		await database.execute(sql`
			select reason, count(*)::int as count from approval_escalation_attention
			where organization_id = ${organizationId} and status = 'open'
			group by reason order by reason
		`),
	)) {
		openAttention[String(row.reason)] = Number(row.count);
	}

	const owner = control?.owner ?? "legacy";
	const automationPaused = control?.automationPaused ?? false;
	const pendingLegacyEvents = Number(transfers?.pending_legacy_events ?? 0);
	const findings: PilotFinding[] = [];
	if (owner === "legacy") {
		// Legacy jobs keep running (or are paused) until the exclusive switch.
		findings.push({ code: "escalation_legacy_owner", severity: "hold" });
	} else if (owner !== "escalation") {
		findings.push({ code: "escalation_owner_unrecognized", severity: "blocker" });
	}
	if (automationPaused) findings.push({ code: "escalation_paused", severity: "hold" });
	if (!policy) {
		findings.push({ code: "escalation_policy_missing", severity: "blocker" });
	} else if (policy.conflictReviewStatus === "pending") {
		findings.push({ code: "escalation_policy_conflicts_unreviewed", severity: "blocker" });
	}
	if (pendingLegacyEvents > 0) {
		findings.push({
			code: "legacy_transfer_without_replacement",
			severity: "hold",
			count: pendingLegacyEvents,
		});
	}
	const attention = Object.values(openAttention).reduce((sum, count) => sum + count, 0);
	if (attention > 0) findings.push({ code: "attention_open", severity: "hold", count: attention });

	return {
		owner,
		automationPaused,
		ownedSince: control?.escalationOwnedSince?.toISOString() ?? null,
		policy: policy
			? {
					enabled: policy.enabled,
					responseWindowHours: policy.responseWindowHours,
					revision: policy.revision,
					conflictReviewStatus: policy.conflictReviewStatus,
				}
			: null,
		transfers: {
			canonical: Number(transfers?.canonical ?? 0),
			legacy: Number(transfers?.legacy ?? 0),
			pendingLegacyEvents,
		},
		openAttention,
		verdict: verdictOf(findings),
		findings,
	};
}

async function assess(
	database: ApprovalDatabase,
	organizationId: string,
): Promise<ApprovalPilotReadiness> {
	const [known] = rows(
		await database.execute(sql`select 1 from organization where id = ${organizationId}`),
	);
	// An unknown ID would otherwise read as an organization with nothing pending.
	if (!known) throw new Error(`Unknown organization ${organizationId}`);
	const configured = await loadConfiguredProviders(database, organizationId);
	const kinds: PilotKindReadiness[] = [];
	const combinations: PilotCombinationReadiness[] = [];
	for (const workflowType of PILOT_WORKFLOW_TYPES) {
		const lifecycleMode = await loadLifecycleMode(database, organizationId, workflowType);
		const canonical = lifecycleMode === "canonical" || lifecycleMode === "complete";
		const evidenceMode = await readApprovalEvidenceMode(database, {
			organizationId,
			workflowType,
		});
		const pending = await classifyPendingEvidence(database, organizationId, workflowType);
		kinds.push({
			workflowType,
			authority: canonical ? "canonical" : "legacy",
			lifecycleMode,
			evidenceMode,
			pending,
		});
		// Findings every provider of the kind shares.
		const kindFindings: PilotFinding[] = [];
		// Absence cards need canonical authority (legacy absences are #384);
		// expense cards exist only under legacy authority (#296).
		const authorityAdmitted = workflowType === "absence" ? canonical : !canonical;
		if (!authorityAdmitted) {
			kindFindings.push({
				code: workflowType === "absence" ? "authority_not_canonical" : "authority_not_legacy",
				severity: "blocker",
			});
		}
		if (evidenceMode !== "capture") {
			kindFindings.push({ code: "evidence_capture_inactive", severity: "blocker" });
		}
		const held = pending.notCaptured + pending.materialChange + pending.authorityChange;
		if (held > 0) kindFindings.push({ code: "evidence_held", severity: "hold", count: held });
		for (const provider of APPROVAL_DELIVERY_PROVIDERS) {
			const findings: PilotFinding[] = [...kindFindings];
			const admission = PILOT_ADMISSION[workflowType][provider];
			const presentation = await readApprovalPresentationMode(database, {
				organizationId,
				workflowType,
				provider,
			});
			if (admission === "unverified") {
				findings.push({ code: "combination_unverified", severity: "blocker" });
				if (presentation === "actionable") {
					findings.push({ code: "presentation_actionable_unverified", severity: "blocker" });
				}
			} else if (admission === "actionable" && presentation !== "actionable") {
				findings.push({ code: "presentation_not_actionable", severity: "blocker" });
			}
			if (!configured.has(provider)) {
				findings.push({ code: "provider_not_configured", severity: "blocker" });
			}
			const scope = { organizationId, workflowType, provider };
			const activatedAt = await loadDeliveryActivation(database, scope);
			const inFlight =
				!authorityAdmitted || admission === "unverified"
					? 0
					: canonical
						? await countCanonicalInFlight(database, scope)
						: await countLegacyExpenseInFlight(database, scope);
			if (inFlight > 0) {
				findings.push({ code: "in_flight_before_activation", severity: "hold", count: inFlight });
			}
			const legacyCards = await countLegacyCards(database, scope);
			if (legacyCards > 0) {
				findings.push({
					code: "legacy_cards_historical_only",
					severity: "hold",
					count: legacyCards,
				});
			}
			const health = await loadDeliveryWorkHealth(database, scope);
			findings.push(...deliveryFindings(health));
			combinations.push({
				workflowType,
				provider,
				delivery: {
					active: activatedAt !== null,
					activatedAt: activatedAt?.toISOString() ?? null,
					work: health.byStatus,
				},
				verdict: verdictOf(findings),
				findings,
			});
		}
	}
	return {
		organizationId,
		kinds,
		combinations,
		escalation: await assessEscalation(database, organizationId),
	};
}

export async function assessApprovalPilotReadiness(input: {
	organizationId: string;
}): Promise<ApprovalPilotReadiness> {
	if (!input.organizationId) throw new Error("Pilot readiness requires organization scope");
	return db.transaction((transaction) => assess(transaction, input.organizationId), {
		isolationLevel: "repeatable read",
		accessMode: "read only",
	});
}
