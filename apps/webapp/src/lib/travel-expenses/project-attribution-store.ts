import { and, eq, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { project, travelExpenseReport, travelExpenseReportItem } from "@/db/schema";
import type { TravelExpenseReportProjectAttribution } from "@/lib/approvals/evidence/travel-expense-report-facts";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	instantToCanonicalString,
	systemClock,
} from "@/lib/datetime/temporal-core";
import {
	effectiveItemProject,
	type ItemProjectChoice,
	itemProjectChoice,
	itemProjectColumns,
} from "./project-attribution";
import type { EligibilityWindow } from "./project-eligibility";
import {
	type EligibilityTarget,
	type ExpenseEligibleProject,
	expenseDateZone,
	isProjectEligibleOn,
	listExpenseEligibleProjects,
} from "./project-eligibility-store";
import { lockOwnDraftReport, type ReportOwner, touchReport } from "./report-store";

/**
 * Project attribution of draft report expenses (#605). Choosing a project is
 * validated with the same expense-date eligibility rule the picker offers,
 * under the report row lock, and advances the item's (or trip details')
 * version like any other edit, so the submission review notices it. A later
 * change of the expense date keeps the choice; submission re-checks it.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Pick<Database, "select">;

export type ProjectChoiceRefusal =
	/** The project does not exist in the employee's organization. */
	| "project_not_found"
	/** Eligibility is per date: the expense (or the trip) needs its date(s) first. */
	| "date_required"
	/** Neither captured history nor an authorized exception proves the project on that date. */
	| "ineligible";

async function projectInOrganization(reader: Reader, organizationId: string, projectId: string) {
	const [row] = await reader
		.select({ id: project.id })
		.from(project)
		.where(and(eq(project.id, projectId), eq(project.organizationId, organizationId)))
		.limit(1);
	return Boolean(row);
}

async function lockedReport(tx: Transaction, owner: ReportOwner, reportId: string) {
	const [report] = await tx
		.select({
			kind: travelExpenseReport.kind,
			organizationId: travelExpenseReport.organizationId,
			tripTimeZone: travelExpenseReport.tripTimeZone,
			tripStartDate: travelExpenseReport.tripStartDate,
			tripEndDate: travelExpenseReport.tripEndDate,
			projectId: travelExpenseReport.projectId,
			detailsVersion: travelExpenseReport.detailsVersion,
		})
		.from(travelExpenseReport)
		.where(
			and(
				eq(travelExpenseReport.id, reportId),
				eq(travelExpenseReport.organizationId, owner.organizationId),
				eq(travelExpenseReport.employeeId, owner.employeeId),
			),
		)
		.limit(1);
	return report ?? null;
}

/** Validates a newly chosen project for the window; null when it may be used. */
async function refuseProject(
	reader: Reader,
	owner: ReportOwner,
	projectId: string,
	window: EligibilityWindow | null,
): Promise<ProjectChoiceRefusal | null> {
	if (!(await projectInOrganization(reader, owner.organizationId, projectId))) {
		return "project_not_found";
	}
	if (!window) return "date_required";
	const eligible = await isProjectEligibleOn(reader, owner, projectId, window);
	return eligible ? null : "ineligible";
}

export type SaveItemProjectResult =
	| { kind: "saved"; version: number; choice: ItemProjectChoice }
	/** The item changed since `expectedVersion`; nothing was written. */
	| { kind: "conflict"; version: number }
	| { kind: "refused"; reason: ProjectChoiceRefusal }
	| { kind: "not_found" }
	| { kind: "not_draft" };

export async function saveItemProjectDraft(
	database: Database,
	owner: ReportOwner,
	input: { reportId: string; itemId: string; expectedVersion: number; choice: ItemProjectChoice },
	now: Instant = systemClock.nowInstant(),
): Promise<SaveItemProjectResult> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const lock = await lockOwnDraftReport(tx, owner, input.reportId);
		if (lock.status !== "draft") return { kind: lock.status };
		const report = await lockedReport(tx, owner, input.reportId);
		const itemScope = and(
			eq(travelExpenseReportItem.id, input.itemId),
			eq(travelExpenseReportItem.reportId, input.reportId),
			eq(travelExpenseReportItem.organizationId, owner.organizationId),
		);
		const [item] = await tx.select().from(travelExpenseReportItem).where(itemScope).limit(1);
		if (!report || !item) return { kind: "not_found" };
		if (item.version !== input.expectedVersion) return { kind: "conflict", version: item.version };

		const current = itemProjectChoice(item);
		const changed =
			input.choice.mode === "project" &&
			!(current.mode === "project" && current.projectId === input.choice.projectId);
		if (input.choice.mode === "project" && changed) {
			const zone = await expenseDateZone(tx, report);
			const window = item.expenseDate
				? { from: item.expenseDate, to: item.expenseDate, timeZone: zone }
				: null;
			const refusal = await refuseProject(tx, owner, input.choice.projectId, window);
			if (refusal) return { kind: "refused", reason: refusal };
		}
		const [saved] = await tx
			.update(travelExpenseReportItem)
			.set({
				...itemProjectColumns(input.choice),
				version: sql`${travelExpenseReportItem.version} + 1`,
				updatedAt: at,
				updatedBy: owner.userId,
			})
			.where(and(itemScope, eq(travelExpenseReportItem.version, input.expectedVersion)))
			.returning({ version: travelExpenseReportItem.version });
		if (!saved) return { kind: "conflict", version: item.version };
		await touchReport(tx, owner, input.reportId, at);
		return { kind: "saved", version: saved.version, choice: input.choice };
	});
}

