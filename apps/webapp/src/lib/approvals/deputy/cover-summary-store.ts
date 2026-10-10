import "server-only";

import {
	aliasedTable,
	and,
	count,
	eq,
	gte,
	inArray,
	isNotNull,
	isNull,
	lte,
	max,
	min,
	ne,
	or,
} from "drizzle-orm";
import type { db as appDb } from "@/db";
import { organization, user } from "@/db/auth-schema";
import {
	absenceCategory,
	absenceEntry,
	approvalDeputyCoverSummary,
	approvalDeputyDecision,
	approvalRequest,
	approvalWorkflow,
	employee,
	userSettings,
} from "@/db/schema";
import { loadWorkingDays } from "@/lib/absences/absence-days-resolver";
import { dateFromInstant, type Instant, type PlainDate, plainDateAt } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { createLogger } from "@/lib/logger";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import {
	buildCoverReturnSummaryNotification,
	buildCoverStartedNotification,
	isReturnSummaryDue,
} from "./cover-summaries";
import { loadCover } from "./covering-store";

/**
 * Cover summaries (#1018) against the database: the scheduled run that finds
 * whose cover starts and who is back, claims each summary once per absence,
 * deputy and kind, and delivers it; and the list of decisions a return summary
 * links to. Every query is organization-scoped; days are the absent
 * approver's, in their effective timezone.
 */

const logger = createLogger("DeputyCoverSummaries");

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Pick<Database | Transaction, "select">;

export interface CoverSummariesResult {
	coverStart: { candidates: number; sent: number };
	returnSummary: { candidates: number; sent: number };
	failed: number;
}

export interface CoverSummariesInput {
	now: Instant;
	/** Delivers one summary; throws when it could not be delivered. */
	notify?: (params: CreateNotificationParams) => Promise<unknown>;
	/** What waits in the deputy's "Covering for" section for this approver. */
	countPending?: (input: {
		organizationId: string;
		approverEmployeeId: string;
		now: Instant;
	}) => Promise<number>;
}

async function deliverNotification(params: CreateNotificationParams): Promise<void> {
	const { createNotification } = await import("@/lib/notifications/notification-service");
	await createNotification(params, { throwOnError: true });
}

async function countInboxPending(input: {
	organizationId: string;
	approverEmployeeId: string;
	now: Instant;
}): Promise<number> {
	// The inbox handlers are registered on import.
	await import("@/lib/approvals/init");
	const { countCoveredApproverPending } = await import("@/lib/approvals/inbox/read-service");
	return countCoveredApproverPending({
		organizationId: input.organizationId,
		approverId: input.approverEmployeeId,
		now: dateFromInstant(input.now),
	});
}

function displayName(name: string | null | undefined): string {
	return name?.trim() || "A colleague";
}

/**
 * One run of the cover summaries, for every organization. A summary is claimed
 * before it is delivered, so reruns, overlapping runs and retries send nothing
 * again; a failed delivery gives the claim back for the next run.
 */
export async function runCoverSummaries(
	database: Database,
	input: CoverSummariesInput,
): Promise<CoverSummariesResult> {
	const deps = {
		now: input.now,
		notify: input.notify ?? deliverNotification,
		countPending: input.countPending ?? countInboxPending,
	};
	const coverStart = await sendCoverStartSummaries(database, deps);
	const returnSummary = await sendReturnSummaries(database, deps);
	return {
		coverStart: { candidates: coverStart.candidates, sent: coverStart.sent },
		returnSummary: { candidates: returnSummary.candidates, sent: returnSummary.sent },
		failed: coverStart.failed + returnSummary.failed,
	};
}

type Deps = Required<CoverSummariesInput>;
interface Tally {
	candidates: number;
	sent: number;
	failed: number;
}

/**
 * Claims a summary, delivers it, and gives the claim back when delivery
 * failed. Returns whether this run sent it.
 */
async function claimAndDeliver(
	database: Database,
	claim: typeof approvalDeputyCoverSummary.$inferInsert,
	params: CreateNotificationParams,
	notify: Deps["notify"],
): Promise<boolean> {
	const [claimed] = await database
		.insert(approvalDeputyCoverSummary)
		.values(claim)
		.onConflictDoNothing()
		.returning({ id: approvalDeputyCoverSummary.id });
	if (!claimed) return false;
	try {
		await notify(params);
		return true;
	} catch (error) {
		await database
			.delete(approvalDeputyCoverSummary)
			.where(
				and(
					eq(approvalDeputyCoverSummary.organizationId, claim.organizationId),
					eq(approvalDeputyCoverSummary.id, claimed.id),
				),
			);
		throw error;
	}
}

