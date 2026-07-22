import { PgDialect, type SQL } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { instantToCanonicalString } from "@/lib/datetime/temporal-core";
import type { ApprovalDbService } from "../server/types";
import { deriveApprovalWorkflowId } from "../workflow/identity";
import {
	type CaptureOrdinaryWorkPeriodLegacyPreSubmissionStateInput,
	type CaptureOrdinaryWorkPeriodLegacyStateInput,
	captureOrdinaryWorkPeriodLegacyPreSubmissionState,
	captureOrdinaryWorkPeriodLegacyState,
} from "./work-period-legacy-state";

const organizationId = "org-1";
const workPeriodId = "10000000-0000-4000-8000-000000000001";
const employeeId = "20000000-0000-4000-8000-000000000001";
const approverId = "20000000-0000-4000-8000-000000000002";
const canonicalRecordId = "30000000-0000-4000-8000-000000000001";
const requestId = "40000000-0000-4000-8000-000000000001";
const chainId = "50000000-0000-4000-8000-000000000001";
const stageId = "60000000-0000-4000-8000-000000000001";
const workflowId = "70000000-0000-4000-8000-000000000001";
const startAt = new Date("2026-07-20T06:00:00.000Z");
const endAt = new Date("2026-07-20T14:00:00.000Z");
const capturedAt = new Date("2026-07-20T15:00:00.000Z");
const submissionId = "10000000-0000-4000-8000-000000000099";

function submissionKey(kind = "manual_time_submission") {
	return deriveApprovalWorkflowId({
		organizationId,
		workflowType: kind as "manual_time_submission" | "policy_clock_out",
		sourceType: "time_entry",
		sourceId: workPeriodId,
		allocationKey: submissionId,
	});
}

function submissionMarker() {
	return { key: submissionKey(), submissionId };
}

type JsonRecord = Record<string, unknown>;

function period(overrides: JsonRecord = {}) {
	return {
		id: workPeriodId,
		organizationId,
		employeeId,
		startTime: startAt,
		endTime: endAt,
		durationMinutes: 480,
		isActive: false,
		approvalStatus: "pending",
		pendingChanges: { isManualEntry: true, diagnostics: "private-period" },
		deletedAt: null,
		canonicalRecordId,
		approvalWorkflowId: workflowId,
		...overrides,
	};
}

function canonical(overrides: JsonRecord = {}) {
	return {
		id: canonicalRecordId,
		organizationId,
		employeeId,
		recordKind: "work",
		startAt,
		endAt,
		durationMinutes: 480,
		approvalState: "pending",
		...overrides,
	};
}

function request(overrides: JsonRecord = {}) {
	return {
		id: requestId,
		organizationId,
		entityType: "time_entry",
		entityId: workPeriodId,
		requestedBy: employeeId,
		approverId,
		status: "pending",
		reason: "private manual submission reason",
		rejectionReason: null,
		approvedAt: null,
		metadata: { timeRequest: { kind: "manual_time_submission" } },
		updatedAt: new Date("2026-07-20T14:30:00.000Z"),
		...overrides,
	};
}

function chain(overrides: JsonRecord = {}) {
	return {
		id: chainId,
		organizationId,
		policyId: "80000000-0000-4000-8000-000000000001",
		policyNameSnapshot: "Manual work review",
		entityType: "time_entry",
		entityId: workPeriodId,
		requesterEmployeeId: employeeId,
		currentStageOrder: 1,
		status: "pending",
		createdAt: new Date("2026-07-20T14:25:00.000Z"),
		updatedAt: new Date("2026-07-20T14:30:00.000Z"),
		completedAt: null,
		...overrides,
	};
}

function stage(overrides: JsonRecord = {}) {
	return {
		id: stageId,
		organizationId,
		chainInstanceId: chainId,
		policyStageId: "90000000-0000-4000-8000-000000000001",
		stepOrder: 1,
		labelSnapshot: "Manager review",
		approverTypeSnapshot: "direct_manager",
		resolvedApproverEmployeeId: approverId,
		approvalRequestId: requestId,
		status: "pending",
		decidedBy: null,
		decidedAt: null,
		createdAt: new Date("2026-07-20T14:25:00.000Z"),
		updatedAt: new Date("2026-07-20T14:30:00.000Z"),
		...overrides,
	};
}

function workflow(overrides: JsonRecord = {}) {
	return {
		id: workflowId,
		organizationId,
		workflowType: "manual_time_submission",
		sourceType: "time_entry",
		sourceId: workPeriodId,
		requesterEmployeeId: employeeId,
		...overrides,
	};
}

