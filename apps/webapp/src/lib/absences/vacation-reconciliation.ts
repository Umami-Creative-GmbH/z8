import { vacationConfigurationProblem } from "./types";
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import type { db } from "@/db";
import { member, organization, user } from "@/db/auth-schema";
import {
	absenceCategory,
	absenceEntry,
	auditLog,
	employee,
	employeeManagers,
	importBatch,
	importStagedRow,
	vacationAdjustment,
	vacationReconciliation,
} from "@/db/schema";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { monthClosedRefusalOf } from "@/lib/time-tracking/closed-months/refusal";
import { assertAbsenceDaysOpen } from "@/lib/time-tracking/closed-months/store";
import { loadEmployeeTrackingContext } from "@/lib/time-tracking/tracking-start";
import { acquireExclusiveOrganizationConfigurationGuard } from "@/lib/time-tracking/work-transaction";
import {
	type AbsenceDayRange,
	clipAbsenceDayRange,
	mondayToFriday,
} from "./absence-days";
import {
	type AbsenceDaysDatabase,
	loadWorkingDaysForEmployees,
} from "./absence-days-resolver";
import {
	coverageDays,
	loadCanonicalCoverage,
	resolveProposedCoverage,
} from "./change-request-proposal";
import { originalAbsence } from "./change-request-records";
import {
	normalizeAbsenceDurationInput,
	toAbsenceEntryDurationFields,
} from "./duration";
import { HistoricalVacationError } from "./historical-vacation";
import { getBlockingOverlapMessage } from "./sick-vacation-override";
import type { AbsenceWithCategory, VacationBalance } from "./types";
import { loadVacationBalances } from "./vacation-balance-store";
import {
	reconciledAbsenceKey,
	withinReconciledAbsences,
} from "./vacation-reconciliation-authorization";
import {
	type ReconciliationInput,
	type ReconciliationProof,
	reconciledAbsenceSchema,
	reconciliationInputSchema,
	reconciliationProofSchema,
} from "./vacation-reconciliation-types";

type Client = AbsenceDaysDatabase;
export type PlannedReconciledAbsence = {
	absence: AbsenceWithCategory;
	category: typeof absenceCategory.$inferSelect;
	authorizationRange?: { startDate: string; endDate: string };
	existingAbsenceId?: string;
	sourceRowId?: string;
	original?: typeof absenceEntry.$inferSelect;
};
const invalid = (message: string) =>
	new HistoricalVacationError("invalid", message);
