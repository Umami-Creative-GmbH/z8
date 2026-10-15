import "server-only";
import { isAuthorizedReconciledAbsence } from "./vacation-reconciliation-authorization";
import { createHash } from "node:crypto";
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { member, organization } from "@/db/auth-schema";
import {
	absenceCategory,
	absenceEntry,
	auditLog,
	employee,
	importStagedRow,
	vacationAdjustment,
	vacationReconciliation,
} from "@/db/schema";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { assertAbsenceDaysOpen } from "@/lib/time-tracking/closed-months/store";
import { monthClosedRefusalOf } from "@/lib/time-tracking/closed-months/refusal";
import {
	acquireOrganizationConfigurationGuard,
	acquireExclusiveOrganizationConfigurationGuard,
} from "@/lib/time-tracking/work-transaction";
import { loadEmployeeTrackingContext } from "@/lib/time-tracking/tracking-start";
import {
	loadWorkingDaysForEmployees,
	type AbsenceDaysDatabase,
} from "./absence-days-resolver";
import { reconciliationInputSchema } from "./vacation-reconciliation-types";
import { loadVacationBalances } from "./vacation-balance-store";

export class HistoricalVacationError extends Error {
	constructor(
		readonly refusal: "overlap" | "stale" | "invalid" | "forbidden",
		message: string,
	) {
		super(message);
		this.name = "HistoricalVacationError";
	}
}
export function historicalVacationRefusalOf(
	error: unknown,
): HistoricalVacationError | null {
	let candidate = error;
	for (let i = 0; i < 8 && candidate && typeof candidate === "object"; i++) {
		if (candidate instanceof HistoricalVacationError) return candidate;
		candidate = "cause" in candidate ? candidate.cause : undefined;
	}
	return null;
}
const OVERLAP_MESSAGE =
	"These dates may already be included in previously taken vacation. Review and reconcile the employee's historical total before recording overlapping vacation.";

/**
 * The caller holds the shared organization configuration guard from assertAbsenceDaysOpen.
 * Aggregate commits take that guard exclusively before reading, including when no total exists.
 * Keep this read in the same transaction and before any related write.
 */
export async function assertHistoricalVacationNotOverlapping(
	database: Pick<AbsenceDaysDatabase, "execute">,
	input: {
		organizationId: string;
		employeeId: string;
		startDate: string;
		endDate: string;
		categoryId?: string;
		unresolvedImport?: boolean;
	},
) {
	if (isAuthorizedReconciledAbsence(database, input)) return;
	const result = await database.execute<{ id: string }>(sql`
        select historical.id
        from vacation_adjustment as historical
        inner join employee as subject on subject.id=historical.employee_id
        where subject.organization_id=${input.organizationId}
          and subject.id=${input.employeeId}
          and historical.kind='historical_usage'
          and historical.days < 0
          and historical.historical_coverage_start <= ${input.endDate}::date
          and historical.historical_coverage_end >= ${input.startDate}::date
          and (${input.unresolvedImport === true} or exists (
            select 1 from absence_category as category
            where category.organization_id=${input.organizationId}
              and category.id::text=${input.categoryId ?? ""}
              and category.counts_against_vacation=true
          ))
        limit 1
    `);
	const rows = Array.isArray(result) ? result : result.rows;
	if (rows.length)
		throw new HistoricalVacationError("overlap", OVERLAP_MESSAGE);
}

export const historicalVacationInputSchema = z.object({
	organizationId: z.string().min(1).max(200),
	employeeId: z.string().uuid(),
	year: z.number().int().min(1900).max(9998),
	days: z.number().finite().min(0).max(366).multipleOf(0.5),
	reason: z.string().trim().min(1).max(2000),
	excludesListedDatedHistory: z.boolean().default(false),
});
export type HistoricalVacationInput = z.infer<
	typeof historicalVacationInputSchema
>;

/** Recheck current approved membership and target scope under the mutation's configuration guard. */
async function requireHistoricalAdmin(
	database: AbsenceDaysDatabase,
	input: HistoricalVacationInput,
	actorUserId: string,
) {
	const [membership] = await database
		.select({ role: member.role })
		.from(member)
		.where(
			and(
				eq(member.organizationId, input.organizationId),
				eq(member.userId, actorUserId),
				eq(member.status, "approved"),
			),
		)
		.limit(1);
	const [actor] = await database
		.select()
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				eq(employee.userId, actorUserId),
				eq(employee.isActive, true),
			),
		)
		.limit(1);
	const [target] = await database
		.select()
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				eq(employee.id, input.employeeId),
			),
		)
		.limit(1);
	if (
		!membership ||
		!(
			hasOrganizationRole(membership.role, "owner") ||
			hasOrganizationRole(membership.role, "admin")
		) ||
		!actor ||
		!target
	)
		throw new HistoricalVacationError(
			"forbidden",
			"Only an active organization admin can review previously taken vacation for this employee.",
		);
	return { actor, target };
}