/**
 * The deputy's summary when the cover starts: on the first run where the
 * deputy covers for the approver because of this absence (#1015 covering:
 * switch on, deputy can decide approvals, approved absence on the approver's
 * local day). An absence approved after it started is told on the next run; a
 * deputy named mid-absence is a new deputy and is told too.
 */
async function sendCoverStartSummaries(database: Database, deps: Deps): Promise<Tally> {
	// Every timezone's local day lies within one day of the UTC day.
	const utcToday = plainDateAt(deps.now, "UTC");
	const rows = await database
		.select({
			id: absenceEntry.id,
			organizationId: absenceEntry.organizationId,
			employeeId: absenceEntry.employeeId,
			deputyEmployeeId: absenceEntry.deputyEmployeeId,
			absentName: user.name,
		})
		.from(absenceEntry)
		.innerJoin(
			absenceCategory,
			and(
				eq(absenceCategory.id, absenceEntry.categoryId),
				eq(absenceCategory.organizationId, absenceEntry.organizationId),
			),
		)
		.innerJoin(
			employee,
			and(
				eq(employee.id, absenceEntry.employeeId),
				eq(employee.organizationId, absenceEntry.organizationId),
			),
		)
		.innerJoin(user, eq(user.id, employee.userId))
		.leftJoin(
			approvalDeputyCoverSummary,
			and(
				eq(approvalDeputyCoverSummary.organizationId, absenceEntry.organizationId),
				eq(approvalDeputyCoverSummary.absenceId, absenceEntry.id),
				eq(approvalDeputyCoverSummary.deputyEmployeeId, absenceEntry.deputyEmployeeId),
				eq(approvalDeputyCoverSummary.kind, "cover_start"),
			),
		)
		.where(
			and(
				eq(absenceEntry.status, "approved"),
				isNotNull(absenceEntry.organizationId),
				isNotNull(absenceEntry.deputyEmployeeId),
				eq(absenceCategory.requiresWorkTime, false),
				lte(absenceEntry.startDate, utcToday.add({ days: 1 }).toString()),
				gte(absenceEntry.endDate, utcToday.subtract({ days: 1 }).toString()),
				isNull(approvalDeputyCoverSummary.id),
			),
		);

	const tally: Tally = { candidates: rows.length, sent: 0, failed: 0 };
	// One claim and delivery per absence; few rows per run.
	// react-doctor-disable-next-line react-doctor/async-await-in-loop
	for (const row of rows) {
		const organizationId = row.organizationId as string;
		const deputyEmployeeId = row.deputyEmployeeId as string;
		try {
			const cover = await loadCover(database, {
				organizationId,
				approverId: row.employeeId,
				deputyId: deputyEmployeeId,
				at: deps.now,
			});
			// Of overlapping absences naming the same deputy, the cover's one is told.
			if (cover?.absenceId !== row.id) continue;
			const [deputy] = await database
				.select({ userId: employee.userId })
				.from(employee)
				.where(and(eq(employee.id, deputyEmployeeId), eq(employee.organizationId, organizationId)))
				.limit(1);
			if (!deputy) continue;
			const pendingCount = await deps.countPending({
				organizationId,
				approverEmployeeId: row.employeeId,
				now: deps.now,
			});
			const sent = await claimAndDeliver(
				database,
				{
					organizationId,
					absenceId: row.id,
					deputyEmployeeId,
					kind: "cover_start",
					localDate: cover.day,
					itemCount: pendingCount,
				},
				buildCoverStartedNotification({
					organizationId,
					recipientUserId: deputy.userId,
					absentName: displayName(row.absentName),
					approverEmployeeId: row.employeeId,
					absenceId: row.id,
					deputyEmployeeId,
					pendingCount,
				}),
				deps.notify,
			);
			if (sent) tally.sent += 1;
		} catch (error) {
			tally.failed += 1;
			logger.error(
				{ error, organizationId, absenceId: row.id },
				"Failed to send the cover start summary",
			);
		}
	}
	return tally;
}