function envelope(overrides: JsonRecord = {}) {
	return {
		capturedAt,
		workPeriods: [period()],
		canonicalRecords: [canonical()],
		approvalRequests: [request()],
		requestStageLinks: [{ chainInstanceId: chainId, stageId }],
		chains: [chain()],
		chainRows: [stage()],
		workflows: [workflow()],
		employees: [
			{ id: employeeId, organizationId },
			{ id: approverId, organizationId },
		],
		...overrides,
	};
}

function database(value: JsonRecord) {
	const calls: SQL[] = [];
	const dbService = {
		db: {
			execute: async (query: SQL) => {
				calls.push(query);
				return { rows: [value] };
			},
		},
	} as unknown as ApprovalDbService;
	return { calls, dbService };
}

function input(
	dbService: ApprovalDbService,
	overrides: Partial<CaptureOrdinaryWorkPeriodLegacyStateInput> = {},
): CaptureOrdinaryWorkPeriodLegacyStateInput {
	return {
		dbService,
		organizationId,
		workPeriodId,
		expectedKind: "manual_time_submission",
		expectedRequesterEmployeeId: employeeId,
		approvalRequestId: requestId,
		...overrides,
	};
}

async function expectCaptureFailure(
	value: JsonRecord,
	overrides: Partial<CaptureOrdinaryWorkPeriodLegacyStateInput> = {},
) {
	const fake = database(value);
	await expect(
		captureOrdinaryWorkPeriodLegacyState(input(fake.dbService, overrides)),
	).rejects.toMatchObject({
		name: "OrdinaryWorkPeriodLegacyStateCaptureError",
		message: "Ordinary work-period legacy approval state capture failed",
	});
}

