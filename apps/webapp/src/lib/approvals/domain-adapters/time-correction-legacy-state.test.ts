import { PgDialect, type SQL } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { ApprovalDbService } from "../server/types";
import { createLegacyApprovalObservationPlanner } from "../workflow/legacy-observation-planner";
import type {
	LegacyApprovalRequestSnapshot,
	VerifiedLegacyApprovalState,
} from "../workflow/ports";
import type { TimeCorrectionWorkflowPayload } from "./time-correction-contract";
import { captureTimeCorrectionLegacyApprovalState } from "./time-correction-legacy-state";

const organizationId = "org-1";
const workPeriodId = "10000000-0000-4000-8000-000000000001";
const employeeId = "20000000-0000-4000-8000-000000000001";
const approverId = "20000000-0000-4000-8000-000000000002";
const secondApproverId = "20000000-0000-4000-8000-000000000003";
const canonicalRecordId = "30000000-0000-4000-8000-000000000001";
const clockInId = "40000000-0000-4000-8000-000000000001";
const clockOutId = "40000000-0000-4000-8000-000000000002";
const clockInCorrectionId = "50000000-0000-4000-8000-000000000001";
const clockOutCorrectionId = "50000000-0000-4000-8000-000000000002";
const priorClockInCorrectionId = "50000000-0000-4000-8000-000000000003";
const priorClockOutCorrectionId = "50000000-0000-4000-8000-000000000004";
const requestId = "60000000-0000-4000-8000-000000000001";
const secondRequestId = "60000000-0000-4000-8000-000000000002";
const chainId = "70000000-0000-4000-8000-000000000001";
const capturedAt = parseInstant("2026-07-20T20:00:00Z");
const submittedAt = new Date("2026-07-20T08:30:00.000Z");

type JsonRecord = Record<string, unknown>;

function entry(overrides: JsonRecord = {}) {
	return {
		id: clockInId,
		organizationId,
		employeeId,
		type: "clock_in",
		timestamp: new Date("2026-07-20T06:00:00.000Z"),
		utcOffsetMinutes: 120,
		timezone: "Europe/Berlin",
		timezoneSource: "browser",
		replacesEntryId: null,
		isSuperseded: false,
		supersededById: null,
		isDeleted: false,
		...overrides,
	};
}

function source(overrides: JsonRecord = {}) {
	return {
		id: workPeriodId,
		organizationId,
		employeeId,
		clockInId,
		clockOutId,
		startTime: new Date("2026-07-20T06:00:00.000Z"),
		endTime: new Date("2026-07-20T16:00:00.000Z"),
		durationMinutes: 600,
		isActive: false,
		approvalStatus: "approved",
		pendingChanges: null,
		deletedAt: null,
		canonicalRecordId,
		approvalWorkflowId: null,
		...overrides,
	};
}

function canonicalRecord(overrides: JsonRecord = {}) {
	return {
		id: canonicalRecordId,
		organizationId,
		employeeId,
		recordKind: "work",
		startAt: new Date("2026-07-20T06:00:00.000Z"),
		endAt: new Date("2026-07-20T16:00:00.000Z"),
		durationMinutes: 600,
		approvalState: "approved",
		...overrides,
	};
}

function currentEndpoints(overrides: JsonRecord = {}) {
	return {
		clockIn: entry(),
		clockOut: entry({
			id: clockOutId,
			type: "clock_out",
			timestamp: new Date("2026-07-20T16:00:00.000Z"),
			utcOffsetMinutes: -240,
			timezone: "America/New_York",
			timezoneSource: "user_setting",
		}),
		...overrides,
	};
}

function correction(
	endpointType: "clock_in" | "clock_out",
	overrides: JsonRecord = {},
) {
	const clockOut = endpointType === "clock_out";
	return entry({
		endpointType,
		id: clockOut ? clockOutCorrectionId : clockInCorrectionId,
		type: "correction",
		timestamp: new Date(
			clockOut ? "2026-07-20T15:00:00.000Z" : "2026-07-20T05:30:00.000Z",
		),
		utcOffsetMinutes: clockOut ? -240 : 120,
		timezone: clockOut ? "America/New_York" : "Europe/Berlin",
		timezoneSource: clockOut ? "manager_target_user_setting" : "browser",
		replacesEntryId: clockOut ? clockOutId : clockInId,
		isSuperseded: true,
		supersededById: null,
		notes: "private correction note",
		...overrides,
	});
}

function original(
	endpointType: "clock_in" | "clock_out",
	overrides: JsonRecord = {},
) {
	return entry(
		endpointType === "clock_in"
			? overrides
			: {
					id: clockOutId,
					type: "clock_out",
					timestamp: new Date("2026-07-20T16:00:00.000Z"),
					utcOffsetMinutes: -240,
					timezone: "America/New_York",
					timezoneSource: "user_setting",
					...overrides,
				},
	);
}

function request(
	metadata: unknown = {
		timeCorrection: { action: "edit", clockInCorrectionId },
	},
	overrides: JsonRecord = {},
) {
	return {
		id: requestId,
		organizationId,
		entityType: "time_entry",
		entityId: workPeriodId,
		requestedBy: employeeId,
		approverId,
		status: "pending",
		reason: "raw private reason",
		rejectionReason: null,
		approvedAt: null,
		metadata,
		updatedAt: submittedAt,
		...overrides,
	};
}

function chain(overrides: JsonRecord = {}) {
	return {
		id: chainId,
		organizationId,
		policyId: "80000000-0000-4000-8000-000000000001",
		policyNameSnapshot: "Two-stage correction",
		entityType: "time_entry",
		entityId: workPeriodId,
		requesterEmployeeId: employeeId,
		currentStageOrder: 1,
		status: "pending",
		createdAt: new Date("2026-07-20T08:00:00.000Z"),
		updatedAt: submittedAt,
		completedAt: null,
		...overrides,
	};
}

function stage(stepOrder: number, overrides: JsonRecord = {}) {
	return {
		id: `90000000-0000-4000-8000-00000000000${stepOrder}`,
		organizationId,
		chainInstanceId: chainId,
		policyStageId: `a0000000-0000-4000-8000-00000000000${stepOrder}`,
		stepOrder,
		labelSnapshot: `Stage ${stepOrder}`,
		approverTypeSnapshot: "specific_employee",
		resolvedApproverEmployeeId: stepOrder === 1 ? approverId : secondApproverId,
		approvalRequestId: stepOrder === 1 ? requestId : null,
		status: stepOrder === 1 ? "pending" : "cancelled",
		decidedBy: null,
		decidedAt: null,
		createdAt: new Date(`2026-07-20T08:0${stepOrder}:00.000Z`),
		updatedAt: submittedAt,
		...overrides,
	};
}

function employeesFor(envelope: JsonRecord) {
	const ids = new Set([employeeId]);
	for (const approval of (envelope.approvalRequests ?? []) as JsonRecord[]) {
		if (typeof approval.requestedBy === "string") ids.add(approval.requestedBy);
		if (typeof approval.approverId === "string") ids.add(approval.approverId);
	}
	for (const item of (envelope.chains ?? []) as JsonRecord[]) {
		if (typeof item.requesterEmployeeId === "string") {
			ids.add(item.requesterEmployeeId);
		}
	}
	for (const row of (envelope.chainRows ?? []) as JsonRecord[]) {
		if (typeof row.resolvedApproverEmployeeId === "string") {
			ids.add(row.resolvedApproverEmployeeId);
		}
		if (typeof row.decidedBy === "string") ids.add(row.decidedBy);
	}
	return [...ids].map((id) => ({ id, organizationId }));
}

function asPostgresTimestampStrings(value: unknown): unknown {
	if (value instanceof Date) {
		return value.toISOString().replace("T", " ").replace("Z", "");
	}
	if (Array.isArray(value)) return value.map(asPostgresTimestampStrings);
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				asPostgresTimestampStrings(item),
			]),
		);
	}
	return value;
}

