import { PgDialect, type SQL } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { ApprovalDbService } from "../workflow/ports";
import { captureAbsenceLegacyApprovalState } from "./absence-legacy-state";

const absenceId = "10000000-0000-4000-8000-000000000001";
const employeeId = "20000000-0000-4000-8000-000000000001";
const categoryId = "30000000-0000-4000-8000-000000000001";
const capturedAt = parseInstant("2026-07-18T09:00:00Z");
const requestId = "50000000-0000-4000-8000-000000000001";
const secondRequestId = "50000000-0000-4000-8000-000000000002";
const chainId = "70000000-0000-4000-8000-000000000001";
const source = {
	id: absenceId,
	employeeId,
	organizationId: "org-1",
	categoryId,
	startDate: "2026-07-20",
	startPeriod: "morning",
	endDate: "2026-07-22",
	endPeriod: "afternoon",
	status: "pending",
	rejectionReason: null,
	approvedBy: null,
	approvedAt: null,
	canonicalRecordId: "40000000-0000-4000-8000-000000000001",
	approvalWorkflowId: null,
};
const request = {
	id: requestId,
	organizationId: "org-1",
	entityType: "absence_entry",
	entityId: absenceId,
	requestedBy: employeeId,
	approverId: "60000000-0000-4000-8000-000000000001",
	status: "pending",
	reason: "Annual leave",
	rejectionReason: null,
	approvedAt: null,
	metadata: { channel: "web", nested: { stable: true } },
	updatedAt: new Date("2026-07-18T08:30:00.000Z"),
};
const chain = {
	id: chainId,
	organizationId: "org-1",
	policyId: "80000000-0000-4000-8000-000000000001",
	policyNameSnapshot: "Two-stage leave",
	entityType: "absence_entry",
	entityId: absenceId,
	requesterEmployeeId: employeeId,
	currentStageOrder: 2,
	status: "pending",
	createdAt: new Date("2026-07-18T08:00:00.000Z"),
	updatedAt: new Date("2026-07-18T08:45:00.000Z"),
	completedAt: null,
};

function chainRow(stepOrder: number, overrides: Record<string, unknown> = {}) {
	return {
		id: `90000000-0000-4000-8000-00000000000${stepOrder}`,
		organizationId: "org-1",
		chainInstanceId: chainId,
		policyStageId: `a0000000-0000-4000-8000-00000000000${stepOrder}`,
		stepOrder,
		labelSnapshot: `Stage ${stepOrder}`,
		approverTypeSnapshot: "specific_employee",
		resolvedApproverEmployeeId: `60000000-0000-4000-8000-00000000000${stepOrder}`,
		approvalRequestId: stepOrder === 1 ? requestId : secondRequestId,
		status: stepOrder === 1 ? "approved" : "pending",
		decidedBy: stepOrder === 1 ? employeeId : null,
		decidedAt: stepOrder === 1 ? new Date("2026-07-18T08:40:00.000Z") : null,
		createdAt: new Date(`2026-07-18T08:0${stepOrder}:00.000Z`),
		updatedAt: new Date(`2026-07-18T08:4${stepOrder}:00.000Z`),
		...overrides,
	};
}

function identityEvidence(envelope: Record<string, unknown>) {
	const employeeIds = new Set<string>();
	const sourceRow = envelope.source as typeof source | null;
	if (sourceRow?.employeeId) employeeIds.add(sourceRow.employeeId);
	if (sourceRow?.approvedBy) employeeIds.add(sourceRow.approvedBy);
	for (const approval of (envelope.approvalRequests ?? []) as Array<
		Partial<typeof request>
	>) {
		if (approval.requestedBy) employeeIds.add(approval.requestedBy);
		if (approval.approverId) employeeIds.add(approval.approverId);
	}
	for (const chainRow of (envelope.chains ?? []) as Array<
		Partial<typeof chain>
	>) {
		if (chainRow.requesterEmployeeId) {
			employeeIds.add(chainRow.requesterEmployeeId);
		}
	}
	for (const row of (envelope.chainRows ?? []) as Array<
		ReturnType<typeof chainRow>
	>) {
		if (typeof row.resolvedApproverEmployeeId === "string") {
			employeeIds.add(row.resolvedApproverEmployeeId);
		}
	}
	return {
		employees: [...employeeIds].map((id) => ({ id, organizationId: "org-1" })),
		categories: sourceRow?.categoryId
			? [{ id: sourceRow.categoryId, organizationId: "org-1" }]
			: [],
	};
}

function database(
	envelope: Record<string, unknown>,
	...subsequentEnvelopes: Record<string, unknown>[]
) {
	const calls: SQL[] = [];
	const envelopes = [envelope, ...subsequentEnvelopes];
	const dbService = {
		db: {
			execute: async (query: SQL) => {
				calls.push(query);
				const current = envelopes.shift();
				if (!current) throw new Error("Unexpected extra capture query");
				return {
					rows: [
						{
							...current,
							identityEvidence:
								current.identityEvidence ?? identityEvidence(current),
						},
					],
				};
			},
		},
	} as ApprovalDbService;
	return { calls, dbService };
}

