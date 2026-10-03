/**
 * Evidence matchers for ordinary work-period submissions that committed before
 * receipts existed: a manual entry, or a live clock-out with its historical
 * policy clock-out approval. They only read; any mismatch is a collision.
 */
import { and, eq } from "drizzle-orm";
import type { db } from "@/db";
import {
	approvalRequest,
	type timeEntry,
	timeRecord,
	timeRecordAllocation,
	timeRecordWork,
	workPeriod,
} from "@/db/schema";
import type { WorkPeriodPostCommitDescriptor } from "@/lib/approvals/server/work-period-submission";
import { deriveApprovalWorkflowId } from "@/lib/approvals/workflow/identity";
import { CompletedWorkCollisionError } from "./close-active-work";

export const CANONICAL_UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type OrdinarySourceEvidence = Awaited<ReturnType<typeof db.query.workPeriod.findFirst>> & {
	clockIn?: typeof timeEntry.$inferSelect | null;
	clockOut?: typeof timeEntry.$inferSelect | null;
};

export function requireCanonicalSubmissionId(value: unknown): string {
	if (typeof value !== "string" || !CANONICAL_UUID.test(value)) {
		throw new Error("Invalid submission id");
	}
	return value;
}

export function sameInstant(left: Date | null | undefined, right: Date): boolean {
	return left instanceof Date && left.getTime() === right.getTime();
}

export function exactPlainObject(value: unknown, expectedKeys: readonly string[]) {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Object.prototype
	) {
		throw new Error("Submission collision");
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const keys = Reflect.ownKeys(descriptors);
	const expectedKeySet = new Set(expectedKeys);
	if (
		keys.length !== expectedKeys.length ||
		keys.some((key) => typeof key !== "string" || !expectedKeySet.has(key))
	) {
		throw new Error("Submission collision");
	}
	const result: Record<string, unknown> = {};
	for (const key of expectedKeys) {
		const descriptor = descriptors[key];
		if (!descriptor?.enumerable || !("value" in descriptor)) {
			throw new Error("Submission collision");
		}
		result[key] = descriptor.value;
	}
	return result;
}

export function privateSubmissionMarker(value: unknown) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const descriptor = Object.getOwnPropertyDescriptor(value, "ordinarySubmission");
	if (!descriptor) return null;
	if (!descriptor.enumerable || !("value" in descriptor)) {
		throw new Error("Submission collision");
	}
	const marker = descriptor.value;
	if (
		!marker ||
		typeof marker !== "object" ||
		Array.isArray(marker) ||
		Object.getPrototypeOf(marker) !== Object.prototype
	) {
		throw new Error("Submission collision");
	}
	const descriptors = Object.getOwnPropertyDescriptors(marker);
	const keys = Reflect.ownKeys(descriptors);
	if (
		keys.length !== 2 ||
		keys.some((key) => typeof key !== "string" || (key !== "submissionId" && key !== "kind"))
	) {
		throw new Error("Submission collision");
	}
	for (const key of ["submissionId", "kind"] as const) {
		const property = descriptors[key];
		if (!property?.enumerable || !("value" in property)) {
			throw new Error("Submission collision");
		}
	}
	return {
		submissionId: descriptors.submissionId.value,
		kind: descriptors.kind.value,
	};
}