export type SaveTripProjectResult =
	| { kind: "saved"; version: number; projectId: string | null }
	/** The trip details changed since `expectedVersion`; nothing was written. */
	| { kind: "conflict"; version: number }
	| { kind: "refused"; reason: ProjectChoiceRefusal }
	| { kind: "not_found" }
	| { kind: "not_draft" };

/**
 * Sets the trip's project, which its expenses inherit. A newly chosen project
 * must be eligible on at least one day of the trip; each inheriting expense is
 * checked on its own date at submission.
 */
export async function saveTripProjectDraft(
	database: Database,
	owner: ReportOwner,
	input: { reportId: string; expectedVersion: number; projectId: string | null },
	now: Instant = systemClock.nowInstant(),
): Promise<SaveTripProjectResult> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const lock = await lockOwnDraftReport(tx, owner, input.reportId);
		if (lock.status !== "draft") return { kind: lock.status };
		const report = await lockedReport(tx, owner, input.reportId);
		if (!report || report.kind !== "trip" || !report.tripTimeZone) return { kind: "not_found" };
		if (report.detailsVersion !== input.expectedVersion) {
			return { kind: "conflict", version: report.detailsVersion };
		}
		if (input.projectId && input.projectId !== report.projectId) {
			const window =
				report.tripStartDate && report.tripEndDate
					? { from: report.tripStartDate, to: report.tripEndDate, timeZone: report.tripTimeZone }
					: null;
			const refusal = await refuseProject(tx, owner, input.projectId, window);
			if (refusal) return { kind: "refused", reason: refusal };
		}
		const [saved] = await tx
			.update(travelExpenseReport)
			.set({
				projectId: input.projectId,
				detailsVersion: sql`${travelExpenseReport.detailsVersion} + 1`,
				updatedAt: at,
				updatedBy: owner.userId,
			})
			.where(
				and(
					eq(travelExpenseReport.id, input.reportId),
					eq(travelExpenseReport.organizationId, owner.organizationId),
					eq(travelExpenseReport.employeeId, owner.employeeId),
					eq(travelExpenseReport.detailsVersion, input.expectedVersion),
				),
			)
			.returning({ version: travelExpenseReport.detailsVersion });
		if (!saved) return { kind: "conflict", version: report.detailsVersion };
		return { kind: "saved", version: saved.version, projectId: input.projectId };
	});
}

export interface ProjectChoiceOption {
	id: string;
	name: string;
	customerName: string | null;
	status: ExpenseEligibleProject["status"];
	basis: ExpenseEligibleProject["eligibility"]["basis"];
}

export type ReportProjectChoices =
	| {
			kind: "choices";
			timeZone: string;
			choices: ProjectChoiceOption[];
			/** The currently chosen project, eligible or not. */
			selected: { id: string; name: string; eligible: boolean } | null;
	  }
	| { kind: "not_found" };

function toOption(row: ExpenseEligibleProject): ProjectChoiceOption {
	return {
		id: row.id,
		name: row.name,
		customerName: row.customerName,
		status: row.status,
		basis: row.eligibility.basis,
	};
}

/**
 * The projects the report's owner may choose for calendar days `from`..`to`
 * (one expense date, or the trip's dates), in the report's date zone. The
 * picker reads exactly the rule a save validates.
 */
export async function listReportProjectChoices(
	database: Database,
	owner: ReportOwner,
	input: { reportId: string; from: string; to: string; selectedProjectId: string | null },
): Promise<ReportProjectChoices> {
	const [report] = await database
		.select({
			kind: travelExpenseReport.kind,
			organizationId: travelExpenseReport.organizationId,
			tripTimeZone: travelExpenseReport.tripTimeZone,
		})
		.from(travelExpenseReport)
		.where(
			and(
				eq(travelExpenseReport.id, input.reportId),
				eq(travelExpenseReport.organizationId, owner.organizationId),
				eq(travelExpenseReport.employeeId, owner.employeeId),
			),
		)
		.limit(1);
	if (!report) return { kind: "not_found" };
	const timeZone = await expenseDateZone(database, report);
	const eligible = await listExpenseEligibleProjects(database, owner, {
		from: input.from,
		to: input.to,
		timeZone,
	});
	let selected: { id: string; name: string; eligible: boolean } | null = null;
	if (input.selectedProjectId) {
		const match = eligible.find((row) => row.id === input.selectedProjectId);
		if (match) {
			selected = { id: match.id, name: match.name, eligible: true };
		} else {
			const [row] = await database
				.select({ id: project.id, name: project.name })
				.from(project)
				.where(
					and(
						eq(project.id, input.selectedProjectId),
						eq(project.organizationId, owner.organizationId),
					),
				)
				.limit(1);
			selected = row ? { ...row, eligible: false } : null;
		}
	}
	return { kind: "choices", timeZone, choices: eligible.map(toOption), selected };
}