/**
 * The approver's summary on return: one per absence and deputy who decided
 * something for them during it (from the acting-for record), on the
 * approver's first local working day after the absence. None when the deputy
 * decided nothing. A cancelled absence is deleted; its acting-for records keep
 * its id and dates, and it counts as ended once cancelled.
 */
async function sendReturnSummaries(database: Database, deps: Deps): Promise<Tally> {
	// The approver's day after the absence is at most one day ahead of the UTC day.
	const utcToday = plainDateAt(deps.now, "UTC");
	const rows = await database
		.select({
			organizationId: approvalDeputyDecision.organizationId,
			absenceId: approvalDeputyDecision.absenceId,
			deputyEmployeeId: approvalDeputyDecision.deputyEmployeeId,
			approverEmployeeId: approvalDeputyDecision.actingForEmployeeId,
			approverUserId: employee.userId,
			liveEndDate: absenceEntry.endDate,
			liveStatus: absenceEntry.status,
			recordedEndDate: max(approvalDeputyDecision.absenceEndDate),
			userTimezone: userSettings.timezone,
			organizationTimezone: organization.timezone,
			decisionCount: count(approvalDeputyDecision.id),
		})
		.from(approvalDeputyDecision)
		.leftJoin(
			absenceEntry,
			and(
				eq(absenceEntry.id, approvalDeputyDecision.absenceId),
				eq(absenceEntry.organizationId, approvalDeputyDecision.organizationId),
				eq(absenceEntry.employeeId, approvalDeputyDecision.actingForEmployeeId),
			),
		)
		.innerJoin(
			employee,
			and(
				eq(employee.id, approvalDeputyDecision.actingForEmployeeId),
				eq(employee.organizationId, approvalDeputyDecision.organizationId),
			),
		)
		.innerJoin(organization, eq(organization.id, approvalDeputyDecision.organizationId))
		.leftJoin(userSettings, eq(userSettings.userId, employee.userId))
		.leftJoin(
			approvalDeputyCoverSummary,
			and(
				eq(approvalDeputyCoverSummary.organizationId, approvalDeputyDecision.organizationId),
				eq(approvalDeputyCoverSummary.absenceId, approvalDeputyDecision.absenceId),
				eq(approvalDeputyCoverSummary.deputyEmployeeId, approvalDeputyDecision.deputyEmployeeId),
				eq(approvalDeputyCoverSummary.kind, "return"),
			),
		)
		.where(
			and(
				isNotNull(approvalDeputyDecision.absenceId),
				isNull(approvalDeputyCoverSummary.id),
				// Ended by its dates, or no longer an approved absence (cancelled or overridden).
				or(
					isNull(absenceEntry.id),
					ne(absenceEntry.status, "approved"),
					lte(absenceEntry.endDate, utcToday.toString()),
				),
				employeeHasOrganizationAccess(deps.now),
			),
		)
		.groupBy(
			approvalDeputyDecision.organizationId,
			approvalDeputyDecision.absenceId,
			approvalDeputyDecision.deputyEmployeeId,
			approvalDeputyDecision.actingForEmployeeId,
			employee.userId,
			absenceEntry.endDate,
			absenceEntry.status,
			userSettings.timezone,
			organization.timezone,
		);

	const tally: Tally = { candidates: rows.length, sent: 0, failed: 0 };
	// One due check, claim and delivery per absence and deputy; few rows per run.
	// react-doctor-disable-next-line react-doctor/async-await-in-loop
	for (const row of rows) {
		const absenceId = row.absenceId as string;
		try {
			const timezone = resolveEffectiveTimezone(
				row.userTimezone ?? undefined,
				row.organizationTimezone ?? undefined,
			);
			const today = plainDateAt(deps.now, timezone);
			const endDate = returnSummaryEndDate(row, today);
			if (!endDate || today.toString() <= endDate) continue;
			const [otherAbsences, isWorkingDay] = await Promise.all([
				loadOtherAbsences(database, {
					organizationId: row.organizationId,
					employeeId: row.approverEmployeeId,
					absenceId,
					from: endDate,
					until: today.toString(),
				}),
				loadWorkingDays(database, {
					organizationId: row.organizationId,
					employeeId: row.approverEmployeeId,
					startDate: today.toString(),
					endDate: today.toString(),
				}),
			]);
			if (
				!isReturnSummaryDue({
					today,
					absenceEndDate: endDate,
					otherAbsences,
					isWorkingDay,
				})
			) {
				continue;
			}
			const [deputy] = await database
				.select({ name: user.name })
				.from(employee)
				.innerJoin(user, eq(user.id, employee.userId))
				.where(
					and(
						eq(employee.id, row.deputyEmployeeId),
						eq(employee.organizationId, row.organizationId),
					),
				)
				.limit(1);
			const decisionCount = Number(row.decisionCount);
			const sent = await claimAndDeliver(
				database,
				{
					organizationId: row.organizationId,
					absenceId,
					deputyEmployeeId: row.deputyEmployeeId,
					kind: "return",
					localDate: today.toString(),
					itemCount: decisionCount,
				},
				buildCoverReturnSummaryNotification({
					organizationId: row.organizationId,
					recipientUserId: row.approverUserId,
					deputyName: displayName(deputy?.name),
					absenceId,
					deputyEmployeeId: row.deputyEmployeeId,
					decisionCount,
				}),
				deps.notify,
			);
			if (sent) tally.sent += 1;
		} catch (error) {
			tally.failed += 1;
			logger.error(
				{ error, organizationId: row.organizationId, absenceId },
				"Failed to send the cover return summary",
			);
		}
	}
	return tally;
}