function envelope(overrides: JsonRecord = {}) {
	const value = {
		source: source(),
		canonicalRecord: canonicalRecord(),
		currentEndpoints: currentEndpoints(),
		currentEndpointPredecessors: [],
		approvalRequests: [request()],
		chains: [],
		chainRows: [],
		correctionEntries: [correction("clock_in")],
		originalEntries: [original("clock_in")],
		...overrides,
	};
	return {
		...value,
		identityEvidence: overrides.identityEvidence ?? {
			employees: employeesFor(value),
		},
	};
}

function database(value: JsonRecord) {
	const calls: SQL[] = [];
	const dbService = {
		db: {
			execute: async (query: SQL) => {
				calls.push(query);
				const approvals = (value.approvalRequests ?? []) as JsonRecord[];
				const chains = (value.chains ?? []) as JsonRecord[];
				const chainRows = (value.chainRows ?? []) as JsonRecord[];
				const stageRequestIds = new Set(
					chainRows.map((row) => row.approvalRequestId),
				);
				const queryParams = new PgDialect().sqlToQuery(query).params;
				const expectedRequestId = queryParams[4];
				const expectedChainId = queryParams[5];
				return {
					rows: [
						{
							...value,
							selectionEvidence: {
								pendingRequestCount: approvals.filter(
									(request) => request.status === "pending",
								).length,
								pendingChainCount: chains.filter(
									(chain) => chain.status === "pending",
								).length,
								eligiblePendingDirectRequestCount: approvals.filter(
									(request) =>
										request.status === "pending" &&
										!stageRequestIds.has(request.id),
								).length,
								selectedRequestCount: approvals.length,
								selectedChainCount: chains.length,
								expectedRequestCount: approvals.filter(
									(request) => request.id === expectedRequestId,
								).length,
								expectedChainCount: chains.filter(
									(chain) => chain.id === expectedChainId,
								).length,
								...((value.selectionEvidence as JsonRecord | undefined) ?? {}),
							},
						},
					],
				};
			},
		},
	} as unknown as ApprovalDbService;
	return { calls, dbService };
}

async function capture(
	value: JsonRecord,
	expectedCorrection?: TimeCorrectionWorkflowPayload["timeCorrection"],
	expectedLegacyCycle?: {
		approvalRequestId?: string;
		chainInstanceId?: string;
	},
	priorVerifiedDirectRequest?: Pick<
		VerifiedLegacyApprovalState,
		"approvalRequest" | "chain" | "chainRows"
	>,
	allowCancelledReplayWithoutCorrectionRows = false,
) {
	const fake = database(value);
	return {
		fake,
		state: await captureTimeCorrectionLegacyApprovalState({
			dbService: fake.dbService,
			organizationId,
			workPeriodId,
			capturedAt,
			expectedCorrection,
			expectedLegacyCycle,
			priorVerifiedDirectRequest,
			allowCancelledReplayWithoutCorrectionRows,
		}),
	};
}

function approvedEnvelope(
	metadata: unknown,
	endpoints: Array<"clock_in" | "clock_out">,
) {
	const approvedAt = new Date("2026-07-20T09:00:00.000Z");
	const corrections = endpoints.map((endpointType) =>
		correction(endpointType, { isSuperseded: false }),
	);
	const originals = endpoints.map((endpointType) => {
		const correctionId =
			endpointType === "clock_in" ? clockInCorrectionId : clockOutCorrectionId;
		return original(endpointType, {
			isSuperseded: true,
			supersededById: correctionId,
		});
	});
	const clockIn = endpoints.includes("clock_in")
		? correction("clock_in", { isSuperseded: false })
		: original("clock_in");
	const clockOut = endpoints.includes("clock_out")
		? correction("clock_out", { isSuperseded: false })
		: original("clock_out");
	return envelope({
		source: source({
			clockInId: clockIn.id,
			clockOutId: clockOut.id,
			startTime: clockIn.timestamp,
			endTime: clockOut.timestamp,
			durationMinutes: endpoints.includes("clock_in") ? 630 : 540,
			approvalStatus: "approved",
		}),
		canonicalRecord: canonicalRecord({
			startAt: clockIn.timestamp,
			endAt: clockOut.timestamp,
			durationMinutes: endpoints.includes("clock_in") ? 630 : 540,
			approvalState: "approved",
		}),
		currentEndpoints: { clockIn, clockOut },
		currentEndpointPredecessors: originals,
		approvalRequests: [
			request(metadata, {
				status: "approved",
				approvedAt,
				updatedAt: approvedAt,
			}),
		],
		correctionEntries: corrections,
		originalEntries: originals,
	});
}

function laterCycleEnvelope(overrides: JsonRecord = {}) {
	const priorClockIn = correction("clock_in", {
		id: priorClockInCorrectionId,
		timestamp: new Date("2026-07-20T05:45:00.000Z"),
		replacesEntryId: clockInId,
		isSuperseded: false,
	});
	const priorClockOut = correction("clock_out", {
		id: priorClockOutCorrectionId,
		timestamp: new Date("2026-07-20T15:30:00.000Z"),
		replacesEntryId: clockOutId,
		isSuperseded: false,
	});
	const baseClockIn = original("clock_in", {
		isSuperseded: true,
		supersededById: priorClockInCorrectionId,
	});
	const baseClockOut = original("clock_out", {
		isSuperseded: true,
		supersededById: priorClockOutCorrectionId,
	});
	const newClockIn = correction("clock_in", {
		replacesEntryId: priorClockInCorrectionId,
	});
	const newClockOut = correction("clock_out", {
		replacesEntryId: priorClockOutCorrectionId,
	});
	return envelope({
		source: source({
			clockInId: priorClockInCorrectionId,
			clockOutId: priorClockOutCorrectionId,
			startTime: priorClockIn.timestamp,
			endTime: priorClockOut.timestamp,
			durationMinutes: 585,
		}),
		canonicalRecord: canonicalRecord({
			startAt: priorClockIn.timestamp,
			endAt: priorClockOut.timestamp,
			durationMinutes: 585,
		}),
		currentEndpoints: {
			clockIn: priorClockIn,
			clockOut: priorClockOut,
		},
		currentEndpointPredecessors: [baseClockIn, baseClockOut],
		approvalRequests: [
			request({
				timeCorrection: {
					action: "edit",
					clockInCorrectionId,
					clockOutCorrectionId,
				},
			}),
		],
		correctionEntries: [newClockIn, newClockOut],
		originalEntries: [priorClockIn, priorClockOut],
		...overrides,
	});
}