async function review(
	database: AbsenceDaysDatabase,
	input: HistoricalVacationInput,
	actorUserId: string,
) {
	const { actor, target } = await requireHistoricalAdmin(
		database,
		input,
		actorUserId,
	);
	const [existing] = await database
		.select()
		.from(vacationAdjustment)
		.where(
			and(
				eq(vacationAdjustment.employeeId, input.employeeId),
				eq(vacationAdjustment.year, input.year),
				eq(vacationAdjustment.kind, "historical_usage"),
			),
		)
		.limit(1);
	const tracking = await loadEmployeeTrackingContext(database, input);
	const yearStart = Temporal.PlainDate.from({
		year: input.year,
		month: 1,
		day: 1,
	});
	const yearEnd = Temporal.PlainDate.from({
		year: input.year,
		month: 12,
		day: 31,
	});
	if (!existing && (!tracking || tracking.startDate <= yearStart.toString()))
		throw new HistoricalVacationError(
			"invalid",
			"Activate reviewed tracking dates first, and choose a year with vacation before tracking began.",
		);
	const coverageStart =
		existing?.historicalCoverageStart ?? yearStart.toString();
	const coverageEnd =
		existing?.historicalCoverageEnd ??
		(tracking!.startDate > yearEnd.toString()
			? yearEnd.toString()
			: Temporal.PlainDate.from(tracking!.startDate)
					.subtract({ days: 1 })
					.toString());
	const [org] = await database
		.select({ timezone: organization.timezone })
		.from(organization)
		.where(eq(organization.id, input.organizationId));
	const timezone = org?.timezone ?? "UTC";
	const records = await database
		.select({
			id: absenceEntry.id,
			startDate: absenceEntry.startDate,
			endDate: absenceEntry.endDate,
			startPeriod: absenceEntry.startPeriod,
			endPeriod: absenceEntry.endPeriod,
			status: absenceEntry.status,
			updatedAt: absenceEntry.updatedAt,
			categoryId: absenceCategory.id,
			category: absenceCategory.name,
			countsAgainstVacation: absenceCategory.countsAgainstVacation,
			categoryType: absenceCategory.type,
		})
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
				or(
					isNull(absenceEntry.organizationId),
					eq(absenceEntry.organizationId, input.organizationId),
				),
				eq(absenceEntry.employeeId, input.employeeId),
				lte(absenceEntry.startDate, yearEnd.toString()),
				gte(absenceEntry.endDate, yearStart.toString()),
				or(
					eq(absenceEntry.status, "approved"),
					eq(absenceEntry.status, "pending"),
				),
			),
		)
		.orderBy(asc(absenceEntry.id));
	const importedEvidence =
		records.length === 0
			? []
			: await database
					.select({
						id: importStagedRow.id,
						batchId: importStagedRow.batchId,
						targetId: importStagedRow.commitTargetId,
						sourceId: importStagedRow.providerSourceId,
						sourceHash: importStagedRow.sourcePayloadHash,
						payload: importStagedRow.normalizedPayload,
					})
					.from(importStagedRow)
					.where(
						and(
							eq(importStagedRow.organizationId, input.organizationId),
							inArray(
								importStagedRow.commitTargetId,
								records.map((row) => row.id),
							),
							eq(importStagedRow.entityType, "absence"),
							eq(importStagedRow.commitTargetTable, "absence_entry"),
							eq(importStagedRow.rowStatus, "committed"),
						),
					)
					.orderBy(asc(importStagedRow.id));

	const batchIds = [...new Set(importedEvidence.map((row) => row.batchId))];
	const mappingReceipts = batchIds.length
		? await database
				.select({
					id: vacationReconciliation.id,
					plan: vacationReconciliation.plan,
					result: vacationReconciliation.result,
				})
				.from(vacationReconciliation)
				.where(
					and(
						eq(vacationReconciliation.organizationId, input.organizationId),
						eq(vacationReconciliation.status, "committed"),
						eq(sql<string>`${vacationReconciliation.plan}->>'kind'`, "import"),
						inArray(
							sql<string>`${vacationReconciliation.plan}->>'batchId'`,
							batchIds,
						),
					),
				)
		: [];

	const explicitlyMappedRows = new Set<string>();
	const sourceById = new Map(importedEvidence.map((row) => [row.id, row]));
	const recordById = new Map(records.map((record) => [record.id, record]));
	for (const receipt of mappingReceipts) {
		const parsed = reconciliationInputSchema.safeParse(receipt.plan);
		const targets = z
			.array(z.object({ rowId: z.uuid(), absenceId: z.uuid() }))
			.safeParse(receipt.result?.targets);
		if (!parsed.success || parsed.data.kind !== "import" || !targets.success)
			continue;
		const plan = parsed.data,
			targetByRow = new Map(
				targets.data.map((target) => [target.rowId, target.absenceId]),
			);
		for (const mapped of plan.mappings) {
			const source = sourceById.get(mapped.rowId);
			if (!source || source.batchId !== plan.batchId || !source.targetId)
				continue;
			const current = recordById.get(source.targetId);
			// Later approved date corrections retain the reviewed category classification.
			if (
				current &&
				targetByRow.get(source.id) === current.id &&
				current.categoryId === mapped.categoryId
			)
				explicitlyMappedRows.add(source.id);
		}
	}
	const unresolvedImportedAbsences = new Set(
		importedEvidence
			.filter((row) => {
				if (explicitlyMappedRows.has(row.id)) return false;
				const current = row.targetId ? recordById.get(row.targetId) : undefined;
				return (
					typeof row.payload.categoryName !== "string" ||
					!row.payload.categoryName.trim() ||
					(current?.categoryType === "custom" && !current.countsAgainstVacation)
				);
			})
			.map((row) => row.targetId),
	);

	const historicalRecords = records.filter(
		(row) =>
			(row.countsAgainstVacation || unresolvedImportedAbsences.has(row.id)) &&
			row.startDate <= coverageEnd &&
			row.endDate >= coverageStart,
	);
	const beforeResult = await loadVacationBalances(database, {
		organizationId: input.organizationId,
		employeeIds: [input.employeeId],
		year: input.year,
		timezone,
	});
	const afterResult = await loadVacationBalances(database, {
		organizationId: input.organizationId,
		employeeIds: [input.employeeId],
		year: input.year,
		timezone,
		previouslyTakenOverride: { employeeId: input.employeeId, days: input.days },
	});
	const before = beforeResult.balances.get(input.employeeId);
	const after = afterResult.balances.get(input.employeeId);
	if (!before || !after)
		throw new HistoricalVacationError(
			"invalid",
			"Configure a company vacation policy for the selected year first.",
		);
	const blockers: string[] = [];
	const unresolvedHistoricalImportIds = historicalRecords
		.filter((record) => unresolvedImportedAbsences.has(record.id))
		.map((record) => record.id);
	if (input.days > 0 && unresolvedHistoricalImportIds.length)
		blockers.push(
			"Imported historical absence categories are unresolved. Confirm their explicit import mapping before excluding dated history from a positive total.",
		);
	if (
		input.days > 0 &&
		historicalRecords.length &&
		!input.excludesListedDatedHistory
	)
		blockers.push(
			"Recorded historical vacation may already be included in this total. Explicitly confirm that the supplied remaining total excludes every listed dated record before saving.",
		);
	try {
		await assertAbsenceDaysOpen(database, {
			...input,
			days: [{ startDate: coverageStart, endDate: coverageEnd }],
		});
	} catch (error) {
		const closed = monthClosedRefusalOf(error);
		if (!closed) throw error;
		blockers.push(closed.message);
	}
	// Day schedule and full policy are part of reviewed inputs even if changes happen to leave today's balance equal.
	const working = await loadWorkingDaysForEmployees(database, {
		...input,
		employeeIds: [input.employeeId],
		startDate: yearStart.toString(),
		endDate: yearEnd.toString(),
	});
	const workingDates: string[] = [];
	for (
		let day = yearStart;
		Temporal.PlainDate.compare(day, yearEnd) <= 0;
		day = day.add({ days: 1 })
	)
		if (working.get(input.employeeId)?.(day)) workingDates.push(day.toString());
	const fingerprint = createHash("sha256")
		.update(
			JSON.stringify({
				input,
				actorUserId,
				existing: existing ?? null,
				target,
				tracking,
				coverageStart,
				coverageEnd,
				records,
				importedEvidence,
				mappingReceipts,
				before,
				after,
				policy: beforeResult.policy,
				workingDates,
				blockers,
			}),
		)
		.digest("hex");
	return {
		actor,
		existing,
		tracking,
		coverageStart,
		coverageEnd,
		timezone,
		before,
		after,
		blockers,
		historicalRecords,
		unresolvedHistoricalImportIds,
		fingerprint,
	};
}