export function hasPrivateApprovalSubmissionEvidence(input: {
	metadata: unknown;
	expectedKey: string;
	submissionId: string;
	expectedKind: "manual_time_submission" | "policy_clock_out";
}): boolean {
	if (!input.metadata || typeof input.metadata !== "object" || Array.isArray(input.metadata)) {
		return false;
	}
	const metadataKeys = Reflect.ownKeys(Object.getOwnPropertyDescriptors(input.metadata));
	const hasAutoApproval = metadataKeys.includes("autoApproval");
	const hasBreakPolicySnapshot = metadataKeys.includes("breakPolicySnapshot");
	const hasSurchargeSnapshot = metadataKeys.includes("surchargeSnapshot");
	if (
		!hasSurchargeSnapshot ||
		hasBreakPolicySnapshot !== (input.expectedKind === "policy_clock_out")
	) {
		throw new Error("Submission collision");
	}
	const root = exactPlainObject(
		input.metadata,
		hasAutoApproval
			? [
					"timeRequest",
					...(hasBreakPolicySnapshot ? ["breakPolicySnapshot"] : []),
					"surchargeSnapshot",
					"ordinarySubmission",
					"autoApproval",
				]
			: [
					"timeRequest",
					...(hasBreakPolicySnapshot ? ["breakPolicySnapshot"] : []),
					"surchargeSnapshot",
					"ordinarySubmission",
				],
	);
	const timeRequest = exactPlainObject(root.timeRequest, ["kind"]);
	if (timeRequest.kind !== input.expectedKind) {
		throw new Error("Submission collision");
	}
	if (hasAutoApproval) {
		const autoApproval = exactPlainObject(root.autoApproval, ["reason"]);
		if (autoApproval.reason !== "requester_is_approver") {
			throw new Error("Submission collision");
		}
	}
	const markerDescriptor = Object.getOwnPropertyDescriptor(root, "ordinarySubmission");
	if (!markerDescriptor) return false;
	if (!markerDescriptor.enumerable || !("value" in markerDescriptor)) {
		throw new Error("Submission collision");
	}
	const marker = markerDescriptor.value;
	if (
		!marker ||
		typeof marker !== "object" ||
		Array.isArray(marker) ||
		Object.getPrototypeOf(marker) !== Object.prototype
	) {
		throw new Error("Submission collision");
	}
	const descriptors = Object.getOwnPropertyDescriptors(marker);
	const keys = Reflect.ownKeys(descriptors);
	if (
		keys.length !== 2 ||
		keys.some((key) => typeof key !== "string" || (key !== "key" && key !== "submissionId"))
	) {
		throw new Error("Submission collision");
	}
	for (const key of ["key", "submissionId"] as const) {
		const property = descriptors[key];
		if (!property?.enumerable || !("value" in property)) {
			throw new Error("Submission collision");
		}
	}
	if (
		descriptors.key.value !== input.expectedKey ||
		descriptors.submissionId.value !== input.submissionId
	) {
		throw new Error("Submission collision");
	}
	return true;
}

export function requireReplayOnlySubmission<
	T extends {
		disposition: "executed" | "replayed";
		postCommit: WorkPeriodPostCommitDescriptor | null;
	},
>(submission: T): T {
	if (submission.disposition !== "replayed" || submission.postCommit !== null) {
		throw new Error("Submission collision");
	}
	return submission;
}

export async function loadCanonicalEvidence(
	tx: Pick<typeof db, "query">,
	period: OrdinarySourceEvidence,
	organizationId: string,
) {
	if (!period?.canonicalRecordId) throw new Error("Submission collision");
	const [record, workRows, allocations] = await Promise.all([
		tx.query.timeRecord.findFirst({
			where: and(
				eq(timeRecord.id, period.canonicalRecordId),
				eq(timeRecord.organizationId, organizationId),
			),
		}),
		tx.query.timeRecordWork.findMany({
			where: and(
				eq(timeRecordWork.recordId, period.canonicalRecordId),
				eq(timeRecordWork.organizationId, organizationId),
			),
			limit: 2,
		}),
		tx.query.timeRecordAllocation.findMany({
			where: and(
				eq(timeRecordAllocation.recordId, period.canonicalRecordId),
				eq(timeRecordAllocation.organizationId, organizationId),
			),
			limit: 2,
		}),
	]);
	return { record, workRows, allocations };
}

export function validateCommonEvidence(input: {
	period: OrdinarySourceEvidence;
	canonical: Awaited<ReturnType<typeof loadCanonicalEvidence>>;
	organizationId: string;
	employeeId: string;
	startTime: Date;
	endTime: Date;
	durationMinutes: number;
	origin: "clock" | "manual";
}) {
	const { period, canonical } = input;
	const work = canonical.workRows[0];
	const allocation = canonical.allocations[0];
	const expectedProjectId = period.projectId ?? null;
	if (
		!period ||
		period.organizationId !== input.organizationId ||
		period.employeeId !== input.employeeId ||
		period.isActive !== false ||
		period.deletedAt !== null ||
		!period.clockIn ||
		!period.clockOut ||
		period.clockIn.id !== period.clockInId ||
		period.clockOut.id !== period.clockOutId ||
		period.clockIn.organizationId !== input.organizationId ||
		period.clockOut.organizationId !== input.organizationId ||
		period.clockIn.employeeId !== input.employeeId ||
		period.clockOut.employeeId !== input.employeeId ||
		period.clockIn.type !== "clock_in" ||
		period.clockOut.type !== "clock_out" ||
		!sameInstant(period.startTime, input.startTime) ||
		!sameInstant(period.endTime, input.endTime) ||
		!sameInstant(period.clockIn.timestamp, input.startTime) ||
		!sameInstant(period.clockOut.timestamp, input.endTime) ||
		period.durationMinutes !== input.durationMinutes ||
		!canonical.record ||
		canonical.record.id !== period.canonicalRecordId ||
		canonical.record.organizationId !== input.organizationId ||
		canonical.record.employeeId !== input.employeeId ||
		canonical.record.recordKind !== "work" ||
		canonical.record.origin !== input.origin ||
		canonical.record.approvalState !== period.approvalStatus ||
		!sameInstant(canonical.record.startAt, input.startTime) ||
		!sameInstant(canonical.record.endAt, input.endTime) ||
		canonical.record.durationMinutes !== input.durationMinutes ||
		canonical.workRows.length !== 1 ||
		!work ||
		work.recordId !== period.canonicalRecordId ||
		work.organizationId !== input.organizationId ||
		work.recordKind !== "work" ||
		work.workCategoryId !== (period.workCategoryId ?? null) ||
		work.workLocationType !== (period.workLocationType ?? null) ||
		(input.origin === "clock" && work.computationMetadata !== null) ||
		(expectedProjectId === null
			? canonical.allocations.length !== 0
			: canonical.allocations.length !== 1 ||
				!allocation ||
				allocation.recordId !== period.canonicalRecordId ||
				allocation.organizationId !== input.organizationId ||
				allocation.allocationKind !== "project" ||
				allocation.projectId !== expectedProjectId ||
				allocation.costCenterId !== null ||
				allocation.weightPercent !== 100)
	) {
		throw new Error("Submission collision");
	}
}