describe("captureOrdinaryWorkPeriodLegacyState", () => {
	it("captures one exact chain-backed ordinary work-period cycle in one operation", async () => {
		const value = envelope();
		const fake = database(value);

		const state = await captureOrdinaryWorkPeriodLegacyState(
			input(fake.dbService),
		);

		expect(fake.calls).toHaveLength(1);
		expect(new PgDialect().sqlToQuery(fake.calls[0] as SQL).params).toEqual([
			organizationId,
			workPeriodId,
			"manual_time_submission",
			employeeId,
			requestId,
		]);
		expect(state.source).toEqual({
			organizationId,
			workflowType: "manual_time_submission",
			sourceType: "time_entry",
			sourceId: workPeriodId,
		});
		expect(state.approvalRequest).toMatchObject({
			id: requestId,
			requestedBy: employeeId,
			approverId,
			metadata: { timeRequest: { kind: "manual_time_submission" } },
		});
		expect(state.chain).toMatchObject({
			id: chainId,
			requesterEmployeeId: employeeId,
		});
		expect(state.chainRows).toEqual([
			expect.objectContaining({
				id: stageId,
				approvalRequestId: requestId,
				resolvedApproverEmployeeId: approverId,
			}),
		]);
		expect(state.sourceSnapshot).toEqual({
			timeRequest: { kind: "manual_time_submission" },
		});
		expect(state.displaySnapshot).toEqual({
			approvalStatus: "pending",
			labels: { title: "Manual time submission" },
			period: {
				startAt: "2026-07-20T06:00:00Z",
				endAt: "2026-07-20T14:00:00Z",
				durationMinutes: 480,
			},
		});
		expect(instantToCanonicalString(state.capturedAt)).toBe(
			"2026-07-20T15:00:00Z",
		);

		(value.workPeriods as JsonRecord[])[0] = period({ durationMinutes: 1 });
		(value.approvalRequests as JsonRecord[])[0] = request({
			metadata: { timeRequest: { kind: "policy_clock_out" } },
		});
		expect(state.sourceSnapshot).toEqual({
			timeRequest: { kind: "manual_time_submission" },
		});
		expect(
			((state.displaySnapshot as JsonRecord).period as JsonRecord)
				.durationMinutes,
		).toBe(480);
	});

	it("normalizes historical marker and exact reason classification only during capture", async () => {
		const historicalManual = envelope({
			approvalRequests: [
				request({ metadata: null, reason: "Manual time entry: 20 July" }),
			],
		});
		const manualFake = database(historicalManual);
		const manual = await captureOrdinaryWorkPeriodLegacyState(
			input(manualFake.dbService),
		);
		expect(manual.approvalRequest?.metadata).toEqual({
			timeRequest: { kind: "manual_time_submission" },
		});

		const policy = envelope({
			workPeriods: [
				period({
					pendingChanges: { isNewClockOut: true },
					approvalWorkflowId: null,
				}),
			],
			approvalRequests: [
				request({
					metadata: null,
					reason: "Clock-out requires approval (0-day policy)",
				}),
			],
			workflows: [],
		});
		const policyFake = database(policy);
		const policyState = await captureOrdinaryWorkPeriodLegacyState(
			input(policyFake.dbService, { expectedKind: "policy_clock_out" }),
		);
		expect(policyState.sourceSnapshot).toEqual({
			timeRequest: { kind: "policy_clock_out" },
		});
		expect(policyState.displaySnapshot?.labels).toEqual({
			title: "Policy clock-out",
		});
	});

	it("captures exact requester auto-approval evidence when approved is expected", async () => {
		const approvedAt = new Date("2026-07-20T14:30:00.000Z");
		const fake = database(
			envelope({
				workPeriods: [
					period({ approvalStatus: "approved", approvalWorkflowId: null }),
				],
				canonicalRecords: [canonical({ approvalState: "approved" })],
				approvalRequests: [
					request({
						approverId: employeeId,
						status: "approved",
						approvedAt,
						metadata: {
							timeRequest: { kind: "manual_time_submission" },
							autoApproval: { reason: "requester_is_approver" },
						},
					}),
				],
				requestStageLinks: [],
				chains: [],
				chainRows: [],
				workflows: [],
				employees: [{ id: employeeId, organizationId }],
			}),
		);

		const state = await captureOrdinaryWorkPeriodLegacyState(
			input(fake.dbService, { expectedRequestStatus: "approved" }),
		);

		expect(state.approvalRequest).toMatchObject({
			status: "approved",
			requestedBy: employeeId,
			approverId: employeeId,
			metadata: {
				timeRequest: { kind: "manual_time_submission" },
				autoApproval: { reason: "requester_is_approver" },
			},
		});
	});

	it("captures the private stable submission marker without display leakage", async () => {
		const marker = {
			ordinarySubmission: { key: submissionKey(), submissionId },
		};
		const fake = database(
			envelope({
				approvalRequests: [
					request({
						metadata: {
							timeRequest: { kind: "manual_time_submission" },
							...marker,
						},
					}),
				],
			}),
		);

		const state = await captureOrdinaryWorkPeriodLegacyState(
			input(fake.dbService),
		);

		expect(state.approvalRequest?.metadata).toEqual({
			timeRequest: { kind: "manual_time_submission" },
			...marker,
		});
		expect(JSON.stringify(state.displaySnapshot)).not.toContain(
			"ordinarySubmission",
		);
		expect(state.sourceSnapshot).toEqual({
			timeRequest: { kind: "manual_time_submission" },
		});
	});

	it("captures exact approved auto evidence with the stable marker", async () => {
		const approvedAt = new Date("2026-07-20T14:30:00.000Z");
		const fake = database(
			envelope({
				workPeriods: [
					period({ approvalStatus: "approved", approvalWorkflowId: null }),
				],
				canonicalRecords: [canonical({ approvalState: "approved" })],
				approvalRequests: [
					request({
						approverId: employeeId,
						status: "approved",
						approvedAt,
						metadata: {
							timeRequest: { kind: "manual_time_submission" },
							ordinarySubmission: { key: submissionKey(), submissionId },
							autoApproval: { reason: "requester_is_approver" },
						},
					}),
				],
				requestStageLinks: [],
				chains: [],
				chainRows: [],
				workflows: [],
				employees: [{ id: employeeId, organizationId }],
			}),
		);

		const state = await captureOrdinaryWorkPeriodLegacyState(
			input(fake.dbService, { expectedRequestStatus: "approved" }),
		);

		expect(state.approvalRequest?.metadata).toEqual({
			timeRequest: { kind: "manual_time_submission" },
			ordinarySubmission: { key: submissionKey(), submissionId },
			autoApproval: { reason: "requester_is_approver" },
		});
	});

	it.each([
		["wrong key", { ...submissionMarker(), key: "wrong" }],
		["extra key", { ...submissionMarker(), extra: true }],
		["custom prototype", Object.assign(Object.create({}), submissionMarker())],
	] as const)("rejects a marker with %s", async (_label, ordinarySubmission) => {
		await expectCaptureFailure(
			envelope({
				approvalRequests: [
					request({
						metadata: {
							timeRequest: { kind: "manual_time_submission" },
							ordinarySubmission,
						},
					}),
				],
			}),
		);
	});

	it("rejects marker accessors without invoking them", async () => {
		const keyGetter = vi.fn(() => submissionKey());
		const ordinarySubmission = submissionMarker();
		Object.defineProperty(ordinarySubmission, "key", {
			enumerable: true,
			get: keyGetter,
		});

		await expectCaptureFailure(
			envelope({
				approvalRequests: [
					request({
						metadata: {
							timeRequest: { kind: "manual_time_submission" },
							ordinarySubmission,
						},
					}),
				],
			}),
		);
		expect(keyGetter).not.toHaveBeenCalled();
	});

	it("captures an exact auto-completed custom-policy chain", async () => {
		const approvedAt = new Date("2026-07-20T14:30:00.000Z");
		const fake = database(
			envelope({
				workPeriods: [
					period({ approvalStatus: "approved", approvalWorkflowId: null }),
				],
				canonicalRecords: [canonical({ approvalState: "approved" })],
				approvalRequests: [
					request({
						approverId: employeeId,
						status: "approved",
						approvedAt,
						metadata: {
							timeRequest: { kind: "manual_time_submission" },
							autoApproval: { reason: "requester_is_approver" },
						},
					}),
				],
				chains: [
					chain({
						status: "approved",
						completedAt: approvedAt,
					}),
				],
				chainRows: [
					stage({
						resolvedApproverEmployeeId: employeeId,
						status: "approved",
						decidedBy: employeeId,
						decidedAt: approvedAt,
					}),
				],
				workflows: [],
				employees: [{ id: employeeId, organizationId }],
			}),
		);

		const state = await captureOrdinaryWorkPeriodLegacyState(
			input(fake.dbService, { expectedRequestStatus: "approved" }),
		);

		expect(state.chain).toMatchObject({ status: "approved" });
		expect(state.chainRows).toEqual([
			expect.objectContaining({
				status: "approved",
				decidedBy: employeeId,
			}),
		]);
	});

	it.each([
		["pending status", { status: "pending", approvedAt: null }],
		["foreign approver", { approverId }],
		["missing approved instant", { approvedAt: null }],
		[
			"missing auto evidence",
			{ metadata: { timeRequest: { kind: "manual_time_submission" } } },
		],
	] as const)("rejects approved capture with %s", async (_label, overrides) => {
		await expectCaptureFailure(
			envelope({
				workPeriods: [
					period({ approvalStatus: "approved", approvalWorkflowId: null }),
				],
				canonicalRecords: [canonical({ approvalState: "approved" })],
				approvalRequests: [
					request({
						approverId: employeeId,
						status: "approved",
						approvedAt: new Date("2026-07-20T14:30:00.000Z"),
						metadata: {
							timeRequest: { kind: "manual_time_submission" },
							autoApproval: { reason: "requester_is_approver" },
						},
						...overrides,
					}),
				],
				requestStageLinks: [],
				chains: [],
				chainRows: [],
				workflows: [],
				employees: [{ id: employeeId, organizationId }],
			}),
			{ expectedRequestStatus: "approved" },
		);
	});

	it("rejects approved accessor metadata without invoking it", async () => {
		let reads = 0;
		const metadata = Object.defineProperty(
			{ timeRequest: { kind: "manual_time_submission" } },
			"autoApproval",
			{
				enumerable: true,
				get() {
					reads += 1;
					return { reason: "requester_is_approver" };
				},
			},
		);
		await expectCaptureFailure(
			envelope({
				workPeriods: [
					period({ approvalStatus: "approved", approvalWorkflowId: null }),
				],
				canonicalRecords: [canonical({ approvalState: "approved" })],
				approvalRequests: [
					request({
						approverId: employeeId,
						status: "approved",
						approvedAt: new Date("2026-07-20T14:30:00.000Z"),
						metadata,
					}),
				],
				requestStageLinks: [],
				chains: [],
				chainRows: [],
				workflows: [],
				employees: [{ id: employeeId, organizationId }],
			}),
			{ expectedRequestStatus: "approved" },
		);
		expect(reads).toBe(0);
	});

	it.each([
		[
			"wrong period organization",
			() => envelope({ workPeriods: [period({ organizationId: "org-2" })] }),
		],
		[
			"wrong period employee",
			() => envelope({ workPeriods: [period({ employeeId: approverId })] }),
		],
		[
			"wrong source",
			() => envelope({ workPeriods: [period({ id: canonicalRecordId })] }),
		],
		[
			"wrong request",
			() =>
				envelope({ approvalRequests: [request({ id: canonicalRecordId })] }),
		],
		[
			"wrong request source",
			() =>
				envelope({
					approvalRequests: [request({ entityId: canonicalRecordId })],
				}),
		],
		[
			"wrong request kind",
			() =>
				envelope({
					approvalRequests: [
						request({
							metadata: { timeRequest: { kind: "policy_clock_out" } },
						}),
					],
				}),
		],
		[
			"wrong canonical link",
			() => envelope({ canonicalRecords: [canonical({ id: workflowId })] }),
		],
		[
			"wrong record kind",
			() =>
				envelope({ canonicalRecords: [canonical({ recordKind: "absence" })] }),
		],
		[
			"wrong start instant",
			() =>
				envelope({
					canonicalRecords: [
						canonical({ startAt: new Date("2026-07-20T06:00:01.000Z") }),
					],
				}),
		],
		[
			"wrong end instant",
			() =>
				envelope({
					canonicalRecords: [
						canonical({ endAt: new Date("2026-07-20T14:00:01.000Z") }),
					],
				}),
		],
		[
			"wrong duration",
			() =>
				envelope({ canonicalRecords: [canonical({ durationMinutes: 479 })] }),
		],
		[
			"wrong approval state",
			() =>
				envelope({
					canonicalRecords: [canonical({ approvalState: "approved" })],
				}),
		],
		[
			"deleted period",
			() => envelope({ workPeriods: [period({ deletedAt: capturedAt })] }),
		],
		[
			"active period",
			() => envelope({ workPeriods: [period({ isActive: true })] }),
		],
		[
			"incomplete period",
			() => envelope({ workPeriods: [period({ endTime: null })] }),
		],
		[
			"malformed metadata",
			() =>
				envelope({
					approvalRequests: [
						request({
							metadata: {
								timeRequest: {
									kind: "manual_time_submission",
									diagnostics: true,
								},
							},
						}),
					],
				}),
		],
		[
			"dual historical markers",
			() =>
				envelope({
					approvalRequests: [request({ metadata: null })],
					workPeriods: [
						period({
							pendingChanges: {
								isManualEntry: true,
								isNewClockOut: true,
							},
						}),
					],
				}),
		],
		[
			"foreign workflow source link",
			() =>
				envelope({ workflows: [workflow({ sourceId: canonicalRecordId })] }),
		],
		[
			"foreign workflow kind",
			() =>
				envelope({
					workflows: [workflow({ workflowType: "policy_clock_out" })],
				}),
		],
		[
			"foreign request stage link",
			() =>
				envelope({
					requestStageLinks: [
						{ chainInstanceId: chainId, stageId: canonicalRecordId },
					],
				}),
		],
		[
			"foreign routing employee",
			() =>
				envelope({
					employees: [
						{ id: employeeId, organizationId },
						{ id: approverId, organizationId: "org-2" },
					],
				}),
		],
	] as const)("rejects %s", async (_name, createValue) => {
		await expectCaptureFailure(createValue());
	});

	it.each([
		"workPeriods",
		"canonicalRecords",
		"approvalRequests",
		"requestStageLinks",
		"chains",
		"workflows",
	] as const)("rejects more than one %s row", async (key) => {
		const value = envelope();
		value[key] = [
			...(value[key] as unknown[]),
			(value[key] as unknown[])[0],
		] as never;
		await expectCaptureFailure(value);
	});

	it("rejects a direct request when chain routing evidence is mixed in", async () => {
		await expectCaptureFailure(
			envelope({
				requestStageLinks: [],
				chains: [chain()],
				chainRows: [stage()],
			}),
		);
	});

	it("keeps private legacy evidence out of serialized display evidence", async () => {
		const privatePending = "private-pending-diagnostic";
		const privateReason = "private-request-reason";
		const privateInternalId = requestId;
		const privateDiagnostic = "private-workflow-diagnostic";
		const value = envelope({
			workPeriods: [
				period({
					pendingChanges: {
						isManualEntry: true,
						diagnostics: privatePending,
					},
				}),
			],
			approvalRequests: [request({ reason: privateReason })],
			workflows: [workflow({ diagnostics: privateDiagnostic })],
		});
		const fake = database(value);
		const state = await captureOrdinaryWorkPeriodLegacyState(
			input(fake.dbService),
		);

		const serialized = JSON.stringify(state.displaySnapshot);
		for (const privateValue of [
			privatePending,
			privateReason,
			privateInternalId,
			privateDiagnostic,
		]) {
			expect(serialized).not.toContain(privateValue);
		}
		expect(Object.keys(state.displaySnapshot ?? {}).sort()).toEqual([
			"approvalStatus",
			"labels",
			"period",
		]);
	});

	it("uses generic errors without attacker-controlled evidence", async () => {
		const attackerValue = "attacker-controlled-private-value";
		const fake = database(
			envelope({ workflows: [workflow({ sourceType: attackerValue })] }),
		);
		try {
			await captureOrdinaryWorkPeriodLegacyState(input(fake.dbService));
			expect.unreachable("capture should fail");
		} catch (error) {
			expect(String(error)).not.toContain(attackerValue);
		}
	});
});