/** Called only inside the action's transaction. The same review is rerun on commit. */
export async function reviewPreviouslyTakenVacation(
	database: AbsenceDaysDatabase,
	input: HistoricalVacationInput,
	actorUserId: string,
	fingerprint?: string,
) {
	if (fingerprint === undefined)
		await acquireOrganizationConfigurationGuard(database, input.organizationId);
	else
		await acquireExclusiveOrganizationConfigurationGuard(
			database,
			input.organizationId,
		);
	const reviewed = await review(database, input, actorUserId);
	if (fingerprint !== undefined) {
		if (reviewed.fingerprint !== fingerprint)
			throw new HistoricalVacationError(
				"stale",
				"The employee, total or reviewed inputs changed. Review previously taken vacation again.",
			);
		if (reviewed.blockers.length)
			throw new HistoricalVacationError("overlap", reviewed.blockers.join(" "));
		const values = {
			days: (-input.days).toFixed(2),
			reason: input.reason,
			adjustedBy: reviewed.actor.id,
			updatedAt: currentTimestamp(),
		};
		let adjustmentId: string;
		if (reviewed.existing) {
			const [updated] = await database
				.update(vacationAdjustment)
				.set({ ...values, revision: reviewed.existing.revision + 1 })
				.where(
					and(
						eq(vacationAdjustment.id, reviewed.existing.id),
						eq(vacationAdjustment.revision, reviewed.existing.revision),
					),
				)
				.returning({ id: vacationAdjustment.id });
			if (!updated)
				throw new HistoricalVacationError(
					"stale",
					"This total changed. Review it again.",
				);
			adjustmentId = updated.id;
		} else {
			const [created] = await database
				.insert(vacationAdjustment)
				.values({
					...values,
					employeeId: input.employeeId,
					year: input.year,
					kind: "historical_usage",
					historicalCoverageStart: reviewed.coverageStart,
					historicalCoverageEnd: reviewed.coverageEnd,
					historicalTrackingStart: reviewed.tracking!.startDate,
					historicalTimezone: reviewed.tracking!.timezone,
					revision: 1,
				})
				.returning({ id: vacationAdjustment.id });
			adjustmentId = created.id;
		}
		await database.insert(auditLog).values({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			entityType: "vacation_adjustment",
			entityId: adjustmentId,
			performedBy: actorUserId,
			action: "vacation.historical_usage_reviewed",
			changes: JSON.stringify({
				before: reviewed.existing ? -Number(reviewed.existing.days) : 0,
				after: input.days,
				year: input.year,
				coverageStart: reviewed.coverageStart,
				coverageEnd: reviewed.coverageEnd,
				reason: input.reason,
				excludesListedDatedHistory: input.excludesListedDatedHistory,
				excludedDatedHistory: input.excludesListedDatedHistory
					? reviewed.historicalRecords
					: [],
				fingerprint,
			}),
			timestamp: currentTimestamp(),
		});
	}
	return {
		recordedDays: reviewed.existing ? -Number(reviewed.existing.days) : 0,
		lastReason: reviewed.existing?.reason ?? null,
		employeeId: input.employeeId,
		year: input.year,
		days: input.days,
		reason: input.reason,
		excludesListedDatedHistory: input.excludesListedDatedHistory,
		unresolvedHistoricalImportIds: reviewed.unresolvedHistoricalImportIds,
		coverageStart: reviewed.coverageStart,
		coverageEnd: reviewed.coverageEnd,
		trackingStart:
			reviewed.existing?.historicalTrackingStart ??
			reviewed.tracking?.startDate,
		before: reviewed.before,
		after: reviewed.after,
		blockers: reviewed.blockers,
		historicalRecords: reviewed.historicalRecords.map(
			({ updatedAt, ...row }) => row,
		),
		fingerprint: reviewed.fingerprint,
	};
}
export type HistoricalVacationReview = Awaited<
	ReturnType<typeof reviewPreviouslyTakenVacation>
>;
