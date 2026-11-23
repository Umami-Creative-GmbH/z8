import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { organization, user } from "@/db/auth-schema";
import { employee, project, projectTask, timeEntry, workPeriod } from "@/db/schema";
import { employeeContractorProfile } from "@/db/schema/contractor-profile";
import {
	loadContractorEngagements,
	priceContractorDays,
} from "@/lib/contractor-compensation/pricing-loader";
import type { Instant, PlainDate } from "@/lib/datetime/temporal-core";
import type { Transaction } from "@/lib/time-tracking/work-transaction/ranks";
import {
	buildContractorStatement,
	type ContractorStatement,
	type StatementWorkDetails,
} from "./statement";

/**
 * Loads a Contractor Time & Fee Statement (#2000): one person's External
 * Contractor work on the local days of a period, priced by the #1998 engine
 * (`priceContractorDays`), with the project and task of each work period and
 * the contracting details. Read-only and organization-scoped; who may read
 * whose statement is the caller's decision (`actions.ts`).
 *
 * Only contractor engagements count: work as an employee (before or after a
 * conversion) is left out by the engine. Completed work is included whether
 * or not a change to it awaits approval; such lines are marked.
 */

type Reader = Pick<Transaction, "select">;

export type ContractorStatementRefusal = "employee_not_found" | "not_contractor" | "invalid_period";

export type ContractorStatementResult =
	| { ok: true; statement: ContractorStatement }
	| { ok: false; reason: ContractorStatementRefusal };

/** A statement spans at most a year (inclusive days), like a yearly reconciliation. */
export const MAX_STATEMENT_DAYS = 366;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The period's first and last day, or null when it is not a valid range. */
export function parseStatementPeriod(
	fromDay: string,
	toDay: string,
): { fromDay: PlainDate; toDay: PlainDate } | null {
	if (!ISO_DAY.test(fromDay) || !ISO_DAY.test(toDay)) return null;
	try {
		const from = Temporal.PlainDate.from(fromDay, { overflow: "reject" });
		const to = Temporal.PlainDate.from(toDay, { overflow: "reject" });
		if (Temporal.PlainDate.compare(from, to) > 0) return null;
		if (from.until(to, { largestUnit: "days" }).days + 1 > MAX_STATEMENT_DAYS) return null;
		return { fromDay: from, toDay: to };
	} catch {
		return null;
	}
}

export async function loadContractorStatement(
	reader: Reader,
	organizationId: string,
	input: { employeeId: string; fromDay: string; toDay: string; generatedAt: Instant },
): Promise<ContractorStatementResult> {
	const period = parseStatementPeriod(input.fromDay, input.toDay);
	if (!period) return { ok: false, reason: "invalid_period" };

	const [person] = await reader
		.select({
			id: employee.id,
			employeeNumber: employee.employeeNumber,
			userName: user.name,
			organizationName: organization.name,
		})
		.from(employee)
		.innerJoin(organization, eq(organization.id, employee.organizationId))
		.leftJoin(user, eq(user.id, employee.userId))
		.where(and(eq(employee.id, input.employeeId), eq(employee.organizationId, organizationId)));
	if (!person) return { ok: false, reason: "employee_not_found" };

	const range = { employeeIds: [person.id], ...period };
	const engagements = await loadContractorEngagements(reader, organizationId, range);
	if (engagements.length === 0) return { ok: false, reason: "not_contractor" };

	// One query at a time: the reader may be a transaction's single connection.
	const pricing = await priceContractorDays(reader, organizationId, range);
	const [profile] = await reader
		.select({
			companyName: employeeContractorProfile.companyName,
			vatId: employeeContractorProfile.vatId,
			referenceCode: employeeContractorProfile.referenceCode,
		})
		.from(employeeContractorProfile)
		.where(
			and(
				eq(employeeContractorProfile.organizationId, organizationId),
				eq(employeeContractorProfile.employeeId, person.id),
			),
		);

	const workIds = [
		...new Set(pricing.days.flatMap((day) => day.shares.map((share) => share.workId))),
	];
	const work = await loadWorkDetails(reader, organizationId, workIds);

	return {
		ok: true,
		statement: buildContractorStatement({
			organizationName: person.organizationName,
			contractor: {
				id: person.id,
				// The user's name is the canonical display name (derived-user-name.ts).
				name: person.userName?.trim() || person.employeeNumber || person.id,
				employeeNumber: person.employeeNumber,
				companyName: profile?.companyName ?? null,
				vatId: profile?.vatId ?? null,
				referenceCode: profile?.referenceCode ?? null,
			},
			period,
			generatedAt: input.generatedAt,
			pricing,
			work,
		}),
	};
}

async function loadWorkDetails(
	reader: Reader,
	organizationId: string,
	workIds: readonly string[],
): Promise<Map<string, StatementWorkDetails>> {
	if (workIds.length === 0) return new Map();
	const rows = await reader
		.select({
			id: workPeriod.id,
			projectName: project.name,
			taskName: projectTask.name,
			approvalStatus: workPeriod.approvalStatus,
			startOffsetMinutes: timeEntry.utcOffsetMinutes,
		})
		.from(workPeriod)
		.innerJoin(
			timeEntry,
			and(
				eq(timeEntry.id, workPeriod.clockInId),
				eq(timeEntry.organizationId, workPeriod.organizationId),
			),
		)
		.leftJoin(
			project,
			and(eq(project.id, workPeriod.projectId), eq(project.organizationId, organizationId)),
		)
		.leftJoin(
			projectTask,
			and(eq(projectTask.id, workPeriod.taskId), eq(projectTask.organizationId, organizationId)),
		)
		.where(
			and(eq(workPeriod.organizationId, organizationId), inArray(workPeriod.id, [...workIds])),
		);
	return new Map(
		rows.map((row) => [
			row.id,
			{
				projectName: row.projectName,
				taskName: row.taskName,
				awaitingApproval: row.approvalStatus === "pending",
				startOffsetMinutes: row.startOffsetMinutes,
			},
		]),
	);
}