const key = (employeeId: string, year: number) => `${employeeId}:${year}`;
const digest = (value: unknown) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Morning and afternoon coverage on one day, preserving the shared clipping rules. */
function dayHalves(range: AbsenceDayRange, date: string) {
	const clipped = clipAbsenceDayRange(range, {
		startDate: date,
		endDate: date,
	});
	if (!clipped) return 0;
	if (clipped.startPeriod === "am" && clipped.endPeriod === "am") return 1;
	if (clipped.startPeriod === "pm" && clipped.endPeriod === "pm") return 2;
	return 3;
}
async function actorInOrganization(
	database: Client,
	organizationId: string,
	userId: string,
) {
	const [actorRow] = await database
		.select({ actor: employee, banned: user.banned })
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				eq(employee.organizationId, organizationId),
				eq(employee.userId, userId),
				eq(employee.isActive, true),
			),
		)
		.limit(1)
		.for("share", { of: user });
	const [membership] = await database
		.select()
		.from(member)
		.where(
			and(
				eq(member.organizationId, organizationId),
				eq(member.userId, userId),
				eq(member.status, "approved"),
			),
		)
		.limit(1);
	const actor = actorRow?.actor;
	if (!actor || !membership || actorRow.banned === true)
		throw new HistoricalVacationError(
			"forbidden",
			"Active approved organization access is required.",
		);
	return { actor, membership };
}
async function assertRecordingAuthority(
	database: Client,
	access: Awaited<ReturnType<typeof actorInOrganization>>,
	organizationId: string,
	employeeId: string,
) {
	const [target] = await database
		.select()
		.from(employee)
		.where(
			and(
				eq(employee.id, employeeId),
				eq(employee.organizationId, organizationId),
				eq(employee.isActive, true),
			),
		)
		.limit(1);
	if (!target) throw invalid("Employee not found or not accessible.");
	const [manager] = await database
		.select({ id: employeeManagers.id })
		.from(employeeManagers)
		.where(
			and(
				eq(employeeManagers.employeeId, target.id),
				eq(employeeManagers.managerId, access.actor.id),
			),
		)
		.limit(1);
	if (
		access.actor.role !== "admin" &&
		!(access.actor.role === "manager" && manager)
	)
		throw new HistoricalVacationError(
			"forbidden",
			"Historical vacation reconciliation requires the existing administrator or assigned manager recording permission.",
		);
	return target;
}
async function prepareSource(
	database: Client,
	organizationId: string,
	actorUserId: string,
	input: ReconciliationInput,
	operationId: string,
	approval = false,
) {
	const access = await actorInOrganization(
		database,
		organizationId,
		actorUserId,
	);
	const candidates: PlannedReconciledAbsence[] = [];

	const sourceEvidence: unknown[] = [];
	const importRows: {
		row: typeof importStagedRow.$inferSelect;
		categoryId: string;
		startPeriod: "full_day" | "am" | "pm";
		endPeriod: "full_day" | "am" | "pm";
		replayTargetId?: string;
	}[] = [];
	if (input.kind === "import") {
		if (
			!(
				hasOrganizationRole(access.membership.role, "owner") ||
				hasOrganizationRole(access.membership.role, "admin")
			)
		)
			throw new HistoricalVacationError(
				"forbidden",
				"Only organization administrators may reconcile imports.",
			);
		const [batch] = await database
			.select()
			.from(importBatch)
			.where(
				and(
					eq(importBatch.id, input.batchId),
					eq(importBatch.organizationId, organizationId),
				),
			);
		if (
			!batch ||
			batch.provider === "accounting" ||
			!["needs_review", "committing", "commit_failed", "completed"].includes(
				batch.status,
			)
		)
			throw invalid("This absence import is not available for review.");
		sourceEvidence.push({ batchId: batch.id, provider: batch.provider });
		const seen = new Set<string>();
		const sourceIds = new Set<string>();
		for (const mapping of input.mappings) {
			if (seen.has(mapping.rowId))
				throw invalid("Review every imported row once.");
			seen.add(mapping.rowId);
			const [row] = await database
				.select()
				.from(importStagedRow)
				.where(
					and(
						eq(importStagedRow.id, mapping.rowId),
						eq(importStagedRow.batchId, batch.id),
						eq(importStagedRow.organizationId, organizationId),
						eq(importStagedRow.entityType, "absence"),
					),
				);
			if (
				!row ||
				!["accepted", "blocked", "commit_failed"].includes(row.rowStatus) ||
				row.commitHold
			)
				throw invalid(
					"Only accepted absences or previously refused historical absences can be reconciled.",
				);
			if (
				row.rowStatus !== "accepted" &&
				!row.commitError?.toLowerCase().includes("historical")
			)
				throw invalid(
					"Resolve the import row's existing validation error before reconciliation.",
				);
			if (sourceIds.has(row.providerSourceId))
				throw invalid(
					"The same provider absence appears twice. Resolve its duplicate before reconciliation.",
				);
			sourceIds.add(row.providerSourceId);
			const payload = row.normalizedPayload;
			if (
				typeof payload.employeeId !== "string" ||
				typeof payload.startsAt !== "string" ||
				typeof payload.endsAt !== "string"
			)
				throw invalid(
					"The imported absence needs a mapped employee and valid dates.",
				);
			// Provider absence dates are calendar labels. Preserve that label independently of the viewer's zone.
			const startDate = Temporal.PlainDate.from(
					payload.startsAt.slice(0, 10),
				).toString(),
				endDate = Temporal.PlainDate.from(
					payload.endsAt.slice(0, 10),
				).toString();
			const [target] = await database
				.select()
				.from(employee)
				.where(
					and(
						eq(employee.id, payload.employeeId),
						eq(employee.organizationId, organizationId),
						eq(employee.isActive, true),
					),
				);
			const [category] = await database
				.select()
				.from(absenceCategory)
				.where(
					and(
						eq(absenceCategory.id, mapping.categoryId),
						eq(absenceCategory.organizationId, organizationId),
						eq(absenceCategory.isActive, true),
					),
				);
			if (!target || !category)
				throw invalid(
					"Choose an active employee and category in this organization.",
				);
			const prior = await database
				.select({ row: importStagedRow, absence: absenceEntry })
				.from(importStagedRow)
				.innerJoin(
					importBatch,
					and(
						eq(importBatch.id, importStagedRow.batchId),
						eq(importBatch.provider, batch.provider),
					),
				)
				.innerJoin(
					absenceEntry,
					eq(sql`${absenceEntry.id}::text`, importStagedRow.commitTargetId),
				)
				.where(
					and(
						eq(importStagedRow.organizationId, organizationId),
						eq(importStagedRow.entityType, "absence"),
						eq(importStagedRow.providerSourceId, row.providerSourceId),
						eq(importStagedRow.rowStatus, "committed"),
						eq(absenceEntry.organizationId, organizationId),
					),
				);
			if (new Set(prior.map((value) => value.absence.id)).size > 1)
				throw invalid(
					"The provider source already has multiple dated records. Resolve its existing duplicates before reconciliation.",
				);
			const old = prior[0];
			if (
				old &&
				(old.row.sourcePayloadHash !== row.sourcePayloadHash ||
					old.absence.employeeId !== target.id ||
					old.absence.categoryId !== category.id ||
					old.absence.startDate !== startDate ||
					old.absence.endDate !== endDate ||
					old.absence.startPeriod !== mapping.startPeriod ||
					old.absence.endPeriod !== mapping.endPeriod)
			)
				throw invalid(
					"This provider source was already imported with different content or mapping. Correct its existing history instead.",
				);
			importRows.push({
				row,
				...mapping,
				...(old ? { replayTargetId: old.absence.id } : {}),
			});
			sourceEvidence.push({
				row,
				target,
				category,
				prior,
				tracking: await loadEmployeeTrackingContext(database, {
					organizationId,
					employeeId: target.id,
				}),
			});
			if (!old)
				candidates.push({
					sourceRowId: row.id,
					category,
					absence: {
						id: `review:${row.id}`,
						employeeId: target.id,
						startDate,
						endDate,
						startPeriod: mapping.startPeriod,
						endPeriod: mapping.endPeriod,
						status: "approved",
						notes: typeof payload.note === "string" ? payload.note : null,
						sickDetail: null,
						category,
						approvedBy: null,
						approvedAt: null,
						rejectionReason: null,
						createdAt: new Date(0),
					},
				});
		}
	} else if (input.kind === "manual") {
		const target = await assertRecordingAuthority(
			database,
			access,
			organizationId,
			input.absence.employeeId,
		);
		const [category] = await database
			.select()
			.from(absenceCategory)
			.where(
				and(
					eq(absenceCategory.id, input.absence.categoryId),
					eq(absenceCategory.organizationId, organizationId),
					eq(absenceCategory.isActive, true),
				),
			)
			.limit(1);
		if (!category)
			throw invalid(
				"Choose an active absence category from this organization.",
			);
		const range = normalizeAbsenceDurationInput(input.absence);
		const entryRange = toAbsenceEntryDurationFields(range);
		candidates.push({
			authorizationRange: range,
			category,
			absence: {
				id: `review:${operationId}`,
				employeeId: target.id,
				...entryRange,
				status: "approved",
				notes: input.absence.notes ?? null,
				sickDetail: input.absence.sickDetail ?? null,
				category,
				approvedBy: null,
				approvedAt: null,
				rejectionReason: null,
				createdAt: new Date(0),
			},
		});
		sourceEvidence.push({
			target,
			category,
			tracking: await loadEmployeeTrackingContext(database, {
				organizationId,
				employeeId: target.id,
			}),
		});
	} else {
		const [original] = await database
			.select()
			.from(absenceEntry)
			.where(
				and(
					eq(absenceEntry.id, input.absenceId),
					eq(absenceEntry.organizationId, organizationId),
					eq(absenceEntry.employeeId, access.actor.id),
					eq(absenceEntry.status, "approved"),
				),
			);
		if (!original)
			throw new HistoricalVacationError(
				"forbidden",
				"Only your own approved absence can receive this date change review.",
			);
		const [category] = await database
			.select()
			.from(absenceCategory)
			.where(
				and(
					eq(absenceCategory.id, original.categoryId),
					eq(absenceCategory.organizationId, organizationId),
					eq(absenceCategory.isActive, true),
				),
			);
		if (!category)
			throw invalid("The absence category is no longer available.");
		const canonical = await loadCanonicalCoverage(database as typeof db, {
			organizationId,
			employeeId: original.employeeId,
			canonicalRecordId: original.canonicalRecordId,
		});
		const proposed = resolveProposedCoverage(
			originalAbsence(original, canonical),
			input.proposed,
			input.coverage,
		);
		candidates.push({
			category,
			original,
			existingAbsenceId: original.id,
			authorizationRange: coverageDays(proposed),
			absence: { ...original, ...proposed, category },
		});
		sourceEvidence.push({
			original,
			canonical,
			category,
			tracking: await loadEmployeeTrackingContext(database, {
				organizationId,
				employeeId: original.employeeId,
			}),
		});
	}
	return {
		access,
		candidates,
		importRows,
		sourceState: { input, evidence: sourceEvidence },
	};
}
async function reviewPlan(
	database: Client,
	organizationId: string,
	actorUserId: string,
	input: ReconciliationInput,
	operationId: string,
	approval = false,
) {
	const source = await prepareSource(
		database,
		organizationId,
		actorUserId,
		input,
		operationId,
		approval,
	);
	const blockers: string[] = [];
	for (const { absence } of source.candidates) {
		const start = Temporal.PlainDate.from(absence.startDate),
			end = Temporal.PlainDate.from(absence.endDate);
		if (
			Temporal.PlainDate.compare(start, end) > 0 ||
			end.year - start.year > 5 ||
			(start.equals(end) &&
				absence.startPeriod === "pm" &&
				absence.endPeriod === "am")
		)
			throw invalid(
				"Choose valid ordered dates and full-day or half-day coverage.",
			);
	}
	const employeeIds = [
		...new Set(source.candidates.map((row) => row.absence.employeeId)),
	];
	const names = employeeIds.length
		? await database
				.select({ id: employee.id, name: user.name })
				.from(employee)
				.innerJoin(user, eq(user.id, employee.userId))
				.where(
					and(
						eq(employee.organizationId, organizationId),
						inArray(employee.id, employeeIds),
					),
				)
		: [];
	const employeeNames = new Map(names.map((value) => [value.id, value.name]));
	const totals = employeeIds.length
		? await database
				.select({ adjustment: vacationAdjustment })
				.from(vacationAdjustment)
				.innerJoin(employee, eq(employee.id, vacationAdjustment.employeeId))
				.where(
					and(
						eq(employee.organizationId, organizationId),
						inArray(vacationAdjustment.employeeId, employeeIds),
						eq(vacationAdjustment.kind, "historical_usage"),
					),
				)
				.orderBy(asc(vacationAdjustment.id))
		: [];
	const relevant = totals
		.map((row) => row.adjustment)
		.filter((total) =>
			source.candidates.some(
				({ absence, category }) =>
					category.countsAgainstVacation &&
					absence.employeeId === total.employeeId &&
					absence.startDate <= total.historicalCoverageEnd! &&
					absence.endDate >= total.historicalCoverageStart!,
			),
		);
	const decisions = new Map<string, number>();
	for (const decision of input.decisions) {
		const k = key(decision.employeeId, decision.year);
		if (decisions.has(k)) throw invalid("Review each employee and year once.");
		decisions.set(k, decision.remainingDays);
	}
	for (const decision of input.decisions)
		if (
			!relevant.some(
				(total) =>
					total.employeeId === decision.employeeId &&
					total.year === decision.year,
			)
		)
			throw invalid(
				"A reconciliation decision does not match the proposed historical vacation.",
			);
	const totalReviews = [];
	for (const total of relevant) {
		let datedDays = 0;
		const working = await loadWorkingDaysForEmployees(database, {
			organizationId,
			employeeIds: [total.employeeId],
			startDate: total.historicalCoverageStart!,
			endDate: total.historicalCoverageEnd!,
		});
		const isWorking = working.get(total.employeeId) ?? mondayToFriday;
		for (const candidate of source.candidates) {
			if (
				!candidate.category.countsAgainstVacation ||
				candidate.absence.employeeId !== total.employeeId
			)
				continue;
			const clipped = clipAbsenceDayRange(candidate.absence, {
				startDate: total.historicalCoverageStart!,
				endDate: total.historicalCoverageEnd!,
			});
			if (!clipped) continue;
			// Existing dated halves were already accounted for. Moving dates introduces
			// the newly covered halves, even when the old and new ranges have equal length.
			for (
				let day = Temporal.PlainDate.from(clipped.startDate);
				day.toString() <= clipped.endDate;
				day = day.add({ days: 1 })
			) {
				if (!isWorking(day)) continue;
				const date = day.toString();
				const uncovered =
					dayHalves(clipped, date) &
					~(candidate.original ? dayHalves(candidate.original, date) : 0);
				datedDays += uncovered === 3 ? 1 : uncovered ? 0.5 : 0;
			}
		}

		const currentDays = -Number(total.days),
			remainingDays = decisions.get(key(total.employeeId, total.year));
		if (remainingDays === undefined)
			blockers.push(
				"Choose the explicitly reviewed remaining total for every affected employee and year.",
			);
		else if (
			remainingDays > currentDays ||
			currentDays - remainingDays > datedDays + 0.00001
		)
			blockers.push(
				"The reduction cannot exceed either the recorded total or the newly dated historical vacation days.",
			);
		try {
			await assertAbsenceDaysOpen(database, {
				organizationId,
				employeeId: total.employeeId,
				days: [
					{
						startDate: total.historicalCoverageStart!,
						endDate: total.historicalCoverageEnd!,
					},
				],
			});
		} catch (error) {
			const closed = monthClosedRefusalOf(error);
			if (!closed) throw error;
			blockers.push(closed.message);
		}
		totalReviews.push({
			id: total.id,
			employeeName: employeeNames.get(total.employeeId) ?? total.employeeId,
			employeeId: total.employeeId,
			year: total.year,
			currentDays,
			remainingDays,
			datedDays,
			coverageStart: total.historicalCoverageStart!,
			coverageEnd: total.historicalCoverageEnd!,
			revision: total.revision,
		});
	}
	const [org] = await database
		.select({ timezone: organization.timezone })
		.from(organization)
		.where(eq(organization.id, organizationId));
	const balances: {
		employeeId: string;
		employeeName: string;
		year: number;
		before: VacationBalance | null;
		after: VacationBalance | null;
	}[] = [];
	const evidence: unknown[] = [];
	for (const candidate of source.candidates) {
		const start = Temporal.PlainDate.from(candidate.absence.startDate),
			end = Temporal.PlainDate.from(candidate.absence.endDate);
		if (Temporal.PlainDate.compare(start, end) > 0 || end.year - start.year > 5)
			throw invalid(
				"Choose an ordered absence range of at most six calendar years.",
			);
		try {
			await assertAbsenceDaysOpen(database, {
				organizationId,
				employeeId: candidate.absence.employeeId,
				days: [
					candidate.absence,
					...(candidate.original ? [candidate.original] : []),
				],
			});
		} catch (error) {
			const closed = monthClosedRefusalOf(error);
			if (!closed) throw error;
			blockers.push(closed.message);
		}
		const existing = await database.query.absenceEntry.findMany({
			where: and(
				eq(absenceEntry.employeeId, candidate.absence.employeeId),
				or(
					isNull(absenceEntry.organizationId),
					eq(absenceEntry.organizationId, organizationId),
				),
				or(
					eq(absenceEntry.status, "approved"),
					eq(absenceEntry.status, "pending"),
				),
			),
			with: { category: true },
			orderBy: [asc(absenceEntry.id)],
		});
		evidence.push(existing);
		for (const other of [
			...existing,
			...source.candidates
				.filter((row) => row !== candidate)
				.map((row) => ({ ...row.absence, category: row.category })),
		]) {
			if (
				other.id === candidate.existingAbsenceId ||
				other.id === candidate.absence.id ||
				other.employeeId !== candidate.absence.employeeId ||
				other.startDate > candidate.absence.endDate ||
				other.endDate < candidate.absence.startDate
			)
				continue;
			const conflict = getBlockingOverlapMessage({
				newCategoryType: candidate.category.type,
				newStartPeriod: candidate.absence.startPeriod,
				newEndPeriod: candidate.absence.endPeriod,
				existingStartPeriod: other.startPeriod,
				existingEndPeriod: other.endPeriod,
				existingStatus: other.status,
				existingCountsAgainstVacation: other.category.countsAgainstVacation,
			});
			if (conflict) blockers.push(conflict);
		}
		for (let year = start.year; year <= end.year; year++) {
			if (
				balances.some(
					(row) =>
						row.employeeId === candidate.absence.employeeId &&
						row.year === year,
				)
			)
				continue;
			const scope = {
				organizationId,
				employeeIds: [candidate.absence.employeeId],
				year,
				timezone: org?.timezone ?? "UTC",
			};
			const beforeResult = await loadVacationBalances(database, scope);
			const remaining = decisions.get(key(candidate.absence.employeeId, year));
			const afterResult = await loadVacationBalances(database, {
				...scope,
				absenceChanges: source.candidates
					.filter(
						(row) => row.absence.employeeId === candidate.absence.employeeId,
					)
					.map((row) => ({
						existingAbsenceId: row.existingAbsenceId,
						absence: row.absence,
					})),
				...(remaining !== undefined
					? {
							previouslyTakenOverride: {
								employeeId: candidate.absence.employeeId,
								days: remaining,
							},
						}
					: {}),
			});
			const before = beforeResult.balances.get(candidate.absence.employeeId),
				after = afterResult.balances.get(candidate.absence.employeeId);
			if (!before || !after)
				blockers.push(
					vacationConfigurationProblem(
						beforeResult.configurations.get(candidate.absence.employeeId),
					),
				);
			balances.push({
				employeeId: candidate.absence.employeeId,
				employeeName:
					employeeNames.get(candidate.absence.employeeId) ??
					candidate.absence.employeeId,
				year,
				before: before ?? null,
				after: after ?? null,
			});
			const working = await loadWorkingDaysForEmployees(database, {
				...scope,
				startDate: `${year}-01-01`,
				endDate: `${year}-12-31`,
			});
			const workingDays = [];
			for (
				let day = Temporal.PlainDate.from(`${year}-01-01`);
				day.year === year;
				day = day.add({ days: 1 })
			)
				if (working.get(candidate.absence.employeeId)?.(day))
					workingDays.push(day.toString());
			evidence.push({ policy: beforeResult.policy, workingDays });
		}
	}
	const fingerprint = digest({
		organizationId,
		input,
		source: source.sourceState,
		totals: relevant,
		evidence,
		balances,
		blockers,
	});
	return {
		...source,
		totals: totalReviews,
		balances,
		blockers: [...new Set(blockers)],
		fingerprint,
	};
}
export async function previewVacationReconciliation(
	database: Client,
	organizationId: string,
	actorUserId: string,
	untrusted: unknown,
) {
	const input = reconciliationInputSchema.parse(untrusted),
		operationId = randomUUID();
	await acquireExclusiveOrganizationConfigurationGuard(
		database,
		organizationId,
	);
	const review = await reviewPlan(
		database,
		organizationId,
		actorUserId,
		input,
		operationId,
	);
	await database.insert(vacationReconciliation).values({
		id: operationId,
		organizationId,
		plan: input,
		fingerprint: review.fingerprint,
		reviewedBy: actorUserId,
	});
	return {
		operationId,
		fingerprint: review.fingerprint,
		kind: input.kind,
		totals: review.totals,
		balances: review.balances,
		blockers: review.blockers,
		absences: review.candidates.map(({ absence }) => ({
			id: absence.id,
			employeeId: absence.employeeId,
			employeeName:
				review.balances.find(
					(balance) => balance.employeeId === absence.employeeId,
				)?.employeeName ?? absence.employeeId,
			categoryName: absence.category.name,
			categoryId: absence.category.id,
			startDate: absence.startDate,
			endDate: absence.endDate,
			startPeriod: absence.startPeriod,
			endPeriod: absence.endPeriod,
		})),
	};
}
export type VacationReconciliationReview = Awaited<
	ReturnType<typeof previewVacationReconciliation>
