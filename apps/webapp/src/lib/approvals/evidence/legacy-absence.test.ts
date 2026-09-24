import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { VerifiedLegacyApprovalState } from "../workflow/ports";
import { fingerprintApprovalCommandActor } from "../workflow/state-machine";
import { buildAbsenceSubmittedFacts } from "./absence-facts";
import { ApprovalEvidenceError } from "./errors";
import {
	captureLegacyAbsenceSubmissionEvidence,
	findLegacyAbsenceDecisionReplay,
	fingerprintLegacyAbsenceDecisionCommand,
	type LegacyAbsenceDecisionPlan,
	prepareLegacyAbsenceDecisionEvidence,
	recordLegacyAbsenceDecisionEvidence,
} from "./legacy-absence";
import type {
	LegacyAbsenceSubmittedRevisionRecord,
	LegacyDecisionEvidenceRecord,
} from "./store";

const store = vi.hoisted(() => ({
	readApprovalEvidenceMode: vi.fn(),
	loadLegacyAbsenceSubmittedRevision: vi.fn(),
	captureLegacyAbsenceSubmittedRevision: vi.fn(),
	recordLegacyDecisionEvidence: vi.fn(),
	findLegacyDecisionEvidenceByRequest: vi.fn(),
	loadEvidenceActorLabel: vi.fn(),
}));

vi.mock("./store", () => store);
vi.mock("./absence-submission", () => ({
	loadEmployeeLabel: vi.fn(async (_db, _org, where) =>
		"userId" in where
			? { employeeId: "employee-1", userId: where.userId, name: "Avery" }
			: { employeeId: where.employeeId, userId: "user-1", name: "Avery" },
	),
}));

const ORG = "org-1";
const ABSENCE = "10000000-0000-4000-8000-000000000001";
const REQUEST_1 = "20000000-0000-4000-8000-000000000001";
const REQUEST_2 = "20000000-0000-4000-8000-000000000002";
const CHAIN = "30000000-0000-4000-8000-000000000001";
const manager = {
	employeeId: "40000000-0000-4000-8000-000000000001",
	userId: "user-manager",
};

const entry = {
	startDate: "2026-08-03",
	startPeriod: "full_day" as const,
	endDate: "2026-08-04",
	endPeriod: "full_day" as const,
};

function facts() {
	return buildAbsenceSubmittedFacts({
		organizationId: ORG,
		absenceId: ABSENCE,
		subjectEmployeeId: "employee-1",
		requesterEmployeeId: "employee-1",
		categoryId: "category-1",
		raw: { ...entry, durationKind: "full_day" },
		normalized: { ...entry, durationKind: "full_day" },
		entry,
		canonicalRecord: {
			id: "record-1",
			startAt: new Date("2026-08-03T00:00:00Z"),
			endAt: new Date("2026-08-05T00:00:00Z"),
		},
	});
}

function revision(
	legacy: Partial<LegacyAbsenceSubmittedRevisionRecord["legacy"]> = {},
): LegacyAbsenceSubmittedRevisionRecord {
	return {
		id: "revision-1",
		authority: "legacy",
		organizationId: ORG,
		sourceId: ABSENCE,
		requestCycleKey: `absence:${ABSENCE}:submission`,
		revision: 1,
		subjectEmployeeId: "employee-1",
		requesterEmployeeId: "employee-1",
		submitter: { kind: "employee", employeeId: "employee-1", userId: "user-1" },
		materialFingerprint: "absence:v1:x",
		facts: facts(),
		labels: {
			subjectName: "Avery",
			requesterName: "Avery",
			submitterName: "Avery",
			categoryName: "Vacation",
		},
		provenance: "captured_at_submission",
		submittedAt: parseInstant("2026-07-30T08:00:00Z"),
		legacy: {
			approvalRequestId: REQUEST_1,
			chainInstanceId: null,
			observedWorkflowId: null,
			...legacy,
		},
	};
}

type RequestStatus = "pending" | "approved" | "rejected";

