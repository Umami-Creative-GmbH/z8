import { sql } from "drizzle-orm";
import { instantFromDB } from "@/lib/datetime/drizzle-adapter";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import type {
	ApprovalDbService,
	JsonObject,
	VerifiedLegacyApprovalState,
} from "../workflow/ports";
import { normalizeStableData } from "../workflow/stable-data";

type AbsenceLegacyStateCaptureErrorCode =
	| "ambiguous_chain"
	| "duplicate_approval_request"
	| "malformed_evidence"
	| "orphan_chain_rows"
	| "query_failed"
	| "source_not_found";

export class AbsenceLegacyStateCaptureError extends Error {
	readonly code: AbsenceLegacyStateCaptureErrorCode;

	constructor(code: AbsenceLegacyStateCaptureErrorCode) {
		super("Absence legacy approval state capture failed");
		this.name = "AbsenceLegacyStateCaptureError";
		this.code = code;
	}
}

export interface CaptureAbsenceLegacyApprovalStateInput {
	dbService: ApprovalDbService;
	organizationId: string;
	absenceId: string;
	capturedAt: Instant;
}

function fail(code: AbsenceLegacyStateCaptureErrorCode): never {
	throw new AbsenceLegacyStateCaptureError(code);
}

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return fail("malformed_evidence");
	}
	return value as Record<string, unknown>;
}

function string(value: unknown): string {
	if (typeof value !== "string" || value.length === 0) {
		return fail("malformed_evidence");
	}
	return value;
}

function nullableString(value: unknown): string | null {
	return value === null ? null : string(value);
}

function nullableInstant(value: unknown): Instant | null {
	if (value === null) return null;
	try {
		if (value instanceof Date) {
			return instantFromDB(value) ?? fail("malformed_evidence");
		}
		if (
			typeof value === "string" &&
			/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?$/.test(value)
		) {
			return parseInstant(`${value.replace(" ", "T")}Z`);
		}
		return fail("malformed_evidence");
	} catch {
		return fail("malformed_evidence");
	}
}

function requiredInstant(value: unknown): Instant {
	return nullableInstant(value) ?? fail("malformed_evidence");
}

function array(value: unknown): unknown[] {
	if (!Array.isArray(value)) return fail("malformed_evidence");
	return value;
}

function resultRows(value: unknown): unknown[] {
	return array(record(value).rows);
}

function integer(value: unknown): number {
	if (!Number.isSafeInteger(value)) return fail("malformed_evidence");
	return value as number;
}

function chainStatus(value: unknown) {
	const status = string(value);
	if (!["pending", "approved", "rejected", "cancelled"].includes(status)) {
		return fail("malformed_evidence");
	}
	return status as "pending" | "approved" | "rejected" | "cancelled";
}

function requestStatus(value: unknown) {
	const status = string(value);
	if (!["pending", "approved", "rejected"].includes(status)) {
		return fail("malformed_evidence");
	}
	return status as "pending" | "approved" | "rejected";
}