export async function findPolicyClockOutSubmissionEvidence(input: {
	tx: Pick<typeof db, "query">;
	submissionId: string;
	organizationId: string;
	employeeId: string;
	/** Undefined preserved the period's attribution, so any stored value matches. */
	projectId: string | null | undefined;
	workCategoryId: string | null | undefined;
}) {
	const periods = (await input.tx.query.workPeriod.findMany({
		where: and(
			eq(workPeriod.organizationId, input.organizationId),
			eq(workPeriod.employeeId, input.employeeId),
			eq(workPeriod.isActive, false),
			eq(workPeriod.clockOutId, input.submissionId),
		),
		with: { clockIn: true, clockOut: true },
		limit: 2,
	})) as OrdinarySourceEvidence[];
	if (periods.length === 0) return null;
	if (periods.length !== 1) throw new Error("Submission collision");
	const period = periods[0];
	if (!(period.startTime instanceof Date) || !(period.endTime instanceof Date)) {
		throw new Error("Submission collision");
	}
	const canonical = await loadCanonicalEvidence(input.tx, period, input.organizationId);
	validateCommonEvidence({
		period,
		canonical,
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		startTime: period.startTime,
		endTime: period.endTime,
		durationMinutes: period.durationMinutes ?? -1,
		origin: "clock",
	});
	const marker = privateSubmissionMarker(period.pendingChanges);
	const submissionKey = deriveApprovalWorkflowId({
		organizationId: input.organizationId,
		workflowType: "policy_clock_out",
		sourceType: "time_entry",
		sourceId: period.id,
		allocationKey: input.submissionId,
	});
	const expectedWorkflowId = deriveApprovalWorkflowId({
		organizationId: input.organizationId,
		workflowType: "policy_clock_out",
		sourceType: "time_entry",
		sourceId: period.id,
		allocationKey: submissionKey,
	});
	let hasApprovalEvidence = period.approvalWorkflowId === expectedWorkflowId;
	if (!hasApprovalEvidence) {
		const requests = await input.tx.query.approvalRequest.findMany({
			where: and(
				eq(approvalRequest.organizationId, input.organizationId),
				eq(approvalRequest.entityType, "time_entry"),
				eq(approvalRequest.entityId, period.id),
			),
			columns: { metadata: true },
		});
		const requestEvidence = requests.map((request) =>
			hasPrivateApprovalSubmissionEvidence({
				metadata: request.metadata,
				expectedKey: submissionKey,
				submissionId: input.submissionId,
				expectedKind: "policy_clock_out",
			}),
		);
		hasApprovalEvidence = requestEvidence.some(Boolean);
	}
	if (period.approvalStatus === "pending" && !hasApprovalEvidence) {
		throw new Error("Submission collision");
	}
	if (
		marker !== null &&
		(marker.submissionId !== input.submissionId || marker.kind !== "policy_clock_out")
	) {
		throw new Error("Submission collision");
	}
	// Sound evidence of a different command under the same identity.
	const matches = (intended: string | null | undefined, stored: string | null) =>
		intended === undefined || intended === stored;
	if (
		!matches(input.projectId, period.projectId) ||
		!matches(input.workCategoryId, period.workCategoryId)
	) {
		throw new CompletedWorkCollisionError();
	}
	return { period, marker, hasApprovalEvidence };
}