export type ReportProjectAttributionResult =
	| { ok: true; attribution: Record<string, TravelExpenseReportProjectAttribution> }
	/** Expenses whose project is not (or no longer) proven on their date. */
	| { ok: false; itemIds: string[] };

/**
 * Re-validates every attributed expense of a report under the submission
 * lock and resolves the attribution to freeze: each expense's effective
 * project on its own expense date, with the project's names now and the basis
 * that proves its use.
 */
export async function resolveReportProjectAttribution(
	reader: Reader,
	target: EligibilityTarget,
	input: {
		report: {
			organizationId: string;
			kind: "standalone" | "trip";
			tripTimeZone: string | null;
			projectId?: string | null;
		};
		items: ReadonlyArray<{
			id: string;
			expenseDate: string | null;
			projectId: string | null;
			projectInherits: boolean;
		}>;
	},
): Promise<ReportProjectAttributionResult> {
	const attribution: Record<string, TravelExpenseReportProjectAttribution> = {};
	const ineligible: string[] = [];
	let zone: string | null = null;
	for (const item of input.items) {
		const effective = effectiveItemProject(input.report, item);
		if (!effective) continue;
		if (!item.expenseDate) {
			ineligible.push(item.id);
			continue;
		}
		zone ??= await expenseDateZone(reader, input.report);
		const eligible = await isProjectEligibleOn(reader, target, effective.projectId, {
			from: item.expenseDate,
			to: item.expenseDate,
			timeZone: zone,
		});
		if (!eligible) {
			ineligible.push(item.id);
			continue;
		}
		const { exception } = eligible;
		attribution[item.id] = {
			projectId: eligible.id,
			name: eligible.name,
			customerId: eligible.customerId,
			customerName: eligible.customerName,
			inheritedFromTrip: effective.inheritedFromTrip,
			basis: eligible.eligibility.basis,
			...(exception
				? {
						exception: {
							exceptionId: exception.exceptionId,
							validFrom: exception.validFrom,
							validTo: exception.validTo,
							reason: exception.reason,
							evidence: exception.evidence,
							authorizedByEmployeeId: exception.authorizedByEmployeeId,
							authorizedAt: instantToCanonicalString(instantFromDate(exception.authorizedAt)),
						},
					}
				: {}),
		};
	}
	return ineligible.length > 0 ? { ok: false, itemIds: ineligible } : { ok: true, attribution };
}

/**
 * The owner's draft expenses whose effective project (own or inherited from
 * the trip) is not proven on their own date: exactly the expenses submission
 * would refuse as `project_ineligible`, so the editor can say so up front.
 * A trip project eligible on some trip day may still fail other days.
 */
export async function listReportProjectIssues(
	reader: Reader,
	owner: ReportOwner,
	reportId: string,
): Promise<{ kind: "issues"; itemIds: string[] } | { kind: "not_found" }> {
	const [report] = await reader
		.select({
			organizationId: travelExpenseReport.organizationId,
			kind: travelExpenseReport.kind,
			tripTimeZone: travelExpenseReport.tripTimeZone,
			projectId: travelExpenseReport.projectId,
		})
		.from(travelExpenseReport)
		.where(
			and(
				eq(travelExpenseReport.id, reportId),
				eq(travelExpenseReport.organizationId, owner.organizationId),
				eq(travelExpenseReport.employeeId, owner.employeeId),
			),
		)
		.limit(1);
	if (!report) return { kind: "not_found" };
	const items = await reader
		.select({
			id: travelExpenseReportItem.id,
			expenseDate: travelExpenseReportItem.expenseDate,
			projectId: travelExpenseReportItem.projectId,
			projectInherits: travelExpenseReportItem.projectInherits,
		})
		.from(travelExpenseReportItem)
		.where(
			and(
				eq(travelExpenseReportItem.reportId, reportId),
				eq(travelExpenseReportItem.organizationId, owner.organizationId),
			),
		);
	// Undated expenses are already incomplete; only dated ones are checked here.
	const dated = items.filter((item) => item.expenseDate !== null);
	const result = await resolveReportProjectAttribution(reader, owner, { report, items: dated });
	return { kind: "issues", itemIds: result.ok ? [] : result.itemIds };
}