describe("captureTimeCorrectionLegacyApprovalState", () => {
	it.each([
		["manual request payload", { type: "manual_entry", startedAt: "08:00" }],
		[
			"policy request payload",
			{ policyId: "80000000-0000-4000-8000-000000000001", action: "submit" },
		],
	] as const)("rejects non-null pendingChanges from an ordinary %s", async (_label, pendingChanges) => {
		await expect(
			capture(envelope({ source: source({ pendingChanges }) })),
		).rejects.toMatchObject({
			name: "TimeCorrectionLegacyStateCaptureError",
		});
	});

	it("captures a later cycle whose logical endpoints are active correction rows", async () => {
		const { fake, state } = await capture(laterCycleEnvelope());

		expect(state.sourceSnapshot).toMatchObject({
			status: "pending",
			currentEndpoints: {
				clockIn: {
					id: priorClockInCorrectionId,
					type: "correction",
					replacesEntryId: clockInId,
					timezone: "Europe/Berlin",
				},
				clockOut: {
					id: priorClockOutCorrectionId,
					type: "correction",
					replacesEntryId: clockOutId,
					timezone: "America/New_York",
				},
			},
			correctionEndpoints: [
				{
					endpointType: "clock_in",
					originalEntryId: priorClockInCorrectionId,
				},
				{
					endpointType: "clock_out",
					originalEntryId: priorClockOutCorrectionId,
				},
			],
		});
		const query = new PgDialect().sqlToQuery(fake.calls[0]);
		expect(query.sql).toContain("current_endpoint_predecessor_rows");
	});

	it("rejects a later cycle that replaces a non-current historical endpoint", async () => {
		const value = laterCycleEnvelope();
		const corrections = value.correctionEntries as JsonRecord[];
		const clockIn = corrections.find(
			(candidate) => candidate.endpointType === "clock_in",
		);
		if (!clockIn) throw new Error("Invalid test fixture");
		clockIn.replacesEntryId = clockInId;

		await expect(capture(value)).rejects.toMatchObject({
			name: "TimeCorrectionLegacyStateCaptureError",
		});
	});

	it("captures one exact transaction-scoped statement and detached private/display evidence", async () => {
		const raw = envelope();
		const { fake, state } = await capture(raw);

		expect(fake.calls).toHaveLength(1);
		const query = new PgDialect().sqlToQuery(fake.calls[0]);
		expect(query.params).toEqual([
			organizationId,
			"time_entry",
			workPeriodId,
			null,
			null,
			null,
		]);
		expect(query.sql).toContain(
			"period.organization_id = capture.organization_id",
		);
		expect(query.sql).toContain("period.employee_id = employee.id");
		expect(query.sql).toContain(
			"employee.organization_id = capture.organization_id",
		);
		expect(query.sql).toContain('record.employee_id = period."employeeId"');
		expect(query.sql).toContain("record.record_kind = 'work'");
		expect(query.sql).toContain("request.entity_id = capture.entity_id");
		expect(query.sql).toContain("correction.id::text = payload.correction_id");
		expect(query.sql).toContain('correction.employee_id = period."employeeId"');
		expect(query.sql).toContain('original.id = correction."replacesEntryId"');
		expect(query.sql).toContain("stage.chain_instance_id = chain.id");
		expect(query.sql).toContain(
			"select distinct\n\t\t\t\t\tpayload.endpoint_type",
		);

		expect(state).toMatchObject({
			organizationId,
			source: {
				organizationId,
				workflowType: "time_correction",
				sourceType: "time_entry",
				sourceId: workPeriodId,
			},
			approvalRequest: {
				id: requestId,
				metadata: {
					timeCorrection: { action: "edit", clockInCorrectionId },
				},
			},
			chain: null,
			chainRows: [],
			sourceSnapshot: {
				id: workPeriodId,
				status: "pending",
				timeCorrection: { action: "edit", clockInCorrectionId },
				correctionEndpoints: [
					{
						endpointType: "clock_in",
						originalEntryId: clockInId,
						correctionEntryId: clockInCorrectionId,
						instant: "2026-07-20T05:30:00Z",
						utcOffsetMinutes: 120,
						timezone: "Europe/Berlin",
						timezoneSource: "browser",
					},
				],
			},
			displaySnapshot: {
				status: "pending",
				workPeriod: { id: workPeriodId },
				labels: {
					title: "Time correction",
					action: "edit",
					endpoints: ["Clock in"],
				},
			},
			capturedAt,
		});

		const serializedDisplay = JSON.stringify(state.displaySnapshot);
		for (const privateValue of [
			clockInCorrectionId,
			clockInId,
			"raw private reason",
			"private correction note",
			"Europe/Berlin",
			"browser",
		]) {
			expect(serializedDisplay).not.toContain(privateValue);
		}
		(raw.correctionEntries as JsonRecord[])[0].timezone = "UTC";
		(
			(raw.approvalRequests as JsonRecord[])[0].metadata as JsonRecord
		).timeCorrection = {};
		expect(state.sourceSnapshot.correctionEndpoints).toMatchObject([
			{ timezone: "Europe/Berlin" },
		]);
		expect(state.approvalRequest?.metadata).toEqual({
			timeCorrection: { action: "edit", clockInCorrectionId },
		});
	});

	it("captures a scoped source with no request without discovering unrelated inactive rows", async () => {
		const { state } = await capture(
			envelope({
				source: source({ approvalStatus: "approved" }),
				canonicalRecord: canonicalRecord({ approvalState: "approved" }),
				approvalRequests: [],
				correctionEntries: [],
				originalEntries: [],
			}),
		);

		expect(state.approvalRequest).toBeNull();
		expect(state.sourceSnapshot).not.toHaveProperty("timeCorrection");
		expect(state.sourceSnapshot.correctionEndpoints).toEqual([]);
	});

	it("carries exact trusted correction evidence across request disappearance for cancellation observation", async () => {
		const before = await capture(envelope());
		const expectedCorrection = before.state.sourceSnapshot
			.timeCorrection as unknown as TimeCorrectionWorkflowPayload["timeCorrection"];
		const afterValue = envelope({ approvalRequests: [] });
		afterValue.identityEvidence = {
			employees: [{ id: employeeId, organizationId }],
		};

		const after = await capture(
			afterValue,
			expectedCorrection,
			{ approvalRequestId: requestId },
			before.state,
		);

		expect(after.state.approvalRequest).toBeNull();
		expect(after.state.sourceSnapshot).toMatchObject({
			timeCorrection: { action: "edit", clockInCorrectionId },
			correctionEndpoints: [{ correctionEntryId: clockInCorrectionId }],
		});
		expect(JSON.stringify(after.state.displaySnapshot)).not.toContain(
			clockInCorrectionId,
		);
		expect(after.fake.calls).toHaveLength(1);
		const afterQuery = new PgDialect().sqlToQuery(after.fake.calls[0]);
		expect(afterQuery.params).toEqual([
			organizationId,
			"time_entry",
			workPeriodId,
			JSON.stringify({ timeCorrection: expectedCorrection }),
			requestId,
			null,
		]);

		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const plan = await planner.plan({
			organizationId,
			source: before.state.source,
			before: before.state,
			after: after.state,
			actor: { kind: "legacy_unknown", employeeId: null, userId: null },
			idempotencyKey: "cancel-after-request-disappearance",
			expectedVersion: 1,
		});
		expect(plan.snapshot.status).toBe("cancelled");
	});

	it("rejects a missing direct request ID without its prior verified request", async () => {
		const before = await capture(envelope());
		const expectedCorrection = before.state.sourceSnapshot
			.timeCorrection as unknown as TimeCorrectionWorkflowPayload["timeCorrection"];
		const afterValue = envelope({ approvalRequests: [] });
		afterValue.identityEvidence = {
			employees: [{ id: employeeId, organizationId }],
		};

		await expect(
			capture(afterValue, expectedCorrection, {
				approvalRequestId: secondRequestId,
			}),
		).rejects.toMatchObject({ name: "TimeCorrectionLegacyStateCaptureError" });
	});

	it.each([
		["organization", { organizationId: "org-2" }],
		["source", { entityId: "10000000-0000-4000-8000-000000000002" }],
		["requester", { requestedBy: secondApproverId }],
		["status", { status: "approved", approvedAt: capturedAt }],
		[
			"metadata",
			{
				metadata: {
					timeCorrection: { action: "edit", clockOutCorrectionId },
				},
			},
		],
		["request ID", { id: secondRequestId }],
	] as const)("rejects prior direct request evidence with mismatched %s", async (_name, requestOverrides) => {
		const before = await capture(envelope());
		const expectedCorrection = before.state.sourceSnapshot
			.timeCorrection as unknown as TimeCorrectionWorkflowPayload["timeCorrection"];
		const afterValue = envelope({ approvalRequests: [] });
		afterValue.identityEvidence = {
			employees: [{ id: employeeId, organizationId }],
		};
		const approvalRequest = before.state.approvalRequest;
		expect(approvalRequest).not.toBeNull();
		if (!approvalRequest) throw new Error("Expected direct approval request");
		const priorVerifiedDirectRequest = {
			approvalRequest: {
				...approvalRequest,
				...requestOverrides,
			} as LegacyApprovalRequestSnapshot,
			chain: before.state.chain,
			chainRows: before.state.chainRows,
		};

		await expect(
			capture(
				afterValue,
				expectedCorrection,
				{ approvalRequestId: requestId },
				priorVerifiedDirectRequest,
			),
		).rejects.toMatchObject({ name: "TimeCorrectionLegacyStateCaptureError" });
	});

	it("rejects chain-owned request evidence carried as a direct request", async () => {
		const chainBeforeValue = envelope({
			chains: [chain()],
			chainRows: [stage(1), stage(2)],
		});
		chainBeforeValue.identityEvidence = {
			employees: employeesFor(chainBeforeValue),
		};
		const before = await capture(chainBeforeValue);
		const expectedCorrection = before.state.sourceSnapshot
			.timeCorrection as unknown as TimeCorrectionWorkflowPayload["timeCorrection"];
		const afterValue = envelope({ approvalRequests: [] });
		afterValue.identityEvidence = {
			employees: [{ id: employeeId, organizationId }],
		};

		await expect(
			capture(
				afterValue,
				expectedCorrection,
				{ approvalRequestId: requestId },
				before.state,
			),
		).rejects.toMatchObject({ name: "TimeCorrectionLegacyStateCaptureError" });
	});

	it("captures an exact requester-cancelled direct tombstone without correction rows", async () => {
		const cancelledAt = new Date("2026-07-20T09:00:00.000Z");
		const metadata = {
			timeCorrection: { action: "edit", clockInCorrectionId },
			submission: {
				key: "submission-1",
				resultKind: "default_created",
				originalStatus: "pending",
			},
			cancellation: {
				kind: "requester",
				organizationId,
				requesterEmployeeId: employeeId,
				requesterUserId: "user-requester",
				workPeriodId,
				chainInstanceId: null,
				cancelledAt: cancelledAt.toISOString(),
			},
		};
		const value = envelope({
			approvalRequests: [
				request(metadata, {
					status: "rejected",
					rejectionReason: null,
					approvedAt: cancelledAt,
				}),
			],
			correctionEntries: [],
			originalEntries: [],
		});

		const result = await capture(
			value,
			{ action: "edit", clockInCorrectionId },
			{ approvalRequestId: requestId },
			undefined,
			true,
		);

		expect(result.state.approvalRequest).toMatchObject({
			id: requestId,
			status: "rejected",
			metadata,
		});
		expect(result.state.sourceSnapshot.status).toBe("cancelled");
	});

	it("rejects requestless pending capture without trusted expected correction evidence", async () => {
		const value = envelope({
			source: source({ approvalStatus: "pending" }),
			canonicalRecord: canonicalRecord({ approvalState: "pending" }),
			approvalRequests: [],
			correctionEntries: [],
			originalEntries: [],
		});
		value.identityEvidence = {
			employees: [{ id: employeeId, organizationId }],
		};

		await expect(capture(value)).rejects.toMatchObject({
			name: "TimeCorrectionLegacyStateCaptureError",
		});
	});

	it("rejects returned requestless correction rows without expected evidence", async () => {
		const value = envelope({
			source: source({ approvalStatus: "approved" }),
			canonicalRecord: canonicalRecord({ approvalState: "approved" }),
			approvalRequests: [],
		});
		value.identityEvidence = {
			employees: [{ id: employeeId, organizationId }],
		};
		await expect(capture(value)).rejects.toMatchObject({
			name: "TimeCorrectionLegacyStateCaptureError",
		});
	});

	it("strictly rejects malformed expected correction evidence before querying", async () => {
		const fake = database(envelope());
		await expect(
			captureTimeCorrectionLegacyApprovalState({
				dbService: fake.dbService,
				organizationId,
				workPeriodId,
				capturedAt,
				expectedCorrection: { action: "edit" },
			}),
		).rejects.toMatchObject({ name: "TimeCorrectionLegacyStateCaptureError" });
		expect(fake.calls).toHaveLength(0);
	});

	it.each([
		[
			"rejected source and canonical state",
			source({ approvalStatus: "rejected" }),
			canonicalRecord({ approvalState: "rejected" }),
		],
		[
			"deleted approved source without correction context",
			source({
				approvalStatus: "approved",
				deletedAt: new Date("2026-07-20T20:00:00.000Z"),
			}),
			canonicalRecord({ approvalState: "approved" }),
		],
	] as const)("rejects impossible requestless lifecycle: %s", async (_name, requestlessSource, requestlessCanonical) => {
		const value = envelope({
			source: requestlessSource,
			canonicalRecord: requestlessCanonical,
			approvalRequests: [],
			correctionEntries: [],
			originalEntries: [],
		});
		value.identityEvidence = {
			employees: [{ id: employeeId, organizationId }],
		};
		await expect(capture(value)).rejects.toMatchObject({
			name: "TimeCorrectionLegacyStateCaptureError",
		});
	});

	it("allows a completed approved work period before approval creation", async () => {
		const value = envelope({
			source: source({ approvalStatus: "approved" }),
			canonicalRecord: canonicalRecord({ approvalState: "approved" }),
			approvalRequests: [],
			correctionEntries: [],
			originalEntries: [],
		});
		value.identityEvidence = {
			employees: [{ id: employeeId, organizationId }],
		};
		const { state } = await capture(value);
		expect(state.approvalRequest).toBeNull();
		expect(state.sourceSnapshot.status).toBe("approved");
	});

	it("rejects disagreement between trusted expected correction and request metadata", async () => {
		await expect(
			capture(envelope(), {
				action: "edit",
				clockOutCorrectionId,
			}),
		).rejects.toMatchObject({ name: "TimeCorrectionLegacyStateCaptureError" });
	});

	it("rejects a requestless cancelled chain without correction carry-forward evidence", async () => {
		const value = envelope({
			approvalRequests: [],
			chains: [
				chain({
					status: "cancelled",
					completedAt: submittedAt,
				}),
			],
			chainRows: [
				stage(1, {
					approvalRequestId: null,
					status: "cancelled",
				}),
			],
			correctionEntries: [],
			originalEntries: [],
		});
		value.identityEvidence = { employees: employeesFor(value) };

		await expect(capture(value)).rejects.toMatchObject({
			name: "TimeCorrectionLegacyStateCaptureError",
			message: "Time correction legacy approval state capture failed",
		});
	});

	it("accepts a cancelled chain when historical request metadata still supplies exact correction evidence", async () => {
		const value = envelope({
			approvalRequests: [
				request(undefined, {
					status: "approved",
					approvedAt: submittedAt,
				}),
			],
			chains: [
				chain({
					currentStageOrder: 2,
					status: "cancelled",
					completedAt: submittedAt,
				}),
			],
			chainRows: [
				stage(1, {
					status: "approved",
					decidedBy: approverId,
					decidedAt: submittedAt,
				}),
				stage(2, {
					approvalRequestId: null,
					status: "cancelled",
				}),
			],
		});
		value.identityEvidence = { employees: employeesFor(value) };

		const { state } = await capture(value, undefined, {
			chainInstanceId: chainId,
		});
		expect(state.chain?.status).toBe("cancelled");
		expect(state.sourceSnapshot).toMatchObject({
			timeCorrection: { action: "edit", clockInCorrectionId },
			correctionEndpoints: [{ correctionEntryId: clockInCorrectionId }],
		});
	});

	it("recaptures exact cancelled lifecycle and unchanged source after correction rows were deleted", async () => {
		const value = envelope({
			approvalRequests: [
				request(undefined, {
					status: "approved",
					approvedAt: submittedAt,
				}),
			],
			chains: [
				chain({
					currentStageOrder: 2,
					status: "cancelled",
					completedAt: submittedAt,
				}),
			],
			chainRows: [
				stage(1, {
					status: "approved",
					decidedBy: approverId,
					decidedAt: submittedAt,
				}),
				stage(2, {
					approvalRequestId: null,
					status: "cancelled",
				}),
			],
			correctionEntries: [],
			originalEntries: [],
		});
		value.identityEvidence = { employees: employeesFor(value) };

		const { state } = await capture(
			value,
			{ action: "edit", clockInCorrectionId },
			{ chainInstanceId: chainId },
			undefined,
			true,
		);

		expect(state.chain?.status).toBe("cancelled");
		expect(state.sourceSnapshot).toMatchObject({
			status: "cancelled",
			timeCorrection: { action: "edit", clockInCorrectionId },
			correctionEndpoints: [],
			canonicalRecord: {
				approvalState: "approved",
			},
		});
	});

	it.each([
		{ pendingRequestCount: 1, eligiblePendingDirectRequestCount: 1 },
		{ pendingChainCount: 1 },
	])("rejects exact cancelled-chain replay with an unrelated pending lifecycle %#", async (selectionEvidence) => {
		const value = envelope({
			approvalRequests: [],
			chains: [
				chain({
					currentStageOrder: 1,
					status: "cancelled",
					completedAt: submittedAt,
				}),
			],
			chainRows: [stage(1, { approvalRequestId: null, status: "cancelled" })],
			correctionEntries: [],
			originalEntries: [],
			selectionEvidence,
		});
		value.identityEvidence = { employees: employeesFor(value) };

		await expect(
			capture(
				value,
				{ action: "edit", clockInCorrectionId },
				{ chainInstanceId: chainId },
				undefined,
				true,
			),
		).rejects.toThrow("Time correction legacy approval state capture failed");
	});

	it.each([
		{
			name: "clock-in-only edit",
			metadata: { timeCorrection: { action: "edit", clockInCorrectionId } },
			corrections: [correction("clock_in")],
			originals: [original("clock_in")],
			expected: ["clock_in"],
		},
		{
			name: "clock-out-only edit",
			metadata: { timeCorrection: { action: "edit", clockOutCorrectionId } },
			corrections: [correction("clock_out")],
			originals: [original("clock_out")],
			expected: ["clock_out"],
		},
		{
			name: "two-endpoint edit",
			metadata: {
				timeCorrection: {
					action: "edit",
					clockInCorrectionId,
					clockOutCorrectionId,
				},
			},
			corrections: [correction("clock_out"), correction("clock_in")],
			originals: [original("clock_out"), original("clock_in")],
			expected: ["clock_in", "clock_out"],
		},
		{
			name: "zero-duration deletion",
			metadata: {
				timeCorrection: {
					action: "delete",
					clockInCorrectionId,
					clockOutCorrectionId,
				},
			},
			corrections: [
				correction("clock_in", {
					timestamp: new Date("2026-07-20T06:00:00.000Z"),
				}),
				correction("clock_out", {
					timestamp: new Date("2026-07-20T06:00:00.000Z"),
				}),
			],
			originals: [original("clock_in"), original("clock_out")],
			expected: ["clock_in", "clock_out"],
		},
	] as const)("captures $name with endpoint-local audit evidence", async (test) => {
		const { state } = await capture(
			envelope({
				approvalRequests: [request(test.metadata)],
				correctionEntries: test.corrections,
				originalEntries: test.originals,
			}),
		);

		expect(
			(state.sourceSnapshot.correctionEndpoints as JsonRecord[]).map(
				(item) => item.endpointType,
			),
		).toEqual(test.expected);
		if (test.expected.length === 2) {
			expect(state.sourceSnapshot.correctionEndpoints).toMatchObject([
				{ timezone: "Europe/Berlin", utcOffsetMinutes: 120 },
				{ timezone: "America/New_York", utcOffsetMinutes: -240 },
			]);
		}
	});

	it("preserves a valid open-period clock-in-only proposal", async () => {
		const value = envelope({
			source: source({
				clockOutId: null,
				endTime: null,
				durationMinutes: null,
				isActive: true,
			}),
			canonicalRecord: canonicalRecord({
				endAt: null,
				durationMinutes: null,
			}),
			currentEndpoints: currentEndpoints({ clockOut: null }),
		});

		const { state } = await capture(value);
		expect(state.sourceSnapshot).toMatchObject({
			workPeriod: { isActive: true, endTime: null, durationMinutes: null },
			timeCorrection: { action: "edit", clockInCorrectionId },
		});
	});

	it.each([
		[
			"clock-in type",
			currentEndpoints({ clockIn: entry({ type: "correction" }) }),
		],
		[
			"clock-out type",
			currentEndpoints({
				clockOut: original("clock_out", { type: "clock_in" }),
			}),
		],
		[
			"superseded clock-in",
			currentEndpoints({ clockIn: entry({ isSuperseded: true }) }),
		],
		[
			"deleted clock-in",
			currentEndpoints({ clockIn: entry({ isDeleted: true }) }),
		],
		[
			"clock-in replacement lineage",
			currentEndpoints({
				clockIn: entry({ replacesEntryId: clockOutId }),
			}),
		],
		[
			"clock-in superseding lineage",
			currentEndpoints({
				clockIn: entry({ supersededById: clockInCorrectionId }),
			}),
		],
	] as const)("rejects invalid current original %s", async (_name, endpoints) => {
		await expect(
			capture(envelope({ currentEndpoints: endpoints })),
		).rejects.toMatchObject({ name: "TimeCorrectionLegacyStateCaptureError" });
	});

	it("rejects a stale untouched clock-in in a clock-out-only correction", async () => {
		await expect(
			capture(
				envelope({
					approvalRequests: [
						request({
							timeCorrection: { action: "edit", clockOutCorrectionId },
						}),
					],
					correctionEntries: [correction("clock_out")],
					originalEntries: [original("clock_out")],
					currentEndpoints: currentEndpoints({
						clockIn: entry({ isSuperseded: true }),
					}),
				}),
			),
		).rejects.toMatchObject({ name: "TimeCorrectionLegacyStateCaptureError" });
	});

	it.each([
		[
			"corrected clock-in after unchanged clock-out",
			{ timeCorrection: { action: "edit", clockInCorrectionId } },
			[
				correction("clock_in", {
					timestamp: new Date("2026-07-20T17:00:00.000Z"),
				}),
			],
			[original("clock_in")],
		],
		[
			"corrected clock-out before unchanged clock-in",
			{ timeCorrection: { action: "edit", clockOutCorrectionId } },
			[
				correction("clock_out", {
					timestamp: new Date("2026-07-20T05:00:00.000Z"),
				}),
			],
			[original("clock_out")],
		],
		[
			"zero-duration two-endpoint edit",
			{
				timeCorrection: {
					action: "edit",
					clockInCorrectionId,
					clockOutCorrectionId,
				},
			},
			[
				correction("clock_in", {
					timestamp: new Date("2026-07-20T15:00:00.000Z"),
				}),
				correction("clock_out", {
					timestamp: new Date("2026-07-20T15:00:00.000Z"),
				}),
			],
			[original("clock_in"), original("clock_out")],
		],
		[
			"negative-duration two-endpoint edit",
			{
				timeCorrection: {
					action: "edit",
					clockInCorrectionId,
					clockOutCorrectionId,
				},
			},
			[
				correction("clock_in", {
					timestamp: new Date("2026-07-20T16:00:00.000Z"),
				}),
				correction("clock_out", {
					timestamp: new Date("2026-07-20T15:00:00.000Z"),
				}),
			],
			[original("clock_in"), original("clock_out")],
		],
	] as const)("rejects invalid effective edit shape: %s", async (_name, metadata, corrections, originals) => {
		await expect(
			capture(
				envelope({
					approvalRequests: [request(metadata)],
					correctionEntries: corrections,
					originalEntries: originals,
				}),
			),
		).rejects.toMatchObject({ name: "TimeCorrectionLegacyStateCaptureError" });
	});

	it.each([
		["pending", envelope()],
		[
			"approved",
			approvedEnvelope(
				{ timeCorrection: { action: "edit", clockInCorrectionId } },
				["clock_in"],
			),
		],
		[
			"requester auto-approved",
			approvedEnvelope(
				{ timeCorrection: { action: "edit", clockInCorrectionId } },
				["clock_in"],
			),
		],
		[
			"rejected",
			envelope({
				approvalRequests: [
					request(undefined, {
						status: "rejected",
						rejectionReason: "Rejected",
					}),
				],
			}),
		],
	] as const)("captures a direct %s lifecycle", async (name, value) => {
		if (name === "requester auto-approved") {
			(value.approvalRequests as JsonRecord[])[0].approverId = employeeId;
			value.identityEvidence = {
				employees: [{ id: employeeId, organizationId }],
			};
		}
		const { state } = await capture(
			value,
			undefined,
			name === "pending" ? undefined : { approvalRequestId: requestId },
		);
		expect(state.approvalRequest?.status).toBe(
			name === "requester auto-approved" ? "approved" : name,
		);
		expect(state.sourceSnapshot.status).toBe(
			name === "requester auto-approved" ? "approved" : name,
		);
	});

	it.each([
		{
			name: "initial pending chain",
			chain: chain(),
			requests: [request()],
			rows: [stage(1), stage(2)],
		},
		{
			name: "advanced pending chain",
			chain: chain({ currentStageOrder: 2 }),
			requests: [
				request(undefined, {
					status: "approved",
					approvedAt: submittedAt,
				}),
				request(undefined, {
					id: secondRequestId,
					approverId: secondApproverId,
				}),
			],
			rows: [
				stage(2, {
					approvalRequestId: secondRequestId,
					status: "pending",
				}),
				stage(1, {
					status: "approved",
					decidedBy: approverId,
					decidedAt: submittedAt,
				}),
			],
		},
		{
			name: "approved chain",
			chain: chain({
				currentStageOrder: 1,
				status: "approved",
				completedAt: submittedAt,
			}),
			requests: [
				request(undefined, {
					status: "approved",
					approvedAt: submittedAt,
				}),
			],
			rows: [
				stage(1, {
					status: "approved",
					decidedBy: approverId,
					decidedAt: submittedAt,
				}),
			],
			approved: true,
		},
		{
			name: "rejected chain",
			chain: chain({ status: "rejected", completedAt: submittedAt }),
			requests: [
				request(undefined, {
					status: "rejected",
					rejectionReason: "Rejected",
				}),
			],
			rows: [
				stage(1, {
					status: "rejected",
					decidedBy: approverId,
					decidedAt: submittedAt,
				}),
				stage(2),
			],
			rejected: true,
		},
		{
			name: "cancelled chain after request disappearance",
			chain: chain({ status: "cancelled", completedAt: submittedAt }),
			requests: [],
			rows: [
				stage(1, { approvalRequestId: null, status: "cancelled" }),
				stage(2),
			],
			cancelled: true,
		},
	] as const)("captures $name", async (test) => {
		let value = envelope({
			approvalRequests: test.requests,
			chains: [test.chain],
			chainRows: test.rows,
		});
		if ("approved" in test) {
			value = approvedEnvelope(
				{ timeCorrection: { action: "edit", clockInCorrectionId } },
				["clock_in"],
			);
			value.chains = [test.chain];
			value.chainRows = test.rows;
			value.approvalRequests = test.requests;
		}
		if ("rejected" in test) {
			value.source = source();
			value.canonicalRecord = canonicalRecord();
		}
		value.identityEvidence = { employees: employeesFor(value) };

		const { state } = await capture(
			value,
			"cancelled" in test ? { action: "edit", clockInCorrectionId } : undefined,
			test.chain.status === "pending"
				? undefined
				: { chainInstanceId: chainId },
		);
		expect(state.chain?.status).toBe(test.chain.status);
		expect(state.sourceSnapshot.status).toBe(test.chain.status);
		expect(state.chainRows.map((row) => row.stepOrder)).toEqual(
			[...test.rows]
				.sort((left, right) => left.stepOrder - right.stepOrder)
				.map((row) => row.stepOrder),
		);
		if ("cancelled" in test) expect(state.approvalRequest).toBeNull();
	});

	it("captures every ordered chain stage without silent truncation", async () => {
		const rows = Array.from({ length: 102 }, (_, index) => {
			const stepOrder = index + 1;
			const suffix = String(stepOrder).padStart(12, "0");
			return stage(stepOrder, {
				id: `90000000-0000-4000-8000-${suffix}`,
				policyStageId: `a0000000-0000-4000-8000-${suffix}`,
				approvalRequestId: null,
				status: "cancelled",
				decidedBy: null,
				decidedAt: null,
				createdAt: submittedAt,
				updatedAt: submittedAt,
			});
		});
		const value = envelope({
			approvalRequests: [],
			chains: [
				chain({
					currentStageOrder: 1,
					status: "cancelled",
					completedAt: submittedAt,
				}),
			],
			chainRows: rows,
		});
		value.identityEvidence = { employees: employeesFor(value) };

		const { fake, state } = await capture(
			value,
			{
				action: "edit",
				clockInCorrectionId,
			},
			{ chainInstanceId: chainId },
		);

		expect(state.chainRows).toHaveLength(102);
		expect(state.chainRows.map((row) => row.stepOrder)).toEqual(
			Array.from({ length: 102 }, (_, index) => index + 1),
		);
		expect(new PgDialect().sqlToQuery(fake.calls[0]).sql).not.toContain(
			"limit 101",
		);
	});

	it("accepts second-resolution endpoints with persisted floor-minute duration parity", async () => {
		const start = new Date("2026-07-20T08:00:30.000Z");
		const end = new Date("2026-07-20T16:00:45.000Z");
		const value = envelope({
			source: source({
				startTime: start,
				endTime: end,
				durationMinutes: 480,
			}),
			canonicalRecord: canonicalRecord({
				startAt: start,
				endAt: end,
				durationMinutes: 480,
			}),
			currentEndpoints: currentEndpoints({
				clockIn: entry({ timestamp: start }),
				clockOut: original("clock_out", { timestamp: end }),
			}),
			originalEntries: [original("clock_in", { timestamp: start })],
		});

		const { state } = await capture(value);
		expect(state.sourceSnapshot).toMatchObject({
			status: "pending",
			workPeriod: { durationMinutes: 480 },
		});
	});

	it("captures a complete envelope with PostgreSQL timestamp strings", async () => {
		const value = asPostgresTimestampStrings(envelope()) as JsonRecord;

		const { state } = await capture(value);

		expect(state.sourceSnapshot.workPeriod).toMatchObject({
			startTime: "2026-07-20T06:00:00Z",
			endTime: "2026-07-20T16:00:00Z",
		});
		expect(state.approvalRequest?.updatedAt.toString()).toBe(
			"2026-07-20T08:30:00Z",
		);
	});

	it("captures every scoped source request without an arbitrary SQL limit", async () => {
		const { fake } = await capture(envelope());
		const query = new PgDialect().sqlToQuery(fake.calls[0]);
		expect(query.sql).not.toContain("limit 1001");
	});

	it("ignores prior terminal direct history before a later submission", async () => {
		const value = envelope({
			source: source(),
			canonicalRecord: canonicalRecord(),
			approvalRequests: [],
			correctionEntries: [],
			originalEntries: [],
			selectionEvidence: {
				pendingRequestCount: 0,
				pendingChainCount: 0,
				selectedRequestCount: 0,
				selectedChainCount: 0,
			},
		});
		value.identityEvidence = {
			employees: [{ id: employeeId, organizationId }],
		};

		const { fake, state } = await capture(value);
		expect(state.approvalRequest).toBeNull();
		expect(state.chain).toBeNull();
		const query = new PgDialect().sqlToQuery(fake.calls[0]);
		expect(query.sql).toContain("request_candidate_counts");
		expect(query.sql).toContain("selected_request_ids");
		expect(query.sql).toContain("request.status = 'pending'");
		expect(query.sql).not.toContain("json_agg(request_candidate");
	});

	it("rejects a pending request owned by a terminal chain instead of treating it as direct", async () => {
		const value = envelope({
			approvalRequests: [],
			chains: [],
			chainRows: [],
			correctionEntries: [],
			originalEntries: [],
			selectionEvidence: {
				pendingRequestCount: 1,
				pendingChainCount: 0,
				selectedRequestCount: 0,
				selectedChainCount: 0,
				expectedRequestCount: 0,
			},
		});
		value.identityEvidence = {
			employees: [{ id: employeeId, organizationId }],
		};
		const fake = database(value);

		await expect(
			captureTimeCorrectionLegacyApprovalState({
				dbService: fake.dbService,
				organizationId,
				workPeriodId,
				capturedAt,
			}),
		).rejects.toMatchObject({ name: "TimeCorrectionLegacyStateCaptureError" });
		expect(new PgDialect().sqlToQuery(fake.calls[0]).sql).toMatch(
			/and not exists \([\s\S]*stage\.approval_request_id = request\.id[\s\S]*\)\s+and \(/,
		);
	});

	it("rejects chain-owned pending request corruption even when the owning chain names another source", async () => {
		const value = envelope({
			approvalRequests: [],
			chains: [],
			chainRows: [],
			correctionEntries: [],
			originalEntries: [],
			selectionEvidence: {
				pendingRequestCount: 1,
				eligiblePendingDirectRequestCount: 0,
				pendingChainCount: 0,
				selectedRequestCount: 0,
				selectedChainCount: 0,
			},
		});
		value.identityEvidence = {
			employees: [{ id: employeeId, organizationId }],
		};
		const fake = database(value);

		await expect(
			captureTimeCorrectionLegacyApprovalState({
				dbService: fake.dbService,
				organizationId,
				workPeriodId,
				capturedAt,
			}),
		).rejects.toMatchObject({
			name: "TimeCorrectionLegacyStateCaptureError",
			message: "Time correction legacy approval state capture failed",
		});
		const query = new PgDialect().sqlToQuery(fake.calls[0]);
		expect(query.sql).toContain(
			"stage.organization_id = capture.organization_id",
		);
		expect(query.sql).not.toContain("request_chain.entity_type");
		expect(query.sql).not.toContain("request_chain.entity_id");
	});

	it("selects a current pending direct cycle only through exact count gates", async () => {
		const { fake, state } = await capture(envelope());
		expect(state.approvalRequest).toMatchObject({
			id: requestId,
			status: "pending",
		});
		const query = new PgDialect().sqlToQuery(fake.calls[0]);
		expect(query.sql).toContain(
			'request_counts."eligiblePendingDirectRequestCount" = 1',
		);
		expect(query.sql).toContain('request_counts."pendingRequestCount" = 1');
		expect(query.sql).toContain('chain_counts."pendingChainCount" = 0');
		expect(query.sql).toContain('chain_counts."pendingChainCount" = 1');
		expect(query.sql).toContain(
			'request_counts."eligiblePendingDirectRequestCount" = 0',
		);
		expect(query.sql).toContain('request_counts."expectedRequestCount" = 1');
		expect(query.sql).toContain('chain_counts."expectedChainCount" = 1');
	});

	it("selects a terminal direct cycle only with its exact internal hint", async () => {
		const terminal = approvedEnvelope(
			{ timeCorrection: { action: "edit", clockInCorrectionId } },
			["clock_in"],
		);
		const { fake, state } = await capture(terminal, undefined, {
			approvalRequestId: requestId,
		});
		expect(state.approvalRequest).toMatchObject({
			id: requestId,
			status: "approved",
		});
		expect(new PgDialect().sqlToQuery(fake.calls[0]).sql).toContain(
			"stage.approval_request_id = request.id",
		);
	});

	it("rejects mismatched and stale expected legacy cycle hints", async () => {
		const terminal = approvedEnvelope(
			{ timeCorrection: { action: "edit", clockInCorrectionId } },
			["clock_in"],
		);
		const empty = envelope({
			approvalRequests: [],
			correctionEntries: [],
			originalEntries: [],
		});
		empty.identityEvidence = {
			employees: [{ id: employeeId, organizationId }],
		};

		await expect(
			capture(terminal, undefined, { approvalRequestId: secondRequestId }),
		).rejects.toMatchObject({ name: "TimeCorrectionLegacyStateCaptureError" });
		await expect(
			capture(empty, undefined, { approvalRequestId: requestId }),
		).rejects.toMatchObject({ name: "TimeCorrectionLegacyStateCaptureError" });
	});

	it("rejects duplicate pending direct candidates with no rows materialized", async () => {
		const value = envelope({
			approvalRequests: [],
			chains: [],
			chainRows: [],
			correctionEntries: [],
			originalEntries: [],
			selectionEvidence: {
				pendingRequestCount: 2,
				eligiblePendingDirectRequestCount: 2,
				pendingChainCount: 0,
				selectedRequestCount: 0,
				selectedChainCount: 0,
			},
		});
		value.identityEvidence = {
			employees: [{ id: employeeId, organizationId }],
		};

		await expect(capture(value)).rejects.toMatchObject({
			name: "TimeCorrectionLegacyStateCaptureError",
		});
	});

	it("rejects stale terminal chain hints", async () => {
		const value = envelope({
			approvalRequests: [],
			chains: [],
			chainRows: [],
			correctionEntries: [],
			originalEntries: [],
		});
		value.identityEvidence = {
			employees: [{ id: employeeId, organizationId }],
		};

		await expect(
			capture(value, undefined, { chainInstanceId: chainId }),
		).rejects.toMatchObject({ name: "TimeCorrectionLegacyStateCaptureError" });
	});

	it("rejects duplicate pending chain candidates with no rows materialized", async () => {
		const value = envelope({
			approvalRequests: [],
			chains: [],
			chainRows: [],
			correctionEntries: [],
			originalEntries: [],
			selectionEvidence: {
				pendingRequestCount: 2,
				eligiblePendingDirectRequestCount: 0,
				pendingChainCount: 2,
				selectedRequestCount: 0,
				selectedChainCount: 0,
			},
		});
		value.identityEvidence = {
			employees: [{ id: employeeId, organizationId }],
		};

		await expect(capture(value)).rejects.toMatchObject({
			name: "TimeCorrectionLegacyStateCaptureError",
		});
	});

	it.each([
		["manual submission", { timeRequest: { kind: "manual_time_submission" } }],
		["policy clock-out", { timeRequest: { kind: "policy_clock_out" } }],
		["unclassified request", { channel: "web" }],
		["empty correction metadata", { timeCorrection: {} }],
		[
			"duplicate correction IDs",
			{
				timeCorrection: {
					action: "edit",
					clockInCorrectionId,
					clockOutCorrectionId: clockInCorrectionId,
				},
			},
		],
	] as const)("rejects the %s subtype or metadata", async (_name, metadata) => {
		await expect(
			capture(envelope({ approvalRequests: [request(metadata)] })),
		).rejects.toMatchObject({
			name: "TimeCorrectionLegacyStateCaptureError",
			message: "Time correction legacy approval state capture failed",
		});
	});

	it.each([
		["missing source", { source: null }],
		[
			"foreign source organization",
			{ source: source({ organizationId: "org-2" }) },
		],
		["foreign source employee", { source: source({ employeeId: "other" }) }],
		["missing canonical record", { canonicalRecord: null }],
		[
			"wrong canonical employee",
			{ canonicalRecord: canonicalRecord({ employeeId: "other" }) },
		],
		[
			"wrong canonical kind",
			{ canonicalRecord: canonicalRecord({ recordKind: "absence" }) },
		],
		[
			"canonical time mismatch",
			{
				canonicalRecord: canonicalRecord({
					startAt: new Date("2026-07-20T05:00:00Z"),
				}),
			},
		],
		[
			"foreign request",
			{ approvalRequests: [request(undefined, { organizationId: "org-2" })] },
		],
		[
			"request for another source",
			{ approvalRequests: [request(undefined, { entityId: clockInId })] },
		],
		[
			"request from another employee",
			{
				approvalRequests: [
					request(undefined, { requestedBy: secondApproverId }),
				],
			},
		],
		[
			"duplicate direct requests",
			{
				approvalRequests: [
					request(),
					request(undefined, { id: secondRequestId }),
				],
			},
		],
		["missing correction", { correctionEntries: [] }],
		[
			"foreign correction",
			{
				correctionEntries: [
					correction("clock_in", { organizationId: "org-2" }),
				],
			},
		],
		[
			"foreign correction employee",
			{
				correctionEntries: [
					correction("clock_in", { employeeId: secondApproverId }),
				],
			},
		],
		[
			"active pending correction",
			{ correctionEntries: [correction("clock_in", { isSuperseded: false })] },
		],
		[
			"already superseded pending correction",
			{
				correctionEntries: [
					correction("clock_in", { supersededById: clockOutCorrectionId }),
				],
			},
		],
		[
			"deleted correction",
			{ correctionEntries: [correction("clock_in", { isDeleted: true })] },
		],
		[
			"endpoint slot mismatch",
			{
				correctionEntries: [
					correction("clock_in", { endpointType: "clock_out" }),
				],
			},
		],
		[
			"wrong replacement lineage",
			{
				correctionEntries: [
					correction("clock_in", { replacesEntryId: clockOutId }),
				],
			},
		],
		[
			"wrong original endpoint type",
			{ originalEntries: [original("clock_in", { type: "clock_out" })] },
		],
		[
			"inactive original",
			{ originalEntries: [original("clock_in", { isSuperseded: true })] },
		],
		[
			"invalid work-period endpoint shape",
			{ source: source({ clockOutId: null }) },
		],
		[
			"current endpoint disagreement",
			{
				currentEndpoints: currentEndpoints({
					clockIn: entry({ id: clockOutId }),
				}),
			},
		],
		[
			"missing employee ownership",
			{ identityEvidence: { employees: [{ id: approverId, organizationId }] } },
		],
		[
			"foreign employee ownership",
			{
				identityEvidence: {
					employees: [
						{ id: employeeId, organizationId: "org-2" },
						{ id: approverId, organizationId },
					],
				},
			},
		],
	] as const)("rejects %s evidence generically", async (_name, changes) => {
		await expect(capture(envelope(changes))).rejects.toMatchObject({
			name: "TimeCorrectionLegacyStateCaptureError",
			message: "Time correction legacy approval state capture failed",
		});
	});

	it.each([
		["invalid timestamp", { timestamp: new Date(Number.NaN) }],
		[
			"hostile timestamp object",
			{ timestamp: { toString: () => "secret-time" } },
		],
		["fractional offset", { utcOffsetMinutes: 30.5 }],
		["out-of-range offset", { utcOffsetMinutes: 1441 }],
		["maximum-day offset", { utcOffsetMinutes: 1440 }],
		["valid zone with wrong offset", { utcOffsetMinutes: 60 }],
		[
			"DST-season offset mismatch",
			{
				timestamp: new Date("2026-01-20T05:30:00.000Z"),
				utcOffsetMinutes: 120,
			},
		],
		["invalid IANA timezone", { timezone: "Private/Secret" }],
		["missing timezone", { timezone: null }],
		["invalid timezone source", { timezoneSource: "viewer" }],
	] as const)("rejects %s without exposing temporal evidence", async (_name, changes) => {
		try {
			await capture(
				envelope({ correctionEntries: [correction("clock_in", changes)] }),
			);
			expect.unreachable("capture should reject");
		} catch (error) {
			expect(error).toMatchObject({
				name: "TimeCorrectionLegacyStateCaptureError",
				message: "Time correction legacy approval state capture failed",
			});
			expect(String(error)).not.toContain("Private/Secret");
			expect(String(error)).not.toContain("secret-time");
		}
	});

	it("rejects offset-zone disagreement on an original endpoint", async () => {
		await expect(
			capture(
				envelope({
					originalEntries: [original("clock_in", { utcOffsetMinutes: 60 })],
				}),
			),
		).rejects.toMatchObject({ name: "TimeCorrectionLegacyStateCaptureError" });
	});

	it.each([
		[
			"duplicate stage order",
			{
				approvalRequests: [request()],
				chains: [chain()],
				chainRows: [
					stage(1),
					stage(1, { id: "90000000-0000-4000-8000-000000000009" }),
				],
			},
		],
		[
			"foreign chain source",
			{ chains: [chain({ entityId: clockInId })], chainRows: [stage(1)] },
		],
		[
			"stage from another chain",
			{
				chains: [chain()],
				chainRows: [stage(1, { chainInstanceId: "other" })],
			},
		],
		[
			"pending chain without current request",
			{ approvalRequests: [], chains: [chain()], chainRows: [stage(1)] },
		],
		[
			"request and stage disagreement",
			{
				approvalRequests: [request()],
				chains: [chain()],
				chainRows: [stage(1, { resolvedApproverEmployeeId: secondApproverId })],
			},
		],
		[
			"impossible approved chain",
			{
				approvalRequests: [request()],
				chains: [chain({ status: "approved", completedAt: submittedAt })],
				chainRows: [stage(1)],
			},
		],
		[
			"source and request status disagreement",
			{
				approvalRequests: [
					request(undefined, { status: "approved", approvedAt: submittedAt }),
				],
			},
		],
	] as const)("rejects lifecycle failure: %s", async (_name, changes) => {
		const value = envelope(changes);
		value.identityEvidence = { employees: employeesFor(value) };
		await expect(capture(value)).rejects.toMatchObject({
			name: "TimeCorrectionLegacyStateCaptureError",
		});
	});

	it("returns detached chain arrays and private snapshots", async () => {
		const rows = [stage(1), stage(2)];
		const requests = [request()];
		const value = envelope({
			chains: [chain()],
			chainRows: rows,
			approvalRequests: requests,
		});
		value.identityEvidence = { employees: employeesFor(value) };
		const { state } = await capture(value);

		rows[0].labelSnapshot = "Mutated";
		requests[0].reason = "Mutated";
		(state.sourceSnapshot.correctionEndpoints as JsonRecord[])[0];
		expect(state.chainRows[0].labelSnapshot).toBe("Stage 1");
		expect(state.approvalRequest?.reason).toBe("raw private reason");
		expect(state.chainRows).not.toBe(rows);
	});

	it("wraps driver failures without SQL or private evidence", async () => {
		const dbService = {
			db: {
				execute: async () => {
					throw new Error(`secret ${clockInCorrectionId} from time_entry`);
				},
			},
		} as unknown as ApprovalDbService;

		try {
			await captureTimeCorrectionLegacyApprovalState({
				dbService,
				organizationId,
				workPeriodId,
				capturedAt,
			});
			expect.unreachable("capture should reject");
		} catch (error) {
			expect(error).toMatchObject({
				name: "TimeCorrectionLegacyStateCaptureError",
				message: "Time correction legacy approval state capture failed",
			});
			expect(error).not.toHaveProperty("cause");
			expect(String(error)).not.toContain(clockInCorrectionId);
			expect(String(error)).not.toContain("time_entry");
		}
	});
});
