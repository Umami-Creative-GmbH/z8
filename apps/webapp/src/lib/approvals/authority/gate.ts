import { and, eq, inArray, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import { approvalWorkflowRollout } from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-schema";
import type { ApprovalDatabase } from "../server/types";
import type { ApprovalDbService, ApprovalWorkflowType, ApprovalWriteGate } from "../workflow/ports";
import {
	type ApprovalAuthority,
	type ApprovalAuthorityResolution,
	type ApprovalWriteGateResult,
	approvalWriteGateResult,
	lifecycleModesWithAuthority,
	parseApprovalLifecycleMode,
	resolveApprovalAuthority,
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
	return `approval-rollout:${organizationId.length}:${organizationId}:${workflowType.length}:${workflowType}`;
}

/** The shared rollout lock, held by every writer of the kind until commit. */
export async function acquireApprovalWriteLock(
	dbService: ApprovalDbService,
	input: ApprovalAuthorityScope,
): Promise<void> {
	const scope = approvalRolloutLockScope(input.organizationId, input.workflowType);
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
		throw new Error("Approval workflow rollout mode is unavailable");
	}
	const rows = result.rows;
	const row = Array.isArray(rows) ? rows[0] : null;
	if (!row || typeof row !== "object" || !("lifecycle_mode" in row)) {
		throw new Error("Approval workflow rollout mode is unavailable");
	}
	// The row was just ensured, so null is as impossible as an unknown mode.
	if (row.lifecycle_mode === null) {
		throw new Error("Approval workflow rollout mode is unavailable");
	}
	return parseApprovalLifecycleMode(row.lifecycle_mode);
}

/**
 * The gated read: takes the shared rollout lock, inserts the `legacy` row
 * when none exists and reads the kind's authority. Only this read may back a
 * decision or a write; the lock holds the answer until the transaction ends.
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
			${"legacy"},
			${"legacy"},
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

/** Refused when a pinned gate is asked for another organization or kind. */
export class ApprovalWriteGateScopeError extends Error {
	constructor() {
		super("Approval write gate scope mismatch");
		this.name = "ApprovalWriteGateScopeError";
	}
}

/**
 * Pins a gate result this transaction already acquired: later acquisitions of
 * the same organization and kind return it without another read, and any
 * other organization or kind is refused.
 */
export function fixedApprovalWriteGate(
	scope: ApprovalAuthorityScope,
	gate: ApprovalWriteGateResult,
): ApprovalWriteGate {
	return {
		acquire: async (requested) => {
			if (
				requested.organizationId !== scope.organizationId ||
				requested.workflowType !== scope.workflowType
			) {
				throw new ApprovalWriteGateScopeError();
			}
			return gate;
		},
	};
}

/**
 * The snapshot read: no lock, no write, and no row is `legacy`. Advisory only,
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
	return resolveApprovalAuthority(row?.mode ?? null);
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
			resolveApprovalAuthority(modes.get(workflowType) ?? null),
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
 */
export function approvalAuthoritySql(lifecycleMode: SQLWrapper, authority: ApprovalAuthority): SQL {
	return authority === "canonical"
		? sql`(${lifecycleMode} is not null and ${lifecycleMode} in (${modeList("canonical")}))`
		: sql`(${lifecycleMode} is null or ${lifecycleMode} in (${modeList("legacy")}))`;
}