function state(input: {
	absenceStatus?: RequestStatus;
	approvalWorkflowId?: string | null;
	approvedAt?: string | null;
	request?: { id: string; status: RequestStatus } | null;
	chain?: Array<{
		id: string;
		requestId: string | null;
		status: RequestStatus | "cancelled";
		decidedBy?: string | null;
	}>;
}): VerifiedLegacyApprovalState {
	const updatedAt = parseInstant("2026-08-01T09:30:00Z");
	return {
		organizationId: ORG,
		source: {
			organizationId: ORG,
			workflowType: "absence",
			sourceType: "absence_entry",
			sourceId: ABSENCE,
		},
		approvalRequest:
			input.request === null
				? null
				: {
						id: input.request?.id ?? REQUEST_1,
						organizationId: ORG,
						entityType: "absence_entry",
						entityId: ABSENCE,
						requestedBy: "employee-1",
						approverId: manager.employeeId,
						status: input.request?.status ?? "pending",
						reason: null,
						rejectionReason: null,
						approvedAt:
							input.request?.status === "approved"
								? parseInstant("2026-08-01T09:00:00Z")
								: null,
						metadata: null,
						updatedAt,
					},
		chain: input.chain
			? {
					id: CHAIN,
					organizationId: ORG,
					policyId: "policy-1",
					policyNameSnapshot: "Two stages",
					entityType: "absence_entry",
					entityId: ABSENCE,
					requesterEmployeeId: "employee-1",
					currentStageOrder: 1,
					status: "pending",
					createdAt: updatedAt,
					updatedAt,
					completedAt: null,
				}
			: null,
		chainRows: (input.chain ?? []).map((row, index) => ({
			id: row.id,
			organizationId: ORG,
			chainInstanceId: CHAIN,
			policyStageId: `policy-stage-${index}`,
			stepOrder: index + 1,
			labelSnapshot: "Stage",
			approverTypeSnapshot: "direct_manager",
			resolvedApproverEmployeeId: manager.employeeId,
			approvalRequestId: row.requestId,
			status: row.status,
			decidedBy: row.decidedBy ?? null,
			decidedAt:
				row.status === "approved" || row.status === "rejected"
					? parseInstant("2026-08-01T10:00:00Z")
					: null,
			createdAt: updatedAt,
			updatedAt,
		})),
		sourceSnapshot: {
			id: ABSENCE,
			status: input.absenceStatus ?? "pending",
			approvedAt: input.approvedAt ?? null,
			approvalWorkflowId: input.approvalWorkflowId ?? null,
		},
		capturedAt: updatedAt,
	};
}

function recordInput(
	overrides: Partial<Parameters<typeof recordLegacyAbsenceDecisionEvidence>[2]>,
) {
	return {
		organizationId: ORG,
		absenceId: ABSENCE,
		action: "approve" as const,
		reason: undefined,
		approvalRequestId: REQUEST_1,
		idempotencyKey: `absence:${ABSENCE}:approve:initial:fp`,
		actor: manager,
		captureState: vi.fn(async () =>
			state({
				absenceStatus: "approved",
				request: { id: REQUEST_1, status: "approved" },
			}),
		),
		observed: null,
		...overrides,
	};
}

const database = {} as never;

beforeEach(() => {
	vi.clearAllMocks();
	store.readApprovalEvidenceMode.mockResolvedValue("capture");
	store.loadEvidenceActorLabel.mockResolvedValue({ name: "Morgan" });
	store.recordLegacyDecisionEvidence.mockImplementation(async (_db, input) => ({
		id: "decision-1",
		authority: "legacy",
		...input,
	}));
});

describe("fingerprintLegacyAbsenceDecisionCommand", () => {
	it("binds the exact request, action and reason fingerprint without storing text", () => {
		const base = { action: "reject" as const, approvalRequestId: REQUEST_1 };
		const fingerprint = fingerprintLegacyAbsenceDecisionCommand({
			...base,
			reason: "Private medical detail",
		});

		expect(fingerprint).toMatch(/^absence-legacy-decision:v1:[0-9a-f]{64}$/);
		expect(fingerprint).not.toContain("Private");
		expect(
			fingerprintLegacyAbsenceDecisionCommand({ ...base, reason: "Other" }),
		).not.toBe(fingerprint);
		expect(
			fingerprintLegacyAbsenceDecisionCommand({
				...base,
				approvalRequestId: REQUEST_2,
				reason: "Private medical detail",
			}),
		).not.toBe(fingerprint);
	});
});