>;

type ReviewContext = {
	organizationId: string;
	actorUserId: string;
	proof: ReconciliationProof;
	expectedManual?: unknown;
	expectedImportBatchId?: string;
	expectedChange?: {
		absenceId: string;
		proposed: {
			startDate: string;
			endDate: string;
			startPeriod: string;
			endPeriod: string;
		};
	};
	approval?: boolean;
};
async function loadReviewedOperation(database: Client, context: ReviewContext) {
	const proof = reconciliationProofSchema.parse(context.proof);
	await acquireExclusiveOrganizationConfigurationGuard(
		database,
		context.organizationId,
	);
	const [operation] = await database
		.select()
		.from(vacationReconciliation)
		.where(
			and(
				eq(vacationReconciliation.id, proof.operationId),
				eq(vacationReconciliation.organizationId, context.organizationId),
			),
		)
		.for("update");
	if (!operation || operation.fingerprint !== proof.fingerprint)
		throw invalid(
			"Historical vacation review not found. Review the proposed records again.",
		);
	const input = reconciliationInputSchema.parse(operation.plan);
	if (
		(input.kind !== "change" || !context.approval) &&
		operation.reviewedBy !== context.actorUserId
	)
		throw new HistoricalVacationError(
			"forbidden",
			"The reviewer must submit their own historical vacation review.",
		);
	if (
		context.expectedImportBatchId &&
		(input.kind !== "import" || input.batchId !== context.expectedImportBatchId)
	)
		throw invalid("The reviewed import does not match this job.");
	if (
		context.expectedManual &&
		(input.kind !== "manual" ||
			digest(reconciledAbsenceSchema.parse(context.expectedManual)) !==
				digest(input.absence))
	)
		throw new HistoricalVacationError(
			"stale",
			"The proposed absence changed. Review it again.",
		);
	if (
		context.expectedChange &&
		(input.kind !== "change" ||
			input.absenceId !== context.expectedChange.absenceId)
	)
		throw new HistoricalVacationError(
			"stale",
			"The reviewed absence changed. Review it again.",
		);
	const committingAccess = await actorInOrganization(
		database,
		context.organizationId,
		context.actorUserId,
	);
	if (input.kind === "manual")
		await assertRecordingAuthority(
			database,
			committingAccess,
			context.organizationId,
			input.absence.employeeId,
		);
	if (
		input.kind === "import" &&
		!(
			hasOrganizationRole(committingAccess.membership.role, "owner") ||
			hasOrganizationRole(committingAccess.membership.role, "admin")
		)
	)
		throw new HistoricalVacationError(
			"forbidden",
			"Only organization administrators may commit reconciled imports.",
		);
	if (input.kind === "change" && context.approval) {
		const [changed] = await database
			.select({ employeeId: absenceEntry.employeeId })
			.from(absenceEntry)
			.where(
				and(
					eq(absenceEntry.id, input.absenceId),
					eq(absenceEntry.organizationId, context.organizationId),
				),
			);
		if (!changed) throw invalid("Absence not found.");
		await assertRecordingAuthority(
			database,
			committingAccess,
			context.organizationId,
			changed.employeeId,
		);
	}

	if (operation.status === "committed")
		return { operation, input, review: null, committingAccess };
	const review = await reviewPlan(
		database,
		context.organizationId,
		operation.reviewedBy,
		input,
		operation.id,
		context.approval,
	);
	if (context.expectedChange) {
		const proposed = review.candidates[0]?.absence;
		if (
			!proposed ||
			["startDate", "endDate", "startPeriod", "endPeriod"].some(
				(field) =>
					proposed[field as keyof typeof proposed] !==
					context.expectedChange!.proposed[
						field as keyof typeof context.expectedChange.proposed
					],
			)
		)
			throw new HistoricalVacationError(
				"stale",
				"The proposed dates changed. Review them again.",
			);
	}
	if (review.fingerprint !== operation.fingerprint)
		throw new HistoricalVacationError(
			"stale",
			"The reviewed totals, dates, mapping or policy changed. Review the operation again.",
		);
	if (review.blockers.length) throw invalid(review.blockers.join(" "));
	return { operation, input, review, committingAccess };
}
function authorizedKeys(
	organizationId: string,
	review: Awaited<ReturnType<typeof reviewPlan>>,
) {
	return review.candidates.flatMap((row) => [
		reconciledAbsenceKey({
			organizationId,
			categoryId: row.category.id,
			...row.absence,
		}),
		...(row.authorizationRange
			? [
					reconciledAbsenceKey({
						organizationId,
						categoryId: row.category.id,
						employeeId: row.absence.employeeId,
						...row.authorizationRange,
					}),
				]
			: []),
	]);
}
/** Revalidates a proof without applying it, for queue admission and change-request submission/preflight. */
export async function withReviewedVacationReconciliation<T>(
	database: Client,
	context: ReviewContext,
	read: (
		review: NonNullable<
			Awaited<ReturnType<typeof loadReviewedOperation>>["review"]
		>,
	) => Promise<T>,
) {
	const { review } = await loadReviewedOperation(database, context);
	if (!review)
		throw new HistoricalVacationError(
			"stale",
			"This review was already applied. Refresh the absence history.",
		);
	return withinReconciledAbsences(
		database,
		authorizedKeys(context.organizationId, review),
		() => read(review),
	);
}
export async function withVacationReconciliation<
	T extends Record<string, unknown>,
