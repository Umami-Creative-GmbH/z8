import { and, eq, inArray, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import { approvalWorkflowRollout } from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-schema";
import {
	approvalWriteGateGuard,
	Rank,
	recordGuard,
} from "@/lib/time-tracking/work-transaction/ranks";
import type { ApprovalDatabase } from "../server/types";
import type { ApprovalDbService, ApprovalWorkflowType, ApprovalWriteGate } from "../workflow/ports";
import {
	type ApprovalAuthority,
	type ApprovalAuthorityResolution,
	type ApprovalWriteGateResult,
	approvalWriteGateResult,
	initialApprovalLifecycleMode,
	initialApprovalSideEffectMode,
	LIFECYCLE_MODE_UNAVAILABLE,
	lifecycleModesWithAuthority,
	parseGatedApprovalLifecycleMode,
	resolveApprovalKindAuthority,
} from "./resolution";

export interface ApprovalAuthorityScope {
	organizationId: string;
	workflowType: ApprovalWorkflowType;
}

/**
 * The advisory-lock scope of one kind's rollout in one organization. Writers
 * hold it shared; a cutover transition holds it exclusively.
 */
export function approvalRolloutLockScope(
	organizationId: string,
	workflowType: ApprovalWorkflowType,
): string {
	return approvalWriteGateGuard(organizationId, workflowType).key;
}

/**
 * The shared rollout lock, held by every writer of the kind until commit. It is
 * the approval write gate guard (rank 2); a work transaction records it first.
 */
export async function acquireApprovalWriteLock(
	dbService: ApprovalDbService,
	input: ApprovalAuthorityScope,
): Promise<void> {
	const scope = approvalRolloutLockScope(input.organizationId, input.workflowType);
	recordGuard(dbService.db, Rank.approvalWriteGate, scope, "shared");
	await dbService.db.execute(
		sql`select pg_advisory_xact_lock_shared(hashtextextended(${scope}, 0))`,
	);
}

async function readGatedLifecycleMode(dbService: ApprovalDbService, input: ApprovalAuthorityScope) {
	const result = await dbService.db.execute(sql`
		select lifecycle_mode
		from approval_workflow_rollout
		where organization_id = ${input.organizationId}
			and workflow_type = ${input.workflowType}
	`);
	if (!result || typeof result !== "object" || !("rows" in result)) {
		throw new Error(LIFECYCLE_MODE_UNAVAILABLE);
	}
	const rows = result.rows;
	const row = Array.isArray(rows) ? rows[0] : null;
	if (!row || typeof row !== "object" || !("lifecycle_mode" in row)) {
		throw new Error(LIFECYCLE_MODE_UNAVAILABLE);
	}
	// The row was just ensured, so null is as impossible as an unknown mode.
	if (row.lifecycle_mode === null) {
		throw new Error(LIFECYCLE_MODE_UNAVAILABLE);
	}
	return parseGatedApprovalLifecycleMode(input.workflowType, row.lifecycle_mode);
}

/**
 * The gated read: takes the shared rollout lock, inserts the kind's initial
 * row (`legacy`, or `complete` for a canonical-only kind) when none exists and
 * reads the kind's authority. Only this read may back a decision or a write;
 * the lock holds the answer until the transaction ends.
 */
export async function acquireApprovalWriteGate(
	dbService: ApprovalDbService,
	input: ApprovalAuthorityScope,
): Promise<ApprovalWriteGateResult> {
	await acquireApprovalWriteLock(dbService, input);
	await dbService.db.execute(sql`
		insert into approval_workflow_rollout (
			organization_id,
			workflow_type,
			lifecycle_mode,
			side_effect_mode,
			updated_at
		)
		values (
			${input.organizationId},
			${input.workflowType},
			${initialApprovalLifecycleMode(input.workflowType)},
			${initialApprovalSideEffectMode(input.workflowType)},
			${currentTimestamp()}
		)
		on conflict (organization_id, workflow_type) do nothing
	`);
	return approvalWriteGateResult(await readGatedLifecycleMode(dbService, input));
}

export function createApprovalWriteGate(dbService: ApprovalDbService): ApprovalWriteGate {
	return {
		acquire: (input) => acquireApprovalWriteGate(dbService, input),
	};
}

/**
 * The snapshot read: no lock, no write, and no row is the kind's initial mode
 * (`legacy`, or `complete` for a canonical-only kind). Advisory only,
 * for presentation, reports, planners, self-service and escalation context;
 * it can never back a decision or a write.
 */
export async function readApprovalAuthoritySnapshot(
	database: ApprovalDatabase,
	input: ApprovalAuthorityScope,
): Promise<ApprovalAuthorityResolution> {
	const [row] = await database
		.select({ mode: approvalWorkflowRollout.lifecycleMode })
		.from(approvalWorkflowRollout)
		.where(
			and(
				eq(approvalWorkflowRollout.organizationId, input.organizationId),
				eq(approvalWorkflowRollout.workflowType, input.workflowType),
			),
		)
		.limit(1);
	return resolveApprovalKindAuthority(input.workflowType, row?.mode);
}

/** Snapshot reads of several kinds of one organization in one query. */
export async function readApprovalAuthoritySnapshots<T extends ApprovalWorkflowType>(
	database: ApprovalDatabase,
	organizationId: string,
	workflowTypes: readonly T[],
): Promise<Map<T, ApprovalAuthorityResolution>> {
	const rows =
		workflowTypes.length === 0
			? []
			: await database
					.select({
						workflowType: approvalWorkflowRollout.workflowType,
						mode: approvalWorkflowRollout.lifecycleMode,
					})
					.from(approvalWorkflowRollout)
					.where(
						and(
							eq(approvalWorkflowRollout.organizationId, organizationId),
							inArray(approvalWorkflowRollout.workflowType, [...workflowTypes]),
						),
					);
	const modes = new Map<ApprovalWorkflowType, (typeof rows)[number]["mode"]>(
		rows.map((row) => [row.workflowType, row.mode]),
	);
	return new Map(
		workflowTypes.map((workflowType) => [
			workflowType,
			resolveApprovalKindAuthority(workflowType, modes.get(workflowType)),
		]),
	);
}

function modeList(authority: ApprovalAuthority): SQL {
	return sql.raw(
		lifecycleModesWithAuthority(authority)
			.map((mode) => `'${mode}'`)
			.join(", "),
	);
}

/**
 * A SQL condition that a rollout's lifecycle mode (a column or expression,
 * null when the organization has no row) has the given approval authority.
 * Derived from the same table as `resolveApprovalAuthority`; no row is legacy.
 * Both conditions are true or false, never null, so they can also be negated.
 * No row is legacy even for a canonical-only kind: callers left-join rollouts
 * only to find legacy requests and intents, which such a kind never has, and a
 * canonical workflow exists only after the write gate created its row.
 */
export function approvalAuthoritySql(lifecycleMode: SQLWrapper, authority: ApprovalAuthority): SQL {
	return authority === "canonical"
		? sql`(${lifecycleMode} is not null and ${lifecycleMode} in (${modeList("canonical")}))`
		: sql`(${lifecycleMode} is null or ${lifecycleMode} in (${modeList("legacy")}))`;
}
