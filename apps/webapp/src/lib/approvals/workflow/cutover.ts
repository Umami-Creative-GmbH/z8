import { sql } from "drizzle-orm";
import type { Instant } from "@/lib/datetime/temporal-core";
import type {
	ApprovalCutoverBehavior,
	ApprovalDbService,
	ApprovalEventActorIdentity,
	ApprovalWorkflowLifecycleMode,
	ApprovalWorkflowType,
	ApprovalWriteGate,
	ApprovalWriteGateResult,
} from "./ports";
import { APPROVAL_WORKFLOW_LIFECYCLE_MODES } from "./ports";

const BEHAVIORS: Record<
	ApprovalWorkflowLifecycleMode,
	ApprovalCutoverBehavior
> = {
	legacy: {
		serveFrom: "legacy",
		writeLegacy: true,
		writeCanonical: false,
		decideCanonical: false,
		mirror: "none",
	},
	shadow: {
		serveFrom: "legacy",
		writeLegacy: true,
		writeCanonical: true,
		decideCanonical: false,
		mirror: "legacy_to_canonical",
	},
	ready: {
		serveFrom: "legacy",
		writeLegacy: true,
		writeCanonical: true,
		decideCanonical: false,
		mirror: "legacy_to_canonical",
	},
	canonical: {
		serveFrom: "canonical",
		writeLegacy: true,
		writeCanonical: true,
		decideCanonical: true,
		mirror: "canonical_to_legacy",
	},
	complete: {
		serveFrom: "canonical",
		writeLegacy: false,
		writeCanonical: true,
		decideCanonical: true,
		mirror: "none",
	},
};

export interface ApprovalCutoverTransitionInput {
	organizationId: string;
	workflowType: ApprovalWorkflowType;
	from: ApprovalWorkflowLifecycleMode;
	to: ApprovalWorkflowLifecycleMode;
	actor: ApprovalEventActorIdentity;
	evidence: {
		reason: string;
		recordedAt: Instant;
		reconciliation?: {
			passed: true;
			mismatchCount: 0;
			backfilledThrough: Instant;
			reconciledAt: Instant;
		};
	};
}

const NEXT_MODE: Partial<
	Record<ApprovalWorkflowLifecycleMode, ApprovalWorkflowLifecycleMode>
> = {
	legacy: "shadow",
	shadow: "ready",
	ready: "canonical",
	canonical: "complete",
};

export function getCutoverBehavior(
	mode: ApprovalWorkflowLifecycleMode,
): ApprovalCutoverBehavior {
	return BEHAVIORS[mode];
}

export function validateCutoverTransition(
	input: ApprovalCutoverTransitionInput,
): ApprovalCutoverTransitionInput {
	if (!input.organizationId || !input.actor.kind || !input.evidence.reason) {
		throw new Error(
			"Cutover transition requires organization, actor, and evidence",
		);
	}
	if (NEXT_MODE[input.from] !== input.to) {
		throw new Error(
			`Invalid approval cutover transition ${input.from} -> ${input.to}`,
		);
	}
	if (
		input.to === "canonical" &&
		(!input.evidence.reconciliation?.passed ||
			input.evidence.reconciliation.mismatchCount !== 0)
	) {
		throw new Error(
			"Canonical cutover requires passing reconciliation evidence",
		);
	}
	return input;
}

export function approvalRolloutLockScope(
	organizationId: string,
	workflowType: ApprovalWorkflowType,
): string {
	return `approval-rollout:${organizationId.length}:${organizationId}:${workflowType.length}:${workflowType}`;
}

interface ApprovalRolloutLockInput {
	organizationId: string;
	workflowType: ApprovalWorkflowType;
}

export async function acquireApprovalWriteLock(
	dbService: ApprovalDbService,
	input: ApprovalRolloutLockInput,
): Promise<void> {
	const scope = approvalRolloutLockScope(
		input.organizationId,
		input.workflowType,
	);
	await dbService.db.execute(
		sql`select pg_advisory_xact_lock_shared(hashtextextended(${scope}, 0))`,
	);
}

export async function acquireApprovalCutoverLock(
	dbService: ApprovalDbService,
	input: ApprovalRolloutLockInput,
): Promise<void> {
	const scope = approvalRolloutLockScope(
		input.organizationId,
		input.workflowType,
	);
	await dbService.db.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${scope}, 0))`,
	);
}

async function readApprovalRolloutMode(
	dbService: ApprovalDbService,
	input: ApprovalRolloutLockInput,
): Promise<ApprovalWorkflowLifecycleMode> {
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
	if (
		!row ||
		typeof row !== "object" ||
		!("lifecycle_mode" in row) ||
		typeof row.lifecycle_mode !== "string" ||
		!APPROVAL_WORKFLOW_LIFECYCLE_MODES.includes(
			row.lifecycle_mode as ApprovalWorkflowLifecycleMode,
		)
	) {
		throw new Error("Approval workflow rollout mode is unavailable");
	}
	return row.lifecycle_mode as ApprovalWorkflowLifecycleMode;
}

export async function acquireApprovalWriteGate(
	dbService: ApprovalDbService,
	input: ApprovalRolloutLockInput,
): Promise<ApprovalWriteGateResult> {
	await acquireApprovalWriteLock(dbService, input);
	const mode = await readApprovalRolloutMode(dbService, input);
	return { mode, behavior: getCutoverBehavior(mode) };
}

export function createApprovalWriteGate(
	dbService: ApprovalDbService,
): ApprovalWriteGate {
	return {
		acquire: (input) => acquireApprovalWriteGate(dbService, input),
	};
}