describe("findLegacyAbsenceDecisionReplay", () => {
	function committed(
		overrides: Partial<LegacyDecisionEvidenceRecord> = {},
	): LegacyDecisionEvidenceRecord {
		return {
			id: "decision-1",
			authority: "legacy",
			organizationId: ORG,
			submittedRevisionId: "revision-1",
			operationKind: "command",
			receipt: {
				idempotencyKey: "any-legacy-key",
				actorFingerprint: fingerprintApprovalCommandActor({
					kind: "employee",
					...manager,
				}),
				commandFingerprint: fingerprintLegacyAbsenceDecisionCommand({
					action: "approve",
					approvalRequestId: REQUEST_1,
					reason: undefined,
				}),
			},
			action: "approve",
			legacy: {
				approvalRequestId: REQUEST_1,
				chainStageId: null,
				observedWorkflowId: null,
			},
			assignmentOutcome: "approved",
			requestOutcome: "approved",
			actor: { kind: "employee", ...manager },
			decidedAt: parseInstant("2026-08-01T09:00:00Z"),
			result: {},
			labels: { actorName: "Morgan" },
			...overrides,
		};
	}

	const lookup = {
		organizationId: ORG,
		absenceId: ABSENCE,
		approvalRequestId: REQUEST_1,
		action: "approve" as const,
		reason: undefined,
		actor: manager,
	};

	beforeEach(() => {
		store.loadLegacyAbsenceSubmittedRevision.mockResolvedValue(revision());
	});

	it("returns the committed operation for an exact retry, whatever key it was stored under", async () => {
		const evidence = committed();
		store.findLegacyDecisionEvidenceByRequest.mockResolvedValue(evidence);

		await expect(
			findLegacyAbsenceDecisionReplay(database, lookup),
		).resolves.toBe(evidence);
		expect(store.findLegacyDecisionEvidenceByRequest).toHaveBeenCalledWith(
			database,
			{ organizationId: ORG, approvalRequestId: REQUEST_1 },
		);
	});

	it("never matches without the exact legacy request identity", async () => {
		await expect(
			findLegacyAbsenceDecisionReplay(database, {
				...lookup,
				approvalRequestId: undefined,
			}),
		).resolves.toBeNull();
		expect(store.findLegacyDecisionEvidenceByRequest).not.toHaveBeenCalled();
	});

	it.each([
		[
			"another actor",
			{
				actor: {
					employeeId: "40000000-0000-4000-8000-000000000002",
					userId: "u-2",
				},
			},
		],
		["another action", { action: "reject" as const }],
		["another reason", { reason: "changed" }],
	])("does not replay %s", async (_label, overrides) => {
		store.findLegacyDecisionEvidenceByRequest.mockResolvedValue(committed());
		await expect(
			findLegacyAbsenceDecisionReplay(database, { ...lookup, ...overrides }),
		).resolves.toBeNull();
	});

	it("does not replay a submission activation or another lifecycle's evidence", async () => {
		store.findLegacyDecisionEvidenceByRequest.mockResolvedValue(
			committed({ operationKind: "submission_activation" }),
		);
		await expect(
			findLegacyAbsenceDecisionReplay(database, lookup),
		).resolves.toBeNull();

		store.findLegacyDecisionEvidenceByRequest.mockResolvedValue(
			committed({ submittedRevisionId: "revision-of-another-absence" }),
		);
		await expect(
			findLegacyAbsenceDecisionReplay(database, lookup),
		).resolves.toBeNull();
	});
});