>(
	database: Client,
	context: ReviewContext,
	write: (review: Awaited<ReturnType<typeof reviewPlan>>) => Promise<T>,
): Promise<T> {
	const { operation, input, review, committingAccess } =
		await loadReviewedOperation(database, context);
	if (!review) return operation.result as T;
	for (const total of review.totals) {
		const [updated] = await database
			.update(vacationAdjustment)
			.set({
				days: (-total.remainingDays!).toFixed(2),
				reason: input.reason,
				adjustedBy: committingAccess.actor.id,
				revision: total.revision + 1,
				updatedAt: currentTimestamp(),
			})
			.where(
				and(
					eq(vacationAdjustment.id, total.id),
					eq(vacationAdjustment.revision, total.revision),
				),
			)
			.returning({ id: vacationAdjustment.id });
		if (!updated)
			throw new HistoricalVacationError(
				"stale",
				"A historical total changed. Review it again.",
			);
	}
	const result = await withinReconciledAbsences(
		database,
		authorizedKeys(context.organizationId, review),
		() => write(review),
	);
	if (result.success === false)
		throw invalid(
			typeof result.error === "string"
				? result.error
				: "The absence was refused. No reconciliation was applied.",
		);
	const receipt = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
	await database
		.update(vacationReconciliation)
		.set({
			status: "committed",
			result: receipt,
			committedAt: currentTimestamp(),
		})
		.where(eq(vacationReconciliation.id, operation.id));
	await database.insert(auditLog).values({
		organizationId: context.organizationId,
		entityType: "vacation_reconciliation",
		entityId: operation.id,
		performedBy: context.actorUserId,
		action: "vacation.historical_usage_reconciled",
		changes: JSON.stringify({
			totals: review.totals,
			absences: review.candidates.map((row) => ({
				sourceRowId: row.sourceRowId,
				existingAbsenceId: row.existingAbsenceId,
				...row.absence,
			})),
			result: receipt,
			reason: input.reason,
			reviewedBy: operation.reviewedBy,
		}),
		timestamp: currentTimestamp(),
	});
	return result;
}