function preInput(
	dbService: ApprovalDbService,
	overrides: Partial<CaptureOrdinaryWorkPeriodLegacyPreSubmissionStateInput> = {},
): CaptureOrdinaryWorkPeriodLegacyPreSubmissionStateInput {
	return {
		dbService,
		organizationId,
		workPeriodId,
		expectedKind: "manual_time_submission",
		expectedRequesterEmployeeId: employeeId,
		...overrides,
	};
}

function preEnvelope(overrides: JsonRecord = {}) {
	return envelope({
		workPeriods: [period({ approvalWorkflowId: null })],
		approvalRequests: [],
		requestStageLinks: [],
		chains: [],
		chainRows: [],
		workflows: [],
		employees: [{ id: employeeId, organizationId }],
		...overrides,
	});
}

describe("captureOrdinaryWorkPeriodLegacyPreSubmissionState", () => {
	it("captures exact source parity with no request or chain evidence", async () => {
		const fake = database(preEnvelope());

		const state = await captureOrdinaryWorkPeriodLegacyPreSubmissionState(
			preInput(fake.dbService),
		);

		expect(fake.calls).toHaveLength(1);
		const preCaptureSql = new PgDialect().sqlToQuery(fake.calls[0] as SQL).sql;
		expect(preCaptureSql).not.toContain("request.requested_by");
		expect(state).toMatchObject({
			organizationId,
			source: {
				organizationId,
				workflowType: "manual_time_submission",
				sourceType: "time_entry",
				sourceId: workPeriodId,
			},
			approvalRequest: null,
			chain: null,
			chainRows: [],
			sourceSnapshot: {
				timeRequest: { kind: "manual_time_submission" },
			},
		});
		expect(JSON.stringify(state.displaySnapshot)).not.toContain(
			"private-period",
		);
	});

	it.each([
		["a pending request", { approvalRequests: [request()] }],
		[
			"ambiguous requests",
			{ approvalRequests: [request(), request({ id: workflowId })] },
		],
		["a source workflow link", { workPeriods: [period()] }],
		["an orphaned pending canonical workflow", { workflows: [workflow()] }],
		[
			"canonical parity mismatch",
			{ canonicalRecords: [canonical({ durationMinutes: 1 })] },
		],
		[
			"foreign requester",
			{ workPeriods: [period({ employeeId: approverId })] },
		],
		[
			"opposite pending marker",
			{
				workPeriods: [
					period({
						approvalWorkflowId: null,
						pendingChanges: { isNewClockOut: true },
					}),
				],
			},
		],
	] as const)("rejects %s", async (_label, overrides) => {
		const fake = database(preEnvelope(overrides));
		await expect(
			captureOrdinaryWorkPeriodLegacyPreSubmissionState(
				preInput(fake.dbService),
			),
		).rejects.toMatchObject({
			name: "OrdinaryWorkPeriodLegacyStateCaptureError",
		});
	});

	it("wraps pre-submission query failures without exposing driver evidence", async () => {
		const privateDriverMessage = "private-driver-evidence";
		const dbService = {
			db: {
				execute: async () => {
					throw new Error(privateDriverMessage);
				},
			},
		} as unknown as ApprovalDbService;
		await expect(
			captureOrdinaryWorkPeriodLegacyPreSubmissionState(preInput(dbService)),
		).rejects.toMatchObject({
			code: "query_failed",
			message: "Ordinary work-period legacy approval state capture failed",
		});
	});
});