describe("prepareLegacyAbsenceDecisionEvidence", () => {
	function liveDatabase(live: Record<string, unknown> | null) {
		return {
			query: {
				absenceEntry: {
					findFirst: vi.fn(async () =>
						live
							? {
									id: ABSENCE,
									organizationId: ORG,
									employeeId: "employee-1",
									categoryId: "category-1",
									...entry,
									category: { name: "Vacation" },
									...live,
								}
							: null,
					),
				},
			},
		} as never;
	}

	it("is inert without a revision while capture is inactive", async () => {
		store.readApprovalEvidenceMode.mockResolvedValue("inactive");
		store.loadLegacyAbsenceSubmittedRevision.mockResolvedValue(null);
		const captureState = vi.fn();

		await expect(
			prepareLegacyAbsenceDecisionEvidence(liveDatabase({}), {
				organizationId: ORG,
				absenceId: ABSENCE,
				captureState,
			}),
		).resolves.toBeNull();
		expect(captureState).not.toHaveBeenCalled();
	});

	it("holds a lifecycle without a revision while capture is active", async () => {
		store.loadLegacyAbsenceSubmittedRevision.mockResolvedValue(null);
		await expect(
			prepareLegacyAbsenceDecisionEvidence(liveDatabase({}), {
				organizationId: ORG,
				absenceId: ABSENCE,
				captureState: vi.fn(),
			}),
		).rejects.toMatchObject({ code: "evidence_required" });
	});

	it("keeps enforcing an existing revision after capture is paused", async () => {
		store.readApprovalEvidenceMode.mockResolvedValue("inactive");
		store.loadLegacyAbsenceSubmittedRevision.mockResolvedValue(revision());
		await expect(
			prepareLegacyAbsenceDecisionEvidence(
				liveDatabase({ startPeriod: "pm" }),
				{ organizationId: ORG, absenceId: ABSENCE, captureState: vi.fn() },
			),
		).rejects.toMatchObject({
			code: "material_change",
			details: { fields: "startPeriod" },
		});
	});

	it("lets a label-only rename through and captures the pre-decision rows", async () => {
		store.loadLegacyAbsenceSubmittedRevision.mockResolvedValue(revision());
		const before = state({});
		const plan = await prepareLegacyAbsenceDecisionEvidence(
			liveDatabase({ category: { name: "Annual leave" } }),
			{
				organizationId: ORG,
				absenceId: ABSENCE,
				captureState: vi.fn(async () => before),
			},
		);
		expect(plan).toEqual({ revision: revision(), before });
	});

	it("turns unsupported legacy rows into an evidence hold instead of a guess", async () => {
		store.loadLegacyAbsenceSubmittedRevision.mockResolvedValue(revision());
		await expect(
			prepareLegacyAbsenceDecisionEvidence(liveDatabase({}), {
				organizationId: ORG,
				absenceId: ABSENCE,
				captureState: vi.fn(async () => {
					throw new Error("ambiguous_chain");
				}),
			}),
		).rejects.toMatchObject({
			code: "evidence_incomplete",
			details: { field: "legacy_state" },
		});
	});
});

