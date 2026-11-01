import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import {
	approvalRequest,
	approvalWorkflow,
	employee,
	payrollExportJob,
	timeRecord,
	workPeriod,
} from "@/db/schema";
import {
	compareInstants,
	type Instant,
	instantFromDate,
	instantToCanonicalString,
} from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { isFormerEmployee } from "@/lib/employee-lifecycle/current-roster";
import { createLogger } from "@/lib/logger";
import type { FirstWorkflowEvidence, FirstWorkflowEvidenceLine } from "./first-workflows";
import type { GoLiveAsOf, GoLiveGroup } from "./types";

const logger = createLogger("FirstWorkflowEvidence");

type Candidate = { employeeId: string; at: Date } | undefined;

/**
 * First-workflow evidence for the organization, read live from real records.
 * Clock-ins and decided requests count only for go-live group members; the
 * payroll export is organization-wide. Read-only, a bounded number of queries,
 * and a failed lookup makes only its own line unavailable.
 */
export async function loadFirstWorkflowEvidence(input: {
	db: DatabaseClient;
	organizationId: string;
	group: GoLiveGroup;
	asOf: GoLiveAsOf;
}): Promise<FirstWorkflowEvidence> {
	const members = new Map<string, string>();
	for (const member of input.group.members) {
		// Invitees have no activity yet.
		if (member.kind === "employee") members.set(member.employeeId, member.displayName);
	}

	const [clockIn, decidedApproval, payrollExport] = await Promise.all([
		line(input.organizationId, "clock-in", async () =>
			memberLine(members, await firstClockIn(input.db, input.organizationId, [...members.keys()])),
		),
		line(input.organizationId, "decided-approval", async () =>
			memberLine(
				members,
				await firstDecidedApproval(input.db, input.organizationId, [...members.keys()]),
			),
		),
		line(input.organizationId, "payroll-export", () =>
			firstPayrollExport(input.db, input.organizationId, input.asOf.instant),
		),
	]);
	return { clockIn, decidedApproval, payrollExport };
}

async function line(
	organizationId: string,
	evidence: string,
	load: () => Promise<FirstWorkflowEvidenceLine>,
): Promise<FirstWorkflowEvidenceLine> {
	try {
		return await load();
	} catch (error) {
		logger.error({ organizationId, evidence, error }, "First-workflow evidence lookup failed");
		return { state: "unavailable" };
	}
}

function memberLine(members: ReadonlyMap<string, string>, first: Candidate) {
	if (!first) return { state: "not-yet" } as const;
	return {
		state: "seen",
		at: instantToCanonicalString(instantFromDate(first.at)),
		actor: {
			employeeId: first.employeeId,
			displayName: members.get(first.employeeId) ?? "",
			former: false,
		},
	} as const;
}

/**
 * Live clocking only: completed clocked work (`origin = 'clock'`), and work
 * still running, which has no canonical record until clock-out. Manual work,
 * imports and corrections are not clock-ins.
 */
async function firstClockIn(
	db: DatabaseClient,
	organizationId: string,
	employeeIds: string[],
): Promise<Candidate> {
	if (!employeeIds.length) return undefined;
	const [[completed], [running]] = await Promise.all([
		db
			.select({ employeeId: timeRecord.employeeId, at: timeRecord.startAt })
			.from(timeRecord)
			.where(
				and(
					eq(timeRecord.organizationId, organizationId),
					eq(timeRecord.recordKind, "work"),
					eq(timeRecord.origin, "clock"),
					inArray(timeRecord.employeeId, employeeIds),
				),
			)
			.orderBy(asc(timeRecord.startAt), asc(timeRecord.id))
			.limit(1),
		db
			.select({ employeeId: workPeriod.employeeId, at: workPeriod.startTime })
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.organizationId, organizationId),
					eq(workPeriod.isActive, true),
					isNull(workPeriod.endTime),
					isNull(workPeriod.deletedAt),
					inArray(workPeriod.employeeId, employeeIds),
				),
			)
			.orderBy(asc(workPeriod.startTime), asc(workPeriod.id))
			.limit(1),
	]);
	return earliest(completed, running);
}

/**
 * Approved or rejected, never pending or withdrawn, on either approval path. A
 * legacy request's decision time is `approved_at`, which rejections don't
 * always set, so it falls back to when the request was last updated.
 */
async function firstDecidedApproval(
	db: DatabaseClient,
	organizationId: string,
	employeeIds: string[],
): Promise<Candidate> {
	if (!employeeIds.length) return undefined;
	const legacyDecidedAt = sql`coalesce(${approvalRequest.approvedAt}, ${approvalRequest.updatedAt})`;
	const [[canonical], [legacy]] = await Promise.all([
		db
			.select({
				employeeId: approvalWorkflow.requesterEmployeeId,
				at: approvalWorkflow.completedAt,
			})
			.from(approvalWorkflow)
			.where(
				and(
					eq(approvalWorkflow.organizationId, organizationId),
					inArray(approvalWorkflow.status, ["approved", "rejected"]),
					isNotNull(approvalWorkflow.completedAt),
					inArray(approvalWorkflow.requesterEmployeeId, employeeIds),
				),
			)
			.orderBy(asc(approvalWorkflow.completedAt), asc(approvalWorkflow.id))
			.limit(1),
		db
			.select({
				employeeId: approvalRequest.requestedBy,
				approvedAt: approvalRequest.approvedAt,
				updatedAt: approvalRequest.updatedAt,
			})
			.from(approvalRequest)
			.where(
				and(
					eq(approvalRequest.organizationId, organizationId),
					inArray(approvalRequest.status, ["approved", "rejected"]),
					inArray(approvalRequest.requestedBy, employeeIds),
				),
			)
			.orderBy(asc(legacyDecidedAt), asc(approvalRequest.id))
			.limit(1),
	]);
	return earliest(
		canonical?.employeeId && canonical.at
			? { employeeId: canonical.employeeId, at: canonical.at }
			: undefined,
		legacy
			? { employeeId: legacy.employeeId, at: legacy.approvedAt ?? legacy.updatedAt }
			: undefined,
	);
}

/**
 * The organization's first completed export; failed and unfinished jobs don't
 * count. Whoever ran it is shown even after they left, marked as former.
 */
async function firstPayrollExport(
	db: DatabaseClient,
	organizationId: string,
	now: Instant,
): Promise<FirstWorkflowEvidenceLine> {
	const [first] = await db
		.select({
			employeeId: payrollExportJob.requestedById,
			at: payrollExportJob.completedAt,
			name: user.name,
			email: user.email,
			former: isFormerEmployee(employee, now),
		})
		.from(payrollExportJob)
		.innerJoin(
			employee,
			and(
				eq(employee.id, payrollExportJob.requestedById),
				eq(employee.organizationId, organizationId),
			),
		)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				eq(payrollExportJob.organizationId, organizationId),
				eq(payrollExportJob.status, "completed"),
				isNotNull(payrollExportJob.completedAt),
			),
		)
		.orderBy(asc(payrollExportJob.completedAt), asc(payrollExportJob.id))
		.limit(1);
	if (!first?.at) return { state: "not-yet" };
	return {
		state: "seen",
		at: instantToCanonicalString(instantFromDate(first.at)),
		actor: {
			employeeId: first.employeeId,
			displayName: first.name || first.email,
			former: Boolean(first.former),
		},
	};
}

function earliest(left: Candidate, right: Candidate): Candidate {
	if (!left || !right) return left ?? right;
	return compareInstants(instantFromDate(right.at), instantFromDate(left.at)) < 0 ? right : left;
}