/**
 * The last day the return summary waits for: the absence's end while it is
 * still approved; once cancelled or no longer approved, its recorded end, but
 * no later than yesterday (it has ended). Null when nothing tells the end.
 */
function returnSummaryEndDate(
	row: { liveEndDate: string | null; liveStatus: string | null; recordedEndDate: string | null },
	today: PlainDate,
): string | null {
	if (row.liveEndDate && row.liveStatus === "approved") return row.liveEndDate;
	const yesterday = today.subtract({ days: 1 }).toString();
	const recorded = row.liveEndDate ?? row.recordedEndDate;
	if (!recorded) return yesterday;
	return recorded < yesterday ? recorded : yesterday;
}
/**
 * The approver's other approved absences that do not count as working time,
 * ending on or after this one's end and starting by `until`: the back-to-back
 * absences the return summary waits for.
 */
async function loadOtherAbsences(
	database: Reader,
	input: {
		organizationId: string;
		employeeId: string;
		absenceId: string;
		from: string;
		until: string;
	},
) {
	return database
		.select({ startDate: absenceEntry.startDate, endDate: absenceEntry.endDate })
		.from(absenceEntry)
		.innerJoin(
			absenceCategory,
			and(
				eq(absenceCategory.id, absenceEntry.categoryId),
				eq(absenceCategory.organizationId, input.organizationId),
			),
		)
		.where(
			and(
				eq(absenceEntry.organizationId, input.organizationId),
				eq(absenceEntry.employeeId, input.employeeId),
				eq(absenceEntry.status, "approved"),
				eq(absenceCategory.requiresWorkTime, false),
				ne(absenceEntry.id, input.absenceId),
				gte(absenceEntry.endDate, input.from),
				lte(absenceEntry.startDate, input.until),
			),
		);
}

/** One approval a deputy decided for the approver during the absence. */
export interface AbsenceDeputyDecision {
	id: string;
	entityType: string;
	entityId: string;
	decision: "approved" | "rejected";
	decidedAt: Date;
	deputy: { employeeId: string; name: string };
	/** Whose request it was; null when it cannot be told. */
	requesterName: string | null;
}

export interface AbsenceDeputyDecisions {
	/** Null dates: a cancelled absence recorded before its dates were kept. */
	absence: { id: string; startDate: string | null; endDate: string | null };
	decisions: AbsenceDeputyDecision[];
}

/**
 * The approvals deputies decided for the approver during this absence, oldest
 * first, optionally of one deputy: what the return summary links to. Only the
 * absent approver may read them; null for anyone else, or an absence outside
 * the organization.
 */