describe("recordLegacyAbsenceDecisionEvidence", () => {
	const plan = (
		overrides: Partial<LegacyAbsenceDecisionPlan> = {},
	): LegacyAbsenceDecisionPlan => ({
		revision: revision(),
		before: state({}),
		...overrides,
	});

	it("records the persisted outcome, time and unchanged key of a direct legacy request", async () => {
		const recorded = await recordLegacyAbsenceDecisionEvidence(
			database,
			plan(),
			recordInput({}),
		);

		expect(store.recordLegacyDecisionEvidence).toHaveBeenCalledWith(
			database,
			expect.objectContaining({
				submittedRevisionId: "revision-1",
				operationKind: "command",
				receipt: expect.objectContaining({
					idempotencyKey: `absence:${ABSENCE}:approve:initial:fp`,
				}),
				legacy: {
					approvalRequestId: REQUEST_1,
					chainStageId: null,
					observedWorkflowId: null,
				},
				assignmentOutcome: "approved",
				requestOutcome: "approved",
				decidedAt: parseInstant("2026-08-01T09:00:00Z"),
				labels: { actorName: "Morgan" },
			}),
		);
		expect(recorded.result).toMatchObject({
			decidedAtSource: "approval_request.approved_at",
			observation: null,
		});
	});

	it("records an intermediate chain approval as pending with the stage's persisted decider and time", async () => {
		const chainPlan = plan({
			revision: revision({ chainInstanceId: CHAIN }),
			before: state({
				chain: [
					{ id: "stage-1", requestId: REQUEST_1, status: "pending" },
					{ id: "stage-2", requestId: null, status: "pending" },
				],
			}),
		});
		await recordLegacyAbsenceDecisionEvidence(
			database,
			chainPlan,
			recordInput({
				captureState: vi.fn(async () =>
					state({
						request: { id: REQUEST_2, status: "pending" },
						chain: [
							{
								id: "stage-1",
								requestId: REQUEST_1,
								status: "approved",
								decidedBy: manager.employeeId,
							},
							{ id: "stage-2", requestId: REQUEST_2, status: "pending" },
						],
					}),
				),
			}),
		);
		expect(store.recordLegacyDecisionEvidence).toHaveBeenCalledWith(
			database,
			expect.objectContaining({
				legacy: expect.objectContaining({ chainStageId: "stage-1" }),
				assignmentOutcome: "approved",
				requestOutcome: "pending",
				decidedAt: parseInstant("2026-08-01T10:00:00Z"),
				result: expect.objectContaining({
					decidedAtSource: "approval_chain_stage_instance.decided_at",
				}),
			}),
		);
	});

	it.each([
		[
			"a chain decider that is not the actor",
			{
				before: state({
					chain: [{ id: "stage-1", requestId: REQUEST_1, status: "pending" }],
				}),
				revision: revision({ chainInstanceId: CHAIN }),
			},
			state({
				absenceStatus: "approved",
				chain: [
					{
						id: "stage-1",
						requestId: REQUEST_1,
						status: "approved",
						decidedBy: "someone-else",
					},
				],
			}),
			{},
		],
		[
			"an outcome other than the requested action",
			{},
			state({ request: { id: REQUEST_1, status: "rejected" } }),
			{},
		],
		[
			"a supplied request that is not the decided one",
			{},
			state({
				absenceStatus: "approved",
				request: { id: REQUEST_1, status: "approved" },
			}),
			{ approvalRequestId: REQUEST_2 },
		],
		[
			"a decided request outside the evidenced lifecycle",
			{ revision: revision({ approvalRequestId: REQUEST_2 }) },
			state({
				absenceStatus: "approved",
				request: { id: REQUEST_1, status: "approved" },
			}),
			{},
		],
	])("rolls back on %s", async (_label, planOverrides, after, input) => {
		await expect(
			recordLegacyAbsenceDecisionEvidence(
				database,
				plan(planOverrides),
				recordInput({ captureState: vi.fn(async () => after), ...input }),
			),
		).rejects.toBeInstanceOf(ApprovalEvidenceError);
		expect(store.recordLegacyDecisionEvidence).not.toHaveBeenCalled();
	});

	it("keeps the shadow observation separate and refuses one for a different linked workflow", async () => {
		const observed = {
			snapshot: { id: "workflow-observed" },
			events: [{ id: "event-1" }, { id: "event-2" }],
		} as never;
		await recordLegacyAbsenceDecisionEvidence(
			database,
			plan(),
			recordInput({
				observed,
				captureState: vi.fn(async () =>
					state({
						absenceStatus: "approved",
						approvalWorkflowId: null,
						request: { id: REQUEST_1, status: "approved" },
					}),
				),
			}),
		);
		expect(store.recordLegacyDecisionEvidence).toHaveBeenCalledWith(
			database,
			expect.objectContaining({
				legacy: expect.objectContaining({
					observedWorkflowId: "workflow-observed",
				}),
				result: expect.objectContaining({
					observation: {
						kind: "shadow",
						workflowId: "workflow-observed",
						eventIds: ["event-1", "event-2"],
					},
				}),
			}),
		);

		store.recordLegacyDecisionEvidence.mockClear();
		await expect(
			recordLegacyAbsenceDecisionEvidence(
				database,
				plan(),
				recordInput({
					observed,
					captureState: vi.fn(async () =>
						state({
							absenceStatus: "approved",
							approvalWorkflowId: "a-different-workflow",
							request: { id: REQUEST_1, status: "approved" },
						}),
					),
				}),
			),
		).rejects.toMatchObject({ code: "invariant" });
		expect(store.recordLegacyDecisionEvidence).not.toHaveBeenCalled();
	});
});