describe("captureAbsenceLegacyApprovalState", () => {
	it("captures an exact scoped source with no approval request", async () => {
		const fake = database({
			source,
			approvalRequests: [],
			chains: [],
			chainRows: [],
		});

		const state = await captureAbsenceLegacyApprovalState({
			dbService: fake.dbService,
			organizationId: "org-1",
			absenceId,
			capturedAt,
		});

		expect(state).toEqual({
			organizationId: "org-1",
			source: {
				organizationId: "org-1",
				workflowType: "absence",
				sourceType: "absence_entry",
				sourceId: absenceId,
			},
			approvalRequest: null,
			chain: null,
			chainRows: [],
			sourceSnapshot: source,
			capturedAt,
		});

		expect(fake.calls).toHaveLength(1);
		const query = new PgDialect().sqlToQuery(fake.calls[0]);
		expect(query.params).toEqual(["org-1", "absence_entry", absenceId]);
		expect(query.sql).toContain(
			"absence.organization_id = capture.organization_id",
		);
		expect(query.sql).toContain("request.entity_type = capture.entity_type");
		expect(query.sql).toContain("chain.entity_id = capture.entity_id");
		expect(query.sql).toContain("stage.chain_instance_id = chain.id");
		expect(query.sql).toContain(
			"employee.organization_id = capture.organization_id",
		);
		expect(query.sql).toContain(
			"category.organization_id = capture.organization_id",
		);
		expect(query.sql).toContain("limit 1001");
		expect(query.sql).toContain("limit 101");
	});

	it("rejects a missing scoped source without leaking source details", async () => {
		const fake = database({
			source: null,
			approvalRequests: [],
			chains: [],
			chainRows: [],
		});

		await expect(
			captureAbsenceLegacyApprovalState({
				dbService: fake.dbService,
				organizationId: "org-1",
				absenceId,
				capturedAt,
			}),
		).rejects.toMatchObject({
			name: "AbsenceLegacyStateCaptureError",
			code: "source_not_found",
			message: "Absence legacy approval state capture failed",
		});
	});

	it("captures a direct approval request with exact Temporal timestamps", async () => {
		const mutableRequest = structuredClone(request);
		const fake = database({
			source,
			approvalRequests: [mutableRequest],
			chains: [],
			chainRows: [],
		});

		const state = await captureAbsenceLegacyApprovalState({
			dbService: fake.dbService,
			organizationId: "org-1",
			absenceId,
			capturedAt,
		});

		expect(state.approvalRequest).toEqual({
			...request,
			metadata: request.metadata,
			updatedAt: parseInstant("2026-07-18T08:30:00Z"),
		});
		mutableRequest.metadata.nested.stable = false;
		expect(state.approvalRequest?.metadata).toEqual(request.metadata);
	});

	it("captures approved direct cancellation evidence before and after request deletion while the source remains approved", async () => {
		const approvedSource = {
			...source,
			status: "approved",
			approvedBy: request.approverId,
			approvedAt: request.updatedAt,
		};
		const approvedRequest = {
			...request,
			status: "approved",
			approvedAt: request.updatedAt,
		};
		const before = database({
			source: approvedSource,
			approvalRequests: [approvedRequest],
			chains: [],
			chainRows: [],
		});
		const after = database({
			source: approvedSource,
			approvalRequests: [],
			chains: [],
			chainRows: [],
		});

		const [beforeState, afterState] = await Promise.all([
			captureAbsenceLegacyApprovalState({
				dbService: before.dbService,
				organizationId: "org-1",
				absenceId,
				capturedAt,
			}),
			captureAbsenceLegacyApprovalState({
				dbService: after.dbService,
				organizationId: "org-1",
				absenceId,
				capturedAt,
			}),
		]);

		expect(beforeState).toMatchObject({
			approvalRequest: { id: request.id, status: "approved" },
			sourceSnapshot: { status: "approved" },
		});
		expect(afterState).toMatchObject({
			approvalRequest: null,
			sourceSnapshot: { status: "approved" },
		});
	});

	it("decodes PostgreSQL JSON timestamp strings as exact instants", async () => {
		const fake = database({
			source,
			approvalRequests: [{ ...request, updatedAt: "2026-07-18T08:30:00.000" }],
			chains: [],
			chainRows: [],
		});

		const state = await captureAbsenceLegacyApprovalState({
			dbService: fake.dbService,
			organizationId: "org-1",
			absenceId,
			capturedAt,
		});

		expect(state.approvalRequest?.updatedAt).toEqual(
			parseInstant("2026-07-18T08:30:00Z"),
		);
	});

	it("captures a policy chain with rows ordered by stepOrder", async () => {
		const currentRequest = {
			...request,
			id: secondRequestId,
			approverId: "60000000-0000-4000-8000-000000000002",
			updatedAt: new Date("2026-07-18T08:45:00.000Z"),
		};
		const approvedRequest = {
			...request,
			status: "approved",
			approvedAt: new Date("2026-07-18T08:40:00.000Z"),
		};
		const fake = database({
			source,
			approvalRequests: [currentRequest, approvedRequest],
			chains: [chain],
			chainRows: [chainRow(2), chainRow(1)],
		});

		const state = await captureAbsenceLegacyApprovalState({
			dbService: fake.dbService,
			organizationId: "org-1",
			absenceId,
			capturedAt,
		});

		expect(state.approvalRequest?.id).toBe(secondRequestId);
		expect(state.chain).toEqual({
			...chain,
			createdAt: parseInstant("2026-07-18T08:00:00Z"),
			updatedAt: parseInstant("2026-07-18T08:45:00Z"),
		});
		expect(state.chainRows.map((row) => row.stepOrder)).toEqual([1, 2]);
		expect(state.chainRows[0]).toEqual({
			...chainRow(1),
			decidedAt: parseInstant("2026-07-18T08:40:00Z"),
			createdAt: parseInstant("2026-07-18T08:01:00Z"),
			updatedAt: parseInstant("2026-07-18T08:41:00Z"),
		});
		expect(fake.calls).toHaveLength(1);
		expect(new PgDialect().sqlToQuery(fake.calls[0]).params).toEqual([
			"org-1",
			"absence_entry",
			absenceId,
		]);
	});

	it("captures requester auto-completed chain evidence", async () => {
		const completedAt = new Date("2026-07-18T08:50:00.000Z");
		const fake = database({
			source: {
				...source,
				status: "approved",
				approvedBy: employeeId,
				approvedAt: completedAt,
			},
			approvalRequests: [
				{
					...request,
					id: secondRequestId,
					approverId: "60000000-0000-4000-8000-000000000002",
					status: "approved",
					approvedAt: completedAt,
					updatedAt: completedAt,
				},
				{
					...request,
					status: "approved",
					approvedAt: new Date("2026-07-18T08:40:00.000Z"),
				},
			],
			chains: [
				{ ...chain, status: "approved", completedAt, updatedAt: completedAt },
			],
			chainRows: [
				chainRow(1),
				chainRow(2, {
					status: "approved",
					decidedBy: employeeId,
					decidedAt: completedAt,
					updatedAt: completedAt,
				}),
			],
		});

		const state = await captureAbsenceLegacyApprovalState({
			dbService: fake.dbService,
			organizationId: "org-1",
			absenceId,
			capturedAt,
		});

		expect(state.sourceSnapshot.status).toBe("approved");
		expect(state.approvalRequest?.status).toBe("approved");
		expect(state.chain?.status).toBe("approved");
		expect(state.chainRows.every((row) => row.status === "approved")).toBe(
			true,
		);
	});

	it("captures rejected source and request evidence", async () => {
		const rejectedAt = new Date("2026-07-18T08:55:00.000Z");
		const fake = database({
			source: {
				...source,
				status: "rejected",
				rejectionReason: "Insufficient coverage",
			},
			approvalRequests: [
				{
					...request,
					status: "rejected",
					rejectionReason: "Insufficient coverage",
					updatedAt: rejectedAt,
				},
			],
			chains: [],
			chainRows: [],
		});

		const state = await captureAbsenceLegacyApprovalState({
			dbService: fake.dbService,
			organizationId: "org-1",
			absenceId,
			capturedAt,
		});

		expect(state.sourceSnapshot.rejectionReason).toBe("Insufficient coverage");
		expect(state.approvalRequest).toMatchObject({
			status: "rejected",
			rejectionReason: "Insufficient coverage",
		});
	});

	it("captures cancellation as request disappearance while the source exists", async () => {
		const beforeEnvelope = {
			source,
			approvalRequests: [request],
			chains: [],
			chainRows: [],
		};
		const fake = database(beforeEnvelope, {
			...beforeEnvelope,
			approvalRequests: [],
		});
		const input = {
			dbService: fake.dbService,
			organizationId: "org-1",
			absenceId,
			capturedAt,
		};

		const before = await captureAbsenceLegacyApprovalState(input);
		const after = await captureAbsenceLegacyApprovalState(input);

		expect(before.approvalRequest).not.toBeNull();
		expect(after.approvalRequest).toBeNull();
		expect(after.sourceSnapshot.id).toBe(absenceId);
	});

	it.each([
		{
			name: "invalid source status",
			envelope: {
				source: { ...source, status: "cancelled" },
				approvalRequests: [],
				chains: [],
				chainRows: [],
			},
			code: "malformed_evidence",
		},
		{
			name: "duplicate direct requests",
			envelope: {
				source,
				approvalRequests: [request, { ...request, id: secondRequestId }],
				chains: [],
				chainRows: [],
			},
			code: "duplicate_approval_request",
		},
		{
			name: "duplicate current chain request",
			envelope: {
				source,
				approvalRequests: [request, { ...request }],
				chains: [{ ...chain, currentStageOrder: 1 }],
				chainRows: [chainRow(1)],
			},
			code: "duplicate_approval_request",
		},
		{
			name: "multiple chains",
			envelope: {
				source,
				approvalRequests: [],
				chains: [chain, { ...chain }],
				chainRows: [],
			},
			code: "ambiguous_chain",
		},
		{
			name: "foreign request mixed with the local request",
			envelope: {
				source,
				approvalRequests: [
					request,
					{ ...request, id: secondRequestId, organizationId: "org-2" },
				],
				chains: [],
				chainRows: [],
			},
			code: "malformed_evidence",
		},
		{
			name: "mismatched request source",
			envelope: {
				source,
				approvalRequests: [{ ...request, entityId: "other-absence" }],
				chains: [],
				chainRows: [],
			},
			code: "malformed_evidence",
		},
		{
			name: "direct request status disagrees with source",
			envelope: {
				source,
				approvalRequests: [
					{
						...request,
						status: "approved",
						approvedAt: request.updatedAt,
					},
				],
				chains: [],
				chainRows: [],
			},
			code: "malformed_evidence",
		},
		{
			name: "foreign chain",
			envelope: {
				source,
				approvalRequests: [],
				chains: [{ ...chain, organizationId: "org-2" }],
				chainRows: [],
			},
			code: "malformed_evidence",
		},
		{
			name: "rows without a chain",
			envelope: {
				source,
				approvalRequests: [],
				chains: [],
				chainRows: [chainRow(1)],
			},
			code: "orphan_chain_rows",
		},
		{
			name: "foreign chain row",
			envelope: {
				source,
				approvalRequests: [request],
				chains: [{ ...chain, currentStageOrder: 1 }],
				chainRows: [chainRow(1, { organizationId: "org-2" })],
			},
			code: "orphan_chain_rows",
		},
		{
			name: "row for another chain",
			envelope: {
				source,
				approvalRequests: [request],
				chains: [{ ...chain, currentStageOrder: 1 }],
				chainRows: [chainRow(1, { chainInstanceId: "other-chain" })],
			},
			code: "orphan_chain_rows",
		},
		{
			name: "duplicate stage order",
			envelope: {
				source,
				approvalRequests: [request],
				chains: [{ ...chain, currentStageOrder: 1 }],
				chainRows: [chainRow(1), chainRow(1, { id: "other-row" })],
			},
			code: "ambiguous_chain",
		},
		{
			name: "missing current chain row",
			envelope: {
				source,
				approvalRequests: [request],
				chains: [chain],
				chainRows: [chainRow(1)],
			},
			code: "ambiguous_chain",
		},
		{
			name: "pending chain with missing current request",
			envelope: {
				source,
				approvalRequests: [],
				chains: [chain],
				chainRows: [chainRow(1), chainRow(2)],
			},
			code: "ambiguous_chain",
		},
		{
			name: "missing historical request linked by a terminal row",
			envelope: {
				source,
				approvalRequests: [
					{
						...request,
						id: secondRequestId,
						approverId: "60000000-0000-4000-8000-000000000002",
					},
				],
				chains: [chain],
				chainRows: [chainRow(1), chainRow(2)],
			},
			code: "malformed_evidence",
		},
		{
			name: "missing request linked by a terminal current row",
			envelope: {
				source: {
					...source,
					status: "approved",
					approvedBy: employeeId,
					approvedAt: request.updatedAt,
				},
				approvalRequests: [],
				chains: [
					{
						...chain,
						currentStageOrder: 1,
						status: "approved",
						completedAt: request.updatedAt,
					},
				],
				chainRows: [chainRow(1)],
			},
			code: "malformed_evidence",
		},
		{
			name: "same request linked by duplicate chain rows",
			envelope: {
				source,
				approvalRequests: [
					{
						...request,
						status: "approved",
						approvedAt: request.updatedAt,
					},
				],
				chains: [chain],
				chainRows: [
					chainRow(1),
					chainRow(2, {
						approvalRequestId: requestId,
						resolvedApproverEmployeeId: request.approverId,
						status: "approved",
						decidedBy: employeeId,
						decidedAt: request.updatedAt,
					}),
				],
			},
			code: "malformed_evidence",
		},
		{
			name: "direct request made by another employee",
			envelope: {
				source,
				approvalRequests: [{ ...request, requestedBy: "other-employee" }],
				chains: [],
				chainRows: [],
			},
			code: "malformed_evidence",
		},
		{
			name: "requester does not match chain",
			envelope: {
				source,
				approvalRequests: [request],
				chains: [
					{ ...chain, currentStageOrder: 1, requesterEmployeeId: "other" },
				],
				chainRows: [chainRow(1)],
			},
			code: "malformed_evidence",
		},
		{
			name: "request approver does not match stage",
			envelope: {
				source,
				approvalRequests: [{ ...request, approverId: "other-approver" }],
				chains: [{ ...chain, currentStageOrder: 1 }],
				chainRows: [chainRow(1)],
			},
			code: "malformed_evidence",
		},
		{
			name: "current request status disagrees with its stage",
			envelope: {
				source,
				approvalRequests: [
					{
						...request,
						status: "approved",
						approvedAt: request.updatedAt,
					},
				],
				chains: [{ ...chain, currentStageOrder: 1 }],
				chainRows: [
					chainRow(1, { status: "pending", decidedAt: null, decidedBy: null }),
				],
			},
			code: "malformed_evidence",
		},
	])("rejects $name", async ({ envelope, code }) => {
		const fake = database(envelope);

		await expect(
			captureAbsenceLegacyApprovalState({
				dbService: fake.dbService,
				organizationId: "org-1",
				absenceId,
				capturedAt,
			}),
		).rejects.toMatchObject({
			name: "AbsenceLegacyStateCaptureError",
			code,
			message: "Absence legacy approval state capture failed",
		});
	});

	it.each([
		{
			name: "invalid source approval timestamp",
			envelope: {
				source: { ...source, approvedAt: new Date(Number.NaN) },
				approvalRequests: [],
				chains: [],
				chainRows: [],
			},
		},
		{
			name: "approved source without approval timestamp",
			envelope: {
				source: { ...source, status: "approved", approvedBy: employeeId },
				approvalRequests: [],
				chains: [],
				chainRows: [],
			},
		},
		{
			name: "request without updated timestamp",
			envelope: {
				source,
				approvalRequests: [{ ...request, updatedAt: null }],
				chains: [],
				chainRows: [],
			},
		},
		{
			name: "approved request without approval timestamp",
			envelope: {
				source,
				approvalRequests: [{ ...request, status: "approved" }],
				chains: [],
				chainRows: [],
			},
		},
		{
			name: "completed chain without completed timestamp",
			envelope: {
				source,
				approvalRequests: [
					{ ...request, status: "approved", approvedAt: request.updatedAt },
				],
				chains: [
					{
						...chain,
						currentStageOrder: 1,
						status: "approved",
						completedAt: null,
					},
				],
				chainRows: [
					chainRow(1, {
						status: "approved",
						decidedAt: request.updatedAt,
						resolvedApproverEmployeeId: request.approverId,
					}),
				],
			},
		},
		{
			name: "decided row without decided timestamp",
			envelope: {
				source,
				approvalRequests: [
					{ ...request, status: "approved", approvedAt: request.updatedAt },
				],
				chains: [
					{
						...chain,
						currentStageOrder: 1,
						status: "approved",
						completedAt: request.updatedAt,
					},
				],
				chainRows: [
					chainRow(1, {
						status: "approved",
						decidedAt: null,
						resolvedApproverEmployeeId: request.approverId,
					}),
				],
			},
		},
	])("rejects $name", async ({ envelope }) => {
		const fake = database(envelope);

		await expect(
			captureAbsenceLegacyApprovalState({
				dbService: fake.dbService,
				organizationId: "org-1",
				absenceId,
				capturedAt,
			}),
		).rejects.toMatchObject({
			name: "AbsenceLegacyStateCaptureError",
			code: "malformed_evidence",
		});
	});

	it("rejects non-stable request JSON with the focused capture error", async () => {
		const metadata: Record<string, unknown> = {};
		metadata.self = metadata;
		const fake = database({
			source,
			approvalRequests: [{ ...request, metadata }],
			chains: [],
			chainRows: [],
		});

		await expect(
			captureAbsenceLegacyApprovalState({
				dbService: fake.dbService,
				organizationId: "org-1",
				absenceId,
				capturedAt,
			}),
		).rejects.toMatchObject({
			name: "AbsenceLegacyStateCaptureError",
			code: "malformed_evidence",
		});
	});

	it("returns source, chain, and row evidence without aliasing database rows", async () => {
		const mutableSource = structuredClone(source);
		const mutableChain = structuredClone(chain);
		const mutableRows = [
			structuredClone(chainRow(2)),
			structuredClone(chainRow(1)),
		];
		const fake = database({
			source: mutableSource,
			approvalRequests: [
				{
					...request,
					id: secondRequestId,
					approverId: "60000000-0000-4000-8000-000000000002",
				},
				{
					...request,
					status: "approved",
					approvedAt: request.updatedAt,
				},
			],
			chains: [mutableChain],
			chainRows: mutableRows,
		});

		const state = await captureAbsenceLegacyApprovalState({
			dbService: fake.dbService,
			organizationId: "org-1",
			absenceId,
			capturedAt,
		});
		mutableSource.status = "rejected";
		mutableChain.policyNameSnapshot = "Mutated";
		mutableRows[0].labelSnapshot = "Mutated";

		expect(state.sourceSnapshot.status).toBe("pending");
		expect(state.chain?.policyNameSnapshot).toBe("Two-stage leave");
		expect(state.chainRows[1].labelSnapshot).toBe("Stage 2");
		expect(state.sourceSnapshot).not.toBe(mutableSource);
		expect(state.chain).not.toBe(mutableChain);
		expect(state.chainRows[1]).not.toBe(mutableRows[0]);
	});

	it.each([
		"approved",
		"rejected",
	] as const)("rejects a %s historical row without a request link in a pending chain", async (status) => {
		const fake = database({
			source,
			approvalRequests: [
				{
					...request,
					id: secondRequestId,
					approverId: "60000000-0000-4000-8000-000000000002",
				},
			],
			chains: [chain],
			chainRows: [
				chainRow(1, {
					approvalRequestId: null,
					status,
				}),
				chainRow(2),
			],
		});

		await expect(
			captureAbsenceLegacyApprovalState({
				dbService: fake.dbService,
				organizationId: "org-1",
				absenceId,
				capturedAt,
			}),
		).rejects.toMatchObject({
			name: "AbsenceLegacyStateCaptureError",
			code: "malformed_evidence",
		});
	});

	it.each([
		"approved",
		"rejected",
	] as const)("rejects a terminal %s row without a request link in a terminal chain", async (status) => {
		const terminalAt = new Date("2026-07-18T08:50:00.000Z");
		const fake = database({
			source: {
				...source,
				status,
				approvedBy: status === "approved" ? employeeId : null,
				approvedAt: status === "approved" ? terminalAt : null,
				rejectionReason: status === "rejected" ? "Rejected" : null,
			},
			approvalRequests: [],
			chains: [
				{
					...chain,
					currentStageOrder: 1,
					status,
					completedAt: terminalAt,
				},
			],
			chainRows: [
				chainRow(1, {
					approvalRequestId: null,
					status,
					decidedAt: terminalAt,
				}),
			],
		});

		await expect(
			captureAbsenceLegacyApprovalState({
				dbService: fake.dbService,
				organizationId: "org-1",
				absenceId,
				capturedAt,
			}),
		).rejects.toMatchObject({
			name: "AbsenceLegacyStateCaptureError",
			code: "malformed_evidence",
		});
	});

	it("allows null request links for never-activated and cancellation-cleared rows", async () => {
		const pending = database({
			source,
			approvalRequests: [request],
			chains: [{ ...chain, currentStageOrder: 1 }],
			chainRows: [
				chainRow(1, { status: "pending", decidedBy: null, decidedAt: null }),
				chainRow(2, {
					approvalRequestId: null,
					status: "pending",
				}),
				chainRow(3, {
					approvalRequestId: null,
					status: "cancelled",
				}),
			],
		});
		const cancelled = database({
			source,
			approvalRequests: [],
			chains: [
				{
					...chain,
					currentStageOrder: 1,
					status: "cancelled",
					completedAt: request.updatedAt,
				},
			],
			chainRows: [
				chainRow(1, {
					approvalRequestId: null,
					status: "cancelled",
					decidedBy: null,
					decidedAt: null,
				}),
			],
		});

		const pendingState = await captureAbsenceLegacyApprovalState({
			dbService: pending.dbService,
			organizationId: "org-1",
			absenceId,
			capturedAt,
		});
		const cancelledState = await captureAbsenceLegacyApprovalState({
			dbService: cancelled.dbService,
			organizationId: "org-1",
			absenceId,
			capturedAt,
		});

		expect(pendingState.chainRows[1]).toMatchObject({
			status: "pending",
			approvalRequestId: null,
		});
		expect(pendingState.chainRows[2]).toMatchObject({
			status: "cancelled",
			approvalRequestId: null,
		});
		expect(cancelledState.chainRows[0]).toMatchObject({
			status: "cancelled",
			approvalRequestId: null,
		});
	});

	it("wraps query failures without exposing the driver error", async () => {
		const driverError = new Error("relation absence_entry contains secret SQL");
		const dbService = {
			db: { execute: async () => Promise.reject(driverError) },
		} as ApprovalDbService;

		try {
			await captureAbsenceLegacyApprovalState({
				dbService,
				organizationId: "org-1",
				absenceId,
				capturedAt,
			});
			expect.unreachable("capture should reject");
		} catch (error) {
			expect(error).toMatchObject({
				name: "AbsenceLegacyStateCaptureError",
				code: "query_failed",
				message: "Absence legacy approval state capture failed",
			});
			expect(error).not.toHaveProperty("cause");
			expect(String(error)).not.toContain("absence_entry");
			expect(String(error)).not.toContain("secret SQL");
		}
	});

	it("allows cancellation-cleared earlier rows in a cancelled chain", async () => {
		const fake = database({
			source,
			approvalRequests: [],
			chains: [
				{ ...chain, status: "cancelled", completedAt: request.updatedAt },
			],
			chainRows: [
				chainRow(1, {
					approvalRequestId: null,
					status: "cancelled",
					decidedBy: null,
					decidedAt: null,
				}),
				chainRow(2, {
					approvalRequestId: null,
					status: "cancelled",
				}),
			],
		});

		const state = await captureAbsenceLegacyApprovalState({
			dbService: fake.dbService,
			organizationId: "org-1",
			absenceId,
			capturedAt,
		});

		expect(state.chain?.status).toBe("cancelled");
		expect(state.chainRows.every((row) => row.status === "cancelled")).toBe(
			true,
		);
	});

	it.each([
		["absence employee", employeeId],
		["request approver", request.approverId],
		["resolved stage approver", "60000000-0000-4000-8000-000000000002"],
	] as const)("rejects missing organization ownership for %s", async (_name, missingId) => {
		const envelope = {
			source,
			approvalRequests: [
				{
					...request,
					id: secondRequestId,
					approverId: "60000000-0000-4000-8000-000000000002",
				},
				{
					...request,
					status: "approved",
					approvedAt: request.updatedAt,
				},
			],
			chains: [chain],
			chainRows: [chainRow(1), chainRow(2)],
		};
		const evidence = identityEvidence(envelope);
		const fake = database({
			...envelope,
			identityEvidence: {
				...evidence,
				employees: evidence.employees.filter((row) => row.id !== missingId),
			},
		});

		await expect(
			captureAbsenceLegacyApprovalState({
				dbService: fake.dbService,
				organizationId: "org-1",
				absenceId,
				capturedAt,
			}),
		).rejects.toMatchObject({
			name: "AbsenceLegacyStateCaptureError",
			code: "malformed_evidence",
		});
	});

	it("rejects foreign organization identity evidence and a missing category", async () => {
		const envelope = {
			source,
			approvalRequests: [request],
			chains: [],
			chainRows: [],
		};
		const evidence = identityEvidence(envelope);
		const foreign = database({
			...envelope,
			identityEvidence: {
				...evidence,
				employees: evidence.employees.map((row) => ({
					...row,
					organizationId: "org-2",
				})),
			},
		});
		const missingCategory = database({
			...envelope,
			identityEvidence: { ...evidence, categories: [] },
		});

		for (const dbService of [foreign.dbService, missingCategory.dbService]) {
			await expect(
				captureAbsenceLegacyApprovalState({
					dbService,
					organizationId: "org-1",
					absenceId,
					capturedAt,
				}),
			).rejects.toMatchObject({
				name: "AbsenceLegacyStateCaptureError",
				code: "malformed_evidence",
			});
		}
	});

	it("rejects a foreign approvedBy actor omitted from scoped identity evidence", async () => {
		const approvedBy = "c0000000-0000-4000-8000-000000000001";
		const envelope = {
			source: {
				...source,
				status: "approved",
				approvedBy,
				approvedAt: request.updatedAt,
			},
			approvalRequests: [
				{
					...request,
					status: "approved",
					approvedAt: request.updatedAt,
				},
			],
			chains: [],
			chainRows: [],
		};
		const evidence = identityEvidence(envelope);
		const fake = database({
			...envelope,
			identityEvidence: {
				...evidence,
				employees: evidence.employees.filter((row) => row.id !== approvedBy),
			},
		});

		await expect(
			captureAbsenceLegacyApprovalState({
				dbService: fake.dbService,
				organizationId: "org-1",
				absenceId,
				capturedAt,
			}),
		).rejects.toMatchObject({
			name: "AbsenceLegacyStateCaptureError",
			code: "malformed_evidence",
		});
	});

	it("allows an approved prefix followed by cancellation-cleared rows", async () => {
		const fake = database({
			source,
			approvalRequests: [
				{
					...request,
					status: "approved",
					approvedAt: request.updatedAt,
				},
			],
			chains: [
				{ ...chain, status: "cancelled", completedAt: request.updatedAt },
			],
			chainRows: [
				chainRow(1),
				chainRow(2, {
					approvalRequestId: null,
					status: "cancelled",
				}),
			],
		});

		const state = await captureAbsenceLegacyApprovalState({
			dbService: fake.dbService,
			organizationId: "org-1",
			absenceId,
			capturedAt,
		});

		expect(state.chainRows.map((row) => row.status)).toEqual([
			"approved",
			"cancelled",
		]);
	});

	it("accepts approved source evidence with a cancelled chain root and unchanged approved rows", async () => {
		const completedAt = new Date("2026-07-18T08:50:00.000Z");
		const approvedRequests = [
			{
				...request,
				status: "approved",
				approvedAt: request.updatedAt,
			},
			{
				...request,
				id: secondRequestId,
				approverId: "60000000-0000-4000-8000-000000000002",
				status: "approved",
				approvedAt: completedAt,
				updatedAt: completedAt,
			},
		];
		const fake = database({
			source: {
				...source,
				status: "approved",
				approvedBy: employeeId,
				approvedAt: completedAt,
			},
			approvalRequests: approvedRequests,
			chains: [
				{
					...chain,
					status: "cancelled",
					completedAt,
					updatedAt: completedAt,
				},
			],
			chainRows: [
				chainRow(1),
				chainRow(2, {
					status: "approved",
					decidedBy: employeeId,
					decidedAt: completedAt,
					updatedAt: completedAt,
				}),
			],
		});

		const state = await captureAbsenceLegacyApprovalState({
			dbService: fake.dbService,
			organizationId: "org-1",
			absenceId,
			capturedAt,
		});

		expect(state.sourceSnapshot.status).toBe("approved");
		expect(state.chain?.status).toBe("cancelled");
		expect(state.chainRows.every((row) => row.status === "approved")).toBe(
			true,
		);
		expect(state.approvalRequest?.status).toBe("approved");
	});

	it("rejects approved-source cancellation evidence with mixed approved and cleared rows", async () => {
		const completedAt = new Date("2026-07-18T08:50:00.000Z");
		const fake = database({
			source: {
				...source,
				status: "approved",
				approvedBy: employeeId,
				approvedAt: completedAt,
			},
			approvalRequests: [
				{
					...request,
					status: "approved",
					approvedAt: request.updatedAt,
				},
			],
			chains: [{ ...chain, status: "cancelled", completedAt }],
			chainRows: [
				chainRow(1),
				chainRow(2, {
					approvalRequestId: null,
					status: "cancelled",
				}),
			],
		});

		await expect(
			captureAbsenceLegacyApprovalState({
				dbService: fake.dbService,
				organizationId: "org-1",
				absenceId,
				capturedAt,
			}),
		).rejects.toMatchObject({ code: "malformed_evidence" });
	});

	it("rejects an approved row after cancellation clearing has begun", async () => {
		const fake = database({
			source,
			approvalRequests: [
				{
					...request,
					id: secondRequestId,
					approverId: "60000000-0000-4000-8000-000000000002",
					status: "approved",
					approvedAt: request.updatedAt,
				},
			],
			chains: [
				{
					...chain,
					currentStageOrder: 3,
					status: "cancelled",
					completedAt: request.updatedAt,
				},
			],
			chainRows: [
				chainRow(1, {
					approvalRequestId: null,
					status: "cancelled",
					decidedBy: null,
					decidedAt: null,
				}),
				chainRow(2, {
					status: "approved",
					decidedBy: employeeId,
					decidedAt: request.updatedAt,
				}),
				chainRow(3, {
					approvalRequestId: null,
					status: "cancelled",
				}),
			],
		});

		await expect(
			captureAbsenceLegacyApprovalState({
				dbService: fake.dbService,
				organizationId: "org-1",
				absenceId,
				capturedAt,
			}),
		).rejects.toMatchObject({
			name: "AbsenceLegacyStateCaptureError",
			code: "malformed_evidence",
		});
	});

	it.each([
		{
			name: "pending chain with a non-approved earlier row",
			envelope: {
				source,
				approvalRequests: [
					{
						...request,
						id: secondRequestId,
						approverId: "60000000-0000-4000-8000-000000000002",
					},
				],
				chains: [chain],
				chainRows: [
					chainRow(1, {
						approvalRequestId: null,
						status: "cancelled",
						decidedBy: null,
						decidedAt: null,
					}),
					chainRow(2),
				],
			},
		},
		{
			name: "pending chain with an approved current row",
			envelope: {
				source,
				approvalRequests: [
					{
						...request,
						status: "approved",
						approvedAt: request.updatedAt,
					},
				],
				chains: [{ ...chain, currentStageOrder: 1 }],
				chainRows: [chainRow(1)],
			},
		},
		{
			name: "pending chain with an activated later row",
			envelope: {
				source,
				approvalRequests: [
					request,
					{
						...request,
						id: secondRequestId,
						approverId: "60000000-0000-4000-8000-000000000002",
						status: "approved",
						approvedAt: request.updatedAt,
					},
				],
				chains: [{ ...chain, currentStageOrder: 1 }],
				chainRows: [
					chainRow(1, { status: "pending", decidedBy: null, decidedAt: null }),
					chainRow(2, {
						status: "approved",
						decidedBy: employeeId,
						decidedAt: request.updatedAt,
					}),
				],
			},
		},
		{
			name: "approved chain with a non-approved row",
			envelope: {
				source: {
					...source,
					status: "approved",
					approvedBy: employeeId,
					approvedAt: request.updatedAt,
				},
				approvalRequests: [
					{
						...request,
						status: "approved",
						approvedAt: request.updatedAt,
					},
				],
				chains: [
					{ ...chain, status: "approved", completedAt: request.updatedAt },
				],
				chainRows: [
					chainRow(1),
					chainRow(2, { approvalRequestId: null, status: "cancelled" }),
				],
			},
		},
		{
			name: "rejected chain with a later approved row",
			envelope: {
				source: { ...source, status: "rejected", rejectionReason: "Rejected" },
				approvalRequests: [
					{ ...request, status: "rejected", rejectionReason: "Rejected" },
					{
						...request,
						id: secondRequestId,
						approverId: "60000000-0000-4000-8000-000000000002",
						status: "approved",
						approvedAt: request.updatedAt,
					},
				],
				chains: [
					{
						...chain,
						currentStageOrder: 1,
						status: "rejected",
						completedAt: request.updatedAt,
					},
				],
				chainRows: [
					chainRow(1, { status: "rejected" }),
					chainRow(2, {
						status: "approved",
						decidedBy: employeeId,
						decidedAt: request.updatedAt,
					}),
				],
			},
		},
		{
			name: "cancelled chain with approved current evidence",
			envelope: {
				source,
				approvalRequests: [
					{
						...request,
						status: "approved",
						approvedAt: request.updatedAt,
					},
				],
				chains: [
					{
						...chain,
						currentStageOrder: 1,
						status: "cancelled",
						completedAt: request.updatedAt,
					},
				],
				chainRows: [chainRow(1)],
			},
		},
	])("rejects incoherent lifecycle: $name", async ({ envelope }) => {
		const fake = database(envelope);

		await expect(
			captureAbsenceLegacyApprovalState({
				dbService: fake.dbService,
				organizationId: "org-1",
				absenceId,
				capturedAt,
			}),
		).rejects.toMatchObject({
			name: "AbsenceLegacyStateCaptureError",
			code: "malformed_evidence",
		});
	});
});