export async function loadDeputyDecisionsForAbsence(
	reader: Reader,
	input: {
		organizationId: string;
		absenceId: string;
		viewerEmployeeId: string;
		deputyEmployeeId?: string;
	},
): Promise<AbsenceDeputyDecisions | null> {
	const [live] = await reader
		.select({
			id: absenceEntry.id,
			employeeId: absenceEntry.employeeId,
			startDate: absenceEntry.startDate,
			endDate: absenceEntry.endDate,
		})
		.from(absenceEntry)
		.where(
			and(
				eq(absenceEntry.id, input.absenceId),
				eq(absenceEntry.organizationId, input.organizationId),
			),
		)
		.limit(1);
	// A cancelled absence is gone; its acting-for records keep its dates.
	const [recorded] = live
		? []
		: await reader
				.select({
					employeeId: approvalDeputyDecision.actingForEmployeeId,
					startDate: min(approvalDeputyDecision.absenceStartDate),
					endDate: max(approvalDeputyDecision.absenceEndDate),
				})
				.from(approvalDeputyDecision)
				.where(
					and(
						eq(approvalDeputyDecision.organizationId, input.organizationId),
						eq(approvalDeputyDecision.absenceId, input.absenceId),
						eq(approvalDeputyDecision.actingForEmployeeId, input.viewerEmployeeId),
					),
				)
				.groupBy(approvalDeputyDecision.actingForEmployeeId);
	const absence = live ?? (recorded ? { id: input.absenceId, ...recorded } : undefined);
	if (!absence || absence.employeeId !== input.viewerEmployeeId) return null;

	const deputyEmployee = aliasedTable(employee, "deputy_employee");
	const deputyUser = aliasedTable(user, "deputy_user");
	const rows = await reader
		.select({
			id: approvalDeputyDecision.id,
			entityType: approvalDeputyDecision.entityType,
			entityId: approvalDeputyDecision.entityId,
			decision: approvalDeputyDecision.decision,
			decidedAt: approvalDeputyDecision.decidedAt,
			deputyEmployeeId: approvalDeputyDecision.deputyEmployeeId,
			deputyName: deputyUser.name,
			legacyRequesterId: approvalRequest.requestedBy,
			canonicalRequesterId: approvalWorkflow.requesterEmployeeId,
		})
		.from(approvalDeputyDecision)
		.innerJoin(
			deputyEmployee,
			and(
				eq(deputyEmployee.id, approvalDeputyDecision.deputyEmployeeId),
				eq(deputyEmployee.organizationId, input.organizationId),
			),
		)
		.innerJoin(deputyUser, eq(deputyUser.id, deputyEmployee.userId))
		.leftJoin(
			approvalRequest,
			and(
				eq(approvalRequest.id, approvalDeputyDecision.approvalRequestId),
				eq(approvalRequest.organizationId, input.organizationId),
			),
		)
		.leftJoin(
			approvalWorkflow,
			and(
				eq(approvalWorkflow.id, approvalDeputyDecision.workflowId),
				eq(approvalWorkflow.organizationId, input.organizationId),
			),
		)
		.where(
			and(
				eq(approvalDeputyDecision.organizationId, input.organizationId),
				eq(approvalDeputyDecision.absenceId, absence.id),
				eq(approvalDeputyDecision.actingForEmployeeId, absence.employeeId),
				input.deputyEmployeeId
					? eq(approvalDeputyDecision.deputyEmployeeId, input.deputyEmployeeId)
					: undefined,
			),
		)
		.orderBy(approvalDeputyDecision.decidedAt, approvalDeputyDecision.id);

	const requesterIds = [
		...new Set(
			rows.flatMap((row) => {
				const id = row.legacyRequesterId ?? row.canonicalRequesterId;
				return id ? [id] : [];
			}),
		),
	];
	const requesters =
		requesterIds.length > 0
			? await reader
					.select({ id: employee.id, name: user.name })
					.from(employee)
					.innerJoin(user, eq(user.id, employee.userId))
					.where(
						and(
							eq(employee.organizationId, input.organizationId),
							inArray(employee.id, requesterIds),
						),
					)
			: [];
	const requesterNames = new Map(requesters.map((row) => [row.id, row.name]));

	return {
		absence: {
			id: absence.id,
			startDate: absence.startDate ?? null,
			endDate: absence.endDate ?? null,
		},
		decisions: rows.map((row) => {
			const requesterId = row.legacyRequesterId ?? row.canonicalRequesterId;
			return {
				id: row.id,
				entityType: row.entityType,
				entityId: row.entityId,
				decision: row.decision,
				decidedAt: row.decidedAt,
				deputy: { employeeId: row.deputyEmployeeId, name: displayName(row.deputyName) },
				requesterName: requesterId ? (requesterNames.get(requesterId) ?? null) : null,
			};
		}),
	};
}