describe("captureLegacyAbsenceSubmissionEvidence", () => {
	function submissionDatabase() {
		const limit = vi.fn(async () => [
			{ createdAt: new Date("2026-07-30T08:00:00Z") },
		]);
		return {
			select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
		} as never;
	}

	function submission(
		overrides: Partial<
			Parameters<typeof captureLegacyAbsenceSubmissionEvidence>[1]
		>,
	) {
		return {
			organizationId: ORG,
			absenceId: ABSENCE,
			submissionKey: `absence:${ABSENCE}:submission`,
			routing: {
				kind: "default_created" as const,
				approvalRequestId: REQUEST_1,
			},
			captureState: vi.fn(async () => state({})),
			observed: null,
			subjectEmployeeId: "employee-1",
			requesterEmployeeId: "employee-1",
			submitterUserId: "user-1",
			category: { id: "category-1", name: "Vacation" },
			raw: { ...entry, durationKind: "full_day" as const },
			normalized: { ...entry, durationKind: "full_day" as const },
			entry,
			canonicalRecord: {
				id: "record-1",
				startAt: new Date("2026-08-03T00:00:00Z"),
				endAt: new Date("2026-08-05T00:00:00Z"),
			},
			...overrides,
		};
	}

	beforeEach(() => {
		store.captureLegacyAbsenceSubmittedRevision.mockImplementation(
			async (_db, input) => ({ ...revision(input.legacy), id: "revision-1" }),
		);
	});

	it("does nothing while capture is inactive", async () => {
		store.readApprovalEvidenceMode.mockResolvedValue("inactive");
		const input = submission({});
		await expect(
			captureLegacyAbsenceSubmissionEvidence(submissionDatabase(), input),
		).resolves.toBeNull();
		expect(input.captureState).not.toHaveBeenCalled();
		expect(store.captureLegacyAbsenceSubmittedRevision).not.toHaveBeenCalled();
	});

	it("links the revision to the legacy rows routing created, with the source's persisted creation time", async () => {
		await captureLegacyAbsenceSubmissionEvidence(
			submissionDatabase(),
			submission({}),
		);
		expect(store.captureLegacyAbsenceSubmittedRevision).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				requestCycleKey: `absence:${ABSENCE}:submission`,
				submittedAt: parseInstant("2026-07-30T08:00:00Z"),
				legacy: {
					approvalRequestId: REQUEST_1,
					chainInstanceId: null,
					observedWorkflowId: null,
				},
			}),
		);
		expect(store.recordLegacyDecisionEvidence).not.toHaveBeenCalled();
	});

	it.each([
		["missing raw input", { raw: undefined }],
		[
			"a chain the routing owner did not report",
			{
				captureState: vi.fn(async () =>
					state({
						chain: [{ id: "stage-1", requestId: REQUEST_1, status: "pending" }],
					}),
				),
			},
		],
		[
			"an auto-completion the legacy rows do not show",
			{
				routing: {
					kind: "auto_completed" as const,
					chainInstanceId: null,
					approvalRequestId: REQUEST_1,
				},
			},
		],
		[
			"a mirrored workflow the source is not linked to",
			{
				observed: {
					snapshot: { id: "workflow-observed" },
					events: [],
				} as never,
			},
		],
	])("refuses %s", async (_label, overrides) => {
		await expect(
			captureLegacyAbsenceSubmissionEvidence(
				submissionDatabase(),
				submission(overrides),
			),
		).rejects.toBeInstanceOf(ApprovalEvidenceError);
		expect(store.captureLegacyAbsenceSubmittedRevision).not.toHaveBeenCalled();
	});

	it("records requester auto-approval as a system activation at the persisted approval time", async () => {
		await captureLegacyAbsenceSubmissionEvidence(
			submissionDatabase(),
			submission({
				routing: {
					kind: "auto_completed",
					chainInstanceId: null,
					approvalRequestId: REQUEST_1,
				},
				captureState: vi.fn(async () =>
					state({
						absenceStatus: "approved",
						approvedAt: "2026-07-30T08:00:01.000Z",
						request: { id: REQUEST_1, status: "approved" },
					}),
				),
			}),
		);
		expect(store.recordLegacyDecisionEvidence).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				operationKind: "submission_activation",
				receipt: expect.objectContaining({
					idempotencyKey: `absence:${ABSENCE}:submission`,
				}),
				actor: { kind: "system", employeeId: null, userId: null },
				assignmentOutcome: null,
				requestOutcome: "approved",
				decidedAt: parseInstant("2026-07-30T08:00:01.000Z"),
			}),
		);
	});
});
