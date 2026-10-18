import "server-only";
import { and, eq, gt, inArray, or, sql } from "drizzle-orm";
import type { db } from "@/db";
import {
	absenceChangeRequest,
	balanceAdjustment,
	completedWorkOperation,
	workPeriod,
} from "@/db/schema";
import {
	compareInstants,
	dateFromInstant,
	instantFromDate,
	parseInstant,
} from "@/lib/datetime/temporal-core";
import type { PayrollBaselineEvidence } from "./baseline-types";
import type { PayrollComparisonExplanation } from "./comparison-types";
import type {
	SupportedPayrollContribution,
	SupportedPayrollOutputEvidence,
} from "./supported-output-evidence";

type Reader = Pick<typeof db, "select">;
interface ExplanationRequest {
	organizationId: string;
	baseline: PayrollBaselineEvidence;
	baselineCompletedAt: string;
	current: SupportedPayrollOutputEvidence;
}

/** Explicit recorded source operations in the caller's authorized preview snapshot.
 * The timestamp limits history; it never proves that an operation caused a row delta.
 */
export async function readPayrollComparisonExplanations(
	reader: Reader,
	input: ExplanationRequest,
): Promise<PayrollComparisonExplanation[]> {
	const scope = [...new Set(input.baseline.employeeIds)];
	if (!scope.length) return [];
	const allowed = new Set(scope);
	const sources = [...input.baseline.output.rows, ...input.current.rows]
		.flatMap((row) => row.contributions)
		.filter((source) => allowed.has(source.employeeId));
	if (!sources.length) return [];
	const sourceIds = (kind: SupportedPayrollContribution["kind"]) => [
		...new Set(
			sources
				.filter((source) => source.kind === kind)
				.map((source) => source.sourceId),
		),
	];
	const cutoff = parseInstant(input.baselineCompletedAt);
	const cutoffDate = dateFromInstant(cutoff);
	const result: PayrollComparisonExplanation[] = [];
	const knownReason = (value: unknown) =>
		typeof value === "string" && value.trim().length ? value : null;
	const belongs = (
		kind: SupportedPayrollContribution["kind"],
		sourceId: string,
		employeeId: string,
	) =>
		sources.some(
			(source) =>
				source.kind === kind &&
				source.sourceId === sourceId &&
				source.employeeId === employeeId,
		);
	const workIds = sourceIds("work");
	if (workIds.length) {
		const periods = await reader
			.select({
				id: workPeriod.id,
				canonicalRecordId: workPeriod.canonicalRecordId,
				employeeId: workPeriod.employeeId,
				deletedAt: workPeriod.deletedAt,
				deletedBy: workPeriod.deletedBy,
				deletionReason: workPeriod.deletionReason,
			})
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.organizationId, input.organizationId),
					inArray(workPeriod.employeeId, scope),
					inArray(workPeriod.canonicalRecordId, workIds),
				),
			);
		for (const period of periods) {
			if (
				!period.canonicalRecordId ||
				!belongs("work", period.canonicalRecordId, period.employeeId)
			)
				continue;
			if (
				period.deletedAt &&
				compareInstants(instantFromDate(period.deletedAt), cutoff) > 0
			)
				result.push({
					kind: "work",
					sourceId: period.canonicalRecordId,
					employeeId: period.employeeId,
					action: "deleted",
					actorId: period.deletedBy,
					reason: knownReason(period.deletionReason),
				});
		}
		if (periods.length) {
			const operations = await reader
				.select({
					workPeriodId: completedWorkOperation.workPeriodId,
					employeeId: completedWorkOperation.employeeId,
					kind: completedWorkOperation.kind,
					actorId: completedWorkOperation.actorUserId,
					command: completedWorkOperation.command,
					commandVersion: completedWorkOperation.commandVersion,
				})
				.from(completedWorkOperation)
				.where(
					and(
						eq(completedWorkOperation.organizationId, input.organizationId),
						inArray(completedWorkOperation.employeeId, scope),
						inArray(
							completedWorkOperation.workPeriodId,
							periods.map((period) => period.id),
						),
						gt(completedWorkOperation.createdAt, cutoffDate),
					),
				);
			for (const operation of operations) {
				const period = periods.find(
					(period) =>
						period.id === operation.workPeriodId &&
						period.employeeId === operation.employeeId,
				);
				if (
					!period?.canonicalRecordId ||
					!belongs("work", period.canonicalRecordId, period.employeeId)
				)
					continue;
				// v1 explicit reason only. Notes and original source text are not change reasons.
				const reason =
					operation.commandVersion === 1
						? knownReason(operation.command.reason)
						: null;
				result.push({
					kind: "work",
					sourceId: period.canonicalRecordId,
					employeeId: operation.employeeId,
					action: operation.kind,
					actorId: operation.actorId,
					reason,
				});
			}
		}
	}
	const absenceIds = sourceIds("absence");
	if (absenceIds.length) {
		const changes = await reader
			.select({
				employeeId: absenceChangeRequest.employeeId,
				original: absenceChangeRequest.original,
				kind: absenceChangeRequest.kind,
				actorId: absenceChangeRequest.decidedBy,
				reason: absenceChangeRequest.reason,
			})
			.from(absenceChangeRequest)
			.where(
				and(
					eq(absenceChangeRequest.organizationId, input.organizationId),
					inArray(absenceChangeRequest.employeeId, scope),
					eq(absenceChangeRequest.status, "approved"),
					gt(absenceChangeRequest.decidedAt, cutoffDate),
					inArray(
						sql<string>`${absenceChangeRequest.original}->>'canonicalRecordId'`,
						absenceIds,
					),
				),
			);
		for (const change of changes) {
			const sourceId = change.original.canonicalRecordId;
			if (sourceId && belongs("absence", sourceId, change.employeeId))
				result.push({
					kind: "absence",
					sourceId,
					employeeId: change.employeeId,
					action:
						change.kind === "cancel"
							? "absence_cancel_approved"
							: "absence_change_approved",
					actorId: change.actorId,
					reason: knownReason(change.reason),
				});
		}
	}
	const payoutIds = sourceIds("overtime_payout");
	if (payoutIds.length) {
		const payouts = await reader
			.select({
				id: balanceAdjustment.id,
				employeeId: balanceAdjustment.employeeId,
				recordedAt: balanceAdjustment.recordedAt,
				recordedBy: balanceAdjustment.recordedBy,
				reason: balanceAdjustment.reason,
				cancelledAt: balanceAdjustment.cancelledAt,
				cancelledBy: balanceAdjustment.cancelledBy,
				cancellationReason: balanceAdjustment.cancellationReason,
			})
			.from(balanceAdjustment)
			.where(
				and(
					eq(balanceAdjustment.organizationId, input.organizationId),
					eq(balanceAdjustment.kind, "overtime_payout"),
					inArray(balanceAdjustment.employeeId, scope),
					inArray(balanceAdjustment.id, payoutIds),
					or(
						gt(balanceAdjustment.recordedAt, cutoffDate),
						gt(balanceAdjustment.cancelledAt, cutoffDate),
					),
				),
			);
		for (const payout of payouts) {
			if (!belongs("overtime_payout", payout.id, payout.employeeId)) continue;
			if (compareInstants(instantFromDate(payout.recordedAt), cutoff) > 0)
				result.push({
					kind: "overtime_payout",
					sourceId: payout.id,
					employeeId: payout.employeeId,
					action: "recorded",
					actorId: payout.recordedBy,
					reason: knownReason(payout.reason),
				});
			if (
				payout.cancelledAt &&
				compareInstants(instantFromDate(payout.cancelledAt), cutoff) > 0
			)
				result.push({
					kind: "overtime_payout",
					sourceId: payout.id,
					employeeId: payout.employeeId,
					action: "cancelled",
					actorId: payout.cancelledBy,
					reason: knownReason(payout.cancellationReason),
				});
		}
	}
	return result.sort((left, right) =>
		JSON.stringify(left).localeCompare(JSON.stringify(right)),
	);
}