export async function captureAbsenceLegacyApprovalState(
	input: CaptureAbsenceLegacyApprovalStateInput,
): Promise<VerifiedLegacyApprovalState> {
	let queryResult: unknown;
	try {
		queryResult = await input.dbService.db.execute(sql`
			with capture_input as (
				select
					${input.organizationId}::text as organization_id,
					${"absence_entry"}::text as entity_type,
					${input.absenceId}::uuid as entity_id
			),
			source_rows as (
				select
					absence.id,
					absence.employee_id as "employeeId",
					absence.organization_id as "organizationId",
					absence.category_id as "categoryId",
					absence.start_date as "startDate",
					absence.start_period as "startPeriod",
					absence.end_date as "endDate",
					absence.end_period as "endPeriod",
					absence.status,
					absence.rejection_reason as "rejectionReason",
					absence.approved_by as "approvedBy",
					absence.approved_at as "approvedAt",
					absence.canonical_record_id as "canonicalRecordId",
					absence.approval_workflow_id as "approvalWorkflowId"
				from absence_entry absence
				cross join capture_input capture
				where absence.organization_id = capture.organization_id
					and absence.id = capture.entity_id
				limit 2
			),
			request_rows as (
				select
					request.id,
					request.organization_id as "organizationId",
					request.entity_type as "entityType",
					request.entity_id as "entityId",
					request.requested_by as "requestedBy",
					request.approver_id as "approverId",
					request.status,
					request.reason,
					request.rejection_reason as "rejectionReason",
					request.approved_at as "approvedAt",
					request.metadata,
					request.updated_at as "updatedAt"
				from approval_request request
				cross join capture_input capture
				where request.organization_id = capture.organization_id
					and request.entity_type = capture.entity_type
					and request.entity_id = capture.entity_id
				order by request.updated_at desc, request.id
				limit 1001
			),
			chain_rows as (
				select
					chain.id,
					chain.organization_id as "organizationId",
					chain.policy_id as "policyId",
					chain.policy_name_snapshot as "policyNameSnapshot",
					chain.entity_type as "entityType",
					chain.entity_id as "entityId",
					chain.requester_employee_id as "requesterEmployeeId",
					chain.current_stage_order as "currentStageOrder",
					chain.status,
					chain.created_at as "createdAt",
					chain.updated_at as "updatedAt",
					chain.completed_at as "completedAt"
				from approval_chain_instance chain
				cross join capture_input capture
				where chain.organization_id = capture.organization_id
					and chain.entity_type = capture.entity_type
					and chain.entity_id = capture.entity_id
				order by chain.created_at desc, chain.id
				limit 2
			),
			stage_rows as (
				select
					stage.id,
					stage.organization_id as "organizationId",
					stage.chain_instance_id as "chainInstanceId",
					stage.policy_stage_id as "policyStageId",
					stage.step_order as "stepOrder",
					stage.label_snapshot as "labelSnapshot",
					stage.approver_type_snapshot as "approverTypeSnapshot",
					stage.resolved_approver_employee_id as "resolvedApproverEmployeeId",
					stage.approval_request_id as "approvalRequestId",
					stage.status,
					stage.decided_by as "decidedBy",
					stage.decided_at as "decidedAt",
					stage.created_at as "createdAt",
					stage.updated_at as "updatedAt"
				from approval_chain_stage_instance stage
				join chain_rows chain
					on stage.chain_instance_id = chain.id
					and stage.organization_id = chain."organizationId"
				cross join capture_input capture
				where stage.organization_id = capture.organization_id
					and chain."organizationId" = capture.organization_id
					and chain."entityType" = capture.entity_type
					and chain."entityId" = capture.entity_id
				order by stage.step_order, stage.id
				limit 101
			),
			required_employee_ids as (
				select "employeeId" as id from source_rows
				union select "approvedBy" from source_rows where "approvedBy" is not null
				union select "requestedBy" from request_rows
				union select "approverId" from request_rows
				union select "requesterEmployeeId" from chain_rows
				union select "resolvedApproverEmployeeId" from stage_rows
			),
			employee_identity_rows as (
				select employee.id, employee.organization_id as "organizationId"
				from required_employee_ids required
				cross join capture_input capture
				join employee
					on employee.id = required.id
					and employee.organization_id = capture.organization_id
			),
			category_identity_rows as (
				select category.id, category.organization_id as "organizationId"
				from source_rows source
				cross join capture_input capture
				join absence_category category
					on category.id = source."categoryId"
					and category.organization_id = capture.organization_id
			)
			select
				(select row_to_json(source) from source_rows source limit 1) as source,
				coalesce((select json_agg(request) from request_rows request), '[]'::json) as "approvalRequests",
				coalesce((select json_agg(chain) from chain_rows chain), '[]'::json) as chains,
				coalesce((select json_agg(stage) from stage_rows stage), '[]'::json) as "chainRows",
				json_build_object(
					'employees', coalesce((select json_agg(employee) from employee_identity_rows employee), '[]'::json),
					'categories', coalesce((select json_agg(category) from category_identity_rows category), '[]'::json)
				) as "identityEvidence"
		`);
	} catch {
		return fail("query_failed");
	}
	const envelopeRows = resultRows(queryResult);
	if (envelopeRows.length !== 1) return fail("malformed_evidence");
	const envelope = record(envelopeRows[0]);
	if (envelope.source === null) return fail("source_not_found");
	const source = record(envelope.source);
	const approvalRequests = array(envelope.approvalRequests);
	const chains = array(envelope.chains);
	const rawChainRows = array(envelope.chainRows);
	if (chains.length > 1) return fail("ambiguous_chain");
	if (approvalRequests.length > 1000 || rawChainRows.length > 100) {
		return fail("malformed_evidence");
	}

	const sourceSnapshot = {
		id: string(source.id),
		employeeId: string(source.employeeId),
		organizationId: string(source.organizationId),
		categoryId: string(source.categoryId),
		startDate: string(source.startDate),
		startPeriod: string(source.startPeriod),
		endDate: string(source.endDate),
		endPeriod: string(source.endPeriod),
		status: requestStatus(source.status),
		rejectionReason: nullableString(source.rejectionReason),
		approvedBy: nullableString(source.approvedBy),
		approvedAt: nullableInstant(source.approvedAt),
		canonicalRecordId: nullableString(source.canonicalRecordId),
		approvalWorkflowId: nullableString(source.approvalWorkflowId),
	};
	if (
		sourceSnapshot.id !== input.absenceId ||
		sourceSnapshot.organizationId !== input.organizationId ||
		(sourceSnapshot.status === "approved" &&
			(!sourceSnapshot.approvedBy || !sourceSnapshot.approvedAt))
	) {
		return fail("malformed_evidence");
	}
	const decodedRequests = approvalRequests.map((value) => {
		const request = record(value);
		const snapshot = {
			id: string(request.id),
			organizationId: string(request.organizationId),
			entityType: string(request.entityType),
			entityId: string(request.entityId),
			requestedBy: string(request.requestedBy),
			approverId: string(request.approverId),
			status: requestStatus(request.status),
			reason: nullableString(request.reason),
			rejectionReason: nullableString(request.rejectionReason),
			approvedAt: nullableInstant(request.approvedAt),
			metadata:
				request.metadata === null
					? null
					: (record(request.metadata) as JsonObject),
			updatedAt: requiredInstant(request.updatedAt),
		};
		if (
			snapshot.organizationId !== input.organizationId ||
			snapshot.entityType !== "absence_entry" ||
			snapshot.entityId !== input.absenceId ||
			snapshot.requestedBy !== sourceSnapshot.employeeId ||
			(snapshot.status === "approved" && !snapshot.approvedAt)
		) {
			return fail("malformed_evidence");
		}
		return snapshot;
	});
	const chain = chains[0]
		? (() => {
				const value = record(chains[0]);
				const snapshot = {
					id: string(value.id),
					organizationId: string(value.organizationId),
					policyId: string(value.policyId),
					policyNameSnapshot: string(value.policyNameSnapshot),
					entityType: string(value.entityType),
					entityId: string(value.entityId),
					requesterEmployeeId: string(value.requesterEmployeeId),
					currentStageOrder: integer(value.currentStageOrder),
					status: chainStatus(value.status),
					createdAt: requiredInstant(value.createdAt),
					updatedAt: requiredInstant(value.updatedAt),
					completedAt: nullableInstant(value.completedAt),
				};
				if (
					snapshot.organizationId !== input.organizationId ||
					snapshot.entityType !== "absence_entry" ||
					snapshot.entityId !== input.absenceId ||
					snapshot.requesterEmployeeId !== sourceSnapshot.employeeId ||
					(snapshot.status !== "pending" && !snapshot.completedAt)
				) {
					return fail("malformed_evidence");
				}
				return snapshot;
			})()
		: null;
	if (!chain && rawChainRows.length > 0) return fail("orphan_chain_rows");
	const chainRows = rawChainRows
		.map((value) => {
			const row = record(value);
			const snapshot = {
				id: string(row.id),
				organizationId: string(row.organizationId),
				chainInstanceId: string(row.chainInstanceId),
				policyStageId: string(row.policyStageId),
				stepOrder: integer(row.stepOrder),
				labelSnapshot: string(row.labelSnapshot),
				approverTypeSnapshot: string(row.approverTypeSnapshot),
				resolvedApproverEmployeeId: string(row.resolvedApproverEmployeeId),
				approvalRequestId: nullableString(row.approvalRequestId),
				status: chainStatus(row.status),
				decidedBy: nullableString(row.decidedBy),
				decidedAt: nullableInstant(row.decidedAt),
				createdAt: requiredInstant(row.createdAt),
				updatedAt: requiredInstant(row.updatedAt),
			};
			if (
				snapshot.organizationId !== input.organizationId ||
				snapshot.chainInstanceId !== chain?.id
			) {
				return fail("orphan_chain_rows");
			}
			if (
				["approved", "rejected"].includes(snapshot.status) &&
				(!snapshot.approvalRequestId ||
					!snapshot.decidedBy ||
					!snapshot.decidedAt)
			) {
				return fail("malformed_evidence");
			}
			return snapshot;
		})
		.sort((left, right) => left.stepOrder - right.stepOrder);
	if (
		new Set(chainRows.map((row) => row.stepOrder)).size !== chainRows.length
	) {
		return fail("ambiguous_chain");
	}
	const identityEvidence = record(envelope.identityEvidence);
	const employeeEvidence = array(identityEvidence.employees).map((value) => {
		const employee = record(value);
		return {
			id: string(employee.id),
			organizationId: string(employee.organizationId),
		};
	});
	const categoryEvidence = array(identityEvidence.categories).map((value) => {
		const category = record(value);
		return {
			id: string(category.id),
			organizationId: string(category.organizationId),
		};
	});
	const requiredEmployeeIds = new Set([
		sourceSnapshot.employeeId,
		...(sourceSnapshot.approvedBy ? [sourceSnapshot.approvedBy] : []),
		...decodedRequests.flatMap((request) => [
			request.requestedBy,
			request.approverId,
		]),
		...(chain ? [chain.requesterEmployeeId] : []),
		...chainRows.map((row) => row.resolvedApproverEmployeeId),
	]);
	const ownedEmployeeIds = new Set(
		employeeEvidence.flatMap((employee) =>
			employee.organizationId === input.organizationId ? [employee.id] : [],
		),
	);
	if (
		employeeEvidence.length !== ownedEmployeeIds.size ||
		ownedEmployeeIds.size !== requiredEmployeeIds.size ||
		[...requiredEmployeeIds].some((id) => !ownedEmployeeIds.has(id)) ||
		categoryEvidence.length !== 1 ||
		categoryEvidence[0]?.id !== sourceSnapshot.categoryId ||
		categoryEvidence[0]?.organizationId !== input.organizationId
	) {
		return fail("malformed_evidence");
	}
	const currentRow = chainRows.find(
		(row) => row.stepOrder === chain?.currentStageOrder,
	);
	if (chain && !currentRow) return fail("ambiguous_chain");
	const currentRequestId = currentRow?.approvalRequestId;
	if (
		chain?.status === "pending" &&
		!decodedRequests.some((request) => request.id === currentRequestId)
	) {
		return fail("ambiguous_chain");
	}
	const requestCounts = new Map<string, number>();
	for (const request of decodedRequests) {
		requestCounts.set(request.id, (requestCounts.get(request.id) ?? 0) + 1);
	}
	const rowLinkCounts = new Map<string, number>();
	for (const row of chainRows) {
		if (row.approvalRequestId) {
			rowLinkCounts.set(
				row.approvalRequestId,
				(rowLinkCounts.get(row.approvalRequestId) ?? 0) + 1,
			);
		}
	}
	if (chain) {
		if ([...requestCounts.values()].some((count) => count !== 1)) {
			return fail("duplicate_approval_request");
		}
		if (
			chainRows.some(
				(row) =>
					row.approvalRequestId !== null &&
					(requestCounts.get(row.approvalRequestId) !== 1 ||
						rowLinkCounts.get(row.approvalRequestId) !== 1),
			)
		) {
			return fail("malformed_evidence");
		}
		if (
			decodedRequests.some((request) => rowLinkCounts.get(request.id) !== 1)
		) {
			return fail("duplicate_approval_request");
		}
		if (
			decodedRequests.some(
				(request) => request.requestedBy !== chain.requesterEmployeeId,
			)
		) {
			return fail("malformed_evidence");
		}
	} else if (decodedRequests.length > 1) {
		return fail("duplicate_approval_request");
	}
	for (const request of decodedRequests) {
		const linkedRow = chainRows.find(
			(row) => row.approvalRequestId === request.id,
		);
		if (
			chain &&
			(!linkedRow ||
				request.approverId !== linkedRow.resolvedApproverEmployeeId ||
				request.status !== linkedRow.status)
		) {
			return fail("malformed_evidence");
		}
	}
	// The port exposes one request. Historical row-linked requests are still loaded
	// and validated above; only the current/terminal stage request is returned.
	const approvalRequest = chain
		? (decodedRequests.find((request) => request.id === currentRequestId) ??
			null)
		: (decodedRequests[0] ?? null);
	if (chain && currentRow) {
		const currentIndex = chainRows.indexOf(currentRow);
		const earlierRows = chainRows.slice(0, currentIndex);
		const laterRows = chainRows.slice(currentIndex + 1);
		const isUnactivated = (row: (typeof chainRows)[number]) =>
			(row.status === "pending" || row.status === "cancelled") &&
			row.approvalRequestId === null &&
			row.decidedBy === null &&
			row.decidedAt === null;
		const approvedPrefix = earlierRows.every(
			(row) => row.status === "approved",
		);
		let cancellationClearingStarted = false;
		const coherentCancellationPrefix = earlierRows.every((row) => {
			if (row.status === "approved") return !cancellationClearingStarted;
			if (row.status === "cancelled" && isUnactivated(row)) {
				cancellationClearingStarted = true;
				return true;
			}
			return false;
		});
		const approvedRootCancellation =
			chain.status === "cancelled" &&
			currentIndex === chainRows.length - 1 &&
			chainRows.every((row) => row.status === "approved") &&
			approvalRequest?.status === "approved";
		let coherent = false;
		switch (chain.status) {
			case "pending":
				coherent =
					chain.completedAt === null &&
					approvedPrefix &&
					currentRow.status === "pending" &&
					approvalRequest?.status === "pending" &&
					laterRows.every(isUnactivated);
				break;
			case "approved":
				coherent =
					currentIndex === chainRows.length - 1 &&
					chainRows.every((row) => row.status === "approved") &&
					approvalRequest?.status === "approved";
				break;
			case "rejected":
				coherent =
					approvedPrefix &&
					currentRow.status === "rejected" &&
					approvalRequest?.status === "rejected" &&
					laterRows.every(
						(row) => row.status === "cancelled" && isUnactivated(row),
					);
				break;
			case "cancelled":
				coherent =
					approvedRootCancellation ||
					(coherentCancellationPrefix &&
						isUnactivated(currentRow) &&
						laterRows.every(isUnactivated));
				break;
		}
		if (!coherent) return fail("malformed_evidence");
	}
	const approvedRootCancellation =
		chain?.status === "cancelled" &&
		chainRows.length > 0 &&
		chainRows.every((row) => row.status === "approved") &&
		approvalRequest?.status === "approved";
	const expectedSourceStatus = approvedRootCancellation
		? "approved"
		: chain?.status === "cancelled"
			? "pending"
			: chain?.status;
	if (
		(chain && sourceSnapshot.status !== expectedSourceStatus) ||
		(!chain &&
			approvalRequest &&
			sourceSnapshot.status !== approvalRequest.status)
	) {
		return fail("malformed_evidence");
	}

	try {
		return normalizeStableData({
			organizationId: input.organizationId,
			source: {
				organizationId: input.organizationId,
				workflowType: "absence",
				sourceType: "absence_entry",
				sourceId: input.absenceId,
			},
			approvalRequest,
			chain,
			chainRows,
			sourceSnapshot,
			capturedAt: input.capturedAt,
		}) as VerifiedLegacyApprovalState & { sourceSnapshot: JsonObject };
	} catch {
		return fail("malformed_evidence");
	}
}
