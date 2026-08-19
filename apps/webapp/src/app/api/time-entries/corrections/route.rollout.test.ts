import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

type RolloutMode = "legacy" | "shadow" | "ready" | "canonical" | "complete";
type FixtureRow = Record<string, unknown>;
type CorrectionRow = FixtureRow & {
	id: string;
	isSuperseded: boolean;
	replacesEntryId: string | null;
	timestamp: Date;
};

interface LegacyCoordinatorInput {
	idempotencyKey: string;
	afterMirror: (mirrored: unknown) => Promise<unknown>;
}

interface StartWorkflowInput {
	contextSnapshot: unknown;
	finalizeContextSnapshot: (input: {
		snapshot: { status: string; stages: FixtureRow[] };
		contextSnapshot: unknown;
	}) => unknown;
	bindSourceWorkflow: (workflowId: string) => Promise<unknown>;
}

const ids = {
	employee: "31000000-0000-4000-8000-000000000901",
	manager: "31000000-0000-4000-8000-000000000902",
	period: "21000000-0000-4000-8000-000000000901",
	clockIn: "61000000-0000-4000-8000-000000000901",
	clockOut: "61000000-0000-4000-8000-000000000902",
	request: "41000000-0000-4000-8000-000000000901",
	workflow: "51000000-0000-5000-8000-000000000901",
};
const submissionId = "31000000-0000-4000-8000-000000000906";

const state = vi.hoisted(() => ({
	mode: "legacy" as RolloutMode,
	autoComplete: false,
	executeCalls: 0,
	effectCount: 0,
	currentSubmissionId: "",
	submissionIds: [] as string[],
	submissionKeys: [] as string[],
	timeEntryFindManyCount: 0,
	legacyRequests: [] as FixtureRow[],
	workflows: [] as FixtureRow[],
	projections: [] as unknown[],
	outbox: [] as unknown[],
	bindings: [] as string[],
	compatibility: [] as unknown[],
	corrections: new Map<string, CorrectionRow>(),
	dispatch: vi.fn(),
	getSession: vi.fn(),
	headers: vi.fn(),
	getTimezone: vi.fn(),
	requireActor: vi.fn(),
	canApproveFor: vi.fn(),
	manager: vi.fn(),
	markDirty: vi.fn(),
	validateRange: vi.fn(),
}));

function authority(mode: RolloutMode) {
	return {
		mode,
		behavior: {
			serveFrom: mode === "complete" ? "canonical" : "legacy",
			writeLegacy: mode !== "complete",
			writeCanonical: mode !== "legacy",
			decideCanonical: mode === "canonical" || mode === "complete",
			mirror:
				mode === "shadow" || mode === "ready"
					? "legacy_to_canonical"
					: mode === "canonical"
						? "canonical_to_legacy"
						: "none",
		},
	};
}

const original = {
	id: ids.clockIn,
	employeeId: ids.employee,
	organizationId: "org-1",
	type: "clock_in",
	timestamp: new Date("2026-07-01T06:00:00.000Z"),
	hash: "original-hash",
	isSuperseded: false,
	replacesEntryId: null,
	utcOffsetMinutes: 120,
	timezone: "Europe/Berlin",
	timezoneSource: "browser",
};
const period = {
	id: ids.period,
	employeeId: ids.employee,
	organizationId: "org-1",
	clockInId: ids.clockIn,
	clockOutId: ids.clockOut,
	startTime: new Date("2026-07-01T06:00:00.000Z"),
	endTime: new Date("2026-07-01T14:00:00.000Z"),
	workLocationType: "office",
	workCategoryId: null,
	deletedAt: null,
	approvalWorkflowId: null as string | null,
};
const employee = {
	id: ids.employee,
	userId: "user-1",
	organizationId: "org-1",
	teamId: null,
	isActive: true,
};

function bindingWorkflow(overrides: Record<string, unknown> = {}) {
	return {
		id: ids.workflow,
		organizationId: "org-1",
		workflowType: "time_correction",
		sourceType: "time_entry",
		sourceId: ids.period,
		requesterEmployeeId: ids.employee,
		status: "pending",
		version: 1,
		submittedAt: new Date("2026-07-01T06:10:00.000Z"),
		completedAt: null,
		cancelledAt: null,
		currentStageOrder: 1,
		...overrides,
	};
}

function tableName(table: unknown): string {
	return String((table as Record<symbol, unknown>)[Symbol.for("drizzle:Name")]);
}

const db = {
	query: {
		timeEntry: {
			findFirst: vi.fn(async () => {
				const latest = [...state.corrections.values()].at(-1);
				return latest?.replacesEntryId === original.id ? latest : null;
			}),
			findMany: vi.fn(async () => {
				state.timeEntryFindManyCount += 1;
				return state.timeEntryFindManyCount % 2 === 1
					? [...state.corrections.values()]
					: [original];
			}),
		},
		employee: { findFirst: vi.fn(async () => employee) },
		approvalRequest: {
			findMany: vi.fn(async () => state.legacyRequests),
			findFirst: vi.fn(async () => state.legacyRequests.at(-1) ?? null),
		},
		approvalChainStageInstance: { findFirst: vi.fn(async () => null) },
		approvalWorkflow: {
			findFirst: vi.fn(async () => state.workflows.at(-1) ?? null),
		},
		workPeriod: {
			findFirst: vi.fn(async () => ({
				...period,
				approvalWorkflowId: period.approvalWorkflowId,
			})),
		},
	},
	select: vi.fn(() => ({
		from: vi.fn((table: unknown) => ({
			where: vi.fn(() => ({
				limit: vi.fn(async () => {
					switch (tableName(table)) {
						case "employee":
							return [employee];
						case "time_entry":
							return [original];
						case "work_period":
							return [period];
						default:
							return [];
					}
				}),
				for: vi.fn(async () => {
					switch (tableName(table)) {
						case "employee":
							return [employee];
						case "team_membership":
							return [];
						case "work_period":
							return [period];
						case "time_entry":
							return [original];
						default:
							return [];
					}
				}),
				orderBy: vi.fn(() => ({
					limit: vi.fn(() =>
						tableName(table) === "member"
							? {
									for: vi.fn(async () => [
										{
											id: "member-1",
											userId: "user-1",
											organizationId: "org-1",
											status: "approved",
										},
									]),
								}
							: Promise.resolve([original]),
					),
					for: vi.fn(async () => {
						switch (tableName(table)) {
							case "employee":
								return [employee];
							case "team_membership":
								return [];
							case "work_period":
								return [period];
							default:
								return [original];
						}
					}),
				})),
			})),
		})),
	})),
	insert: vi.fn((table: unknown) => ({
		values: vi.fn((values: FixtureRow) => ({
			returning: vi.fn(async () => {
				if (tableName(table) !== "time_entry") return [];
				const row = { ...values, supersededById: null } as CorrectionRow;
				state.corrections.set(String(values.id), row);
				return [row];
			}),
		})),
	})),
	update: vi.fn((table: unknown) => ({
		set: vi.fn((values: FixtureRow) => ({
			where: vi.fn(() => ({
				returning: vi.fn(async () => {
					if (
						tableName(table) === "work_period" &&
						typeof values.approvalWorkflowId === "string"
					) {
						period.approvalWorkflowId = values.approvalWorkflowId;
						state.bindings.push(values.approvalWorkflowId);
					}
					return [
						{
							id: ids.period,
							organizationId: "org-1",
							employeeId: ids.employee,
							...values,
						},
					];
				}),
			})),
		})),
	})),
	transaction: vi.fn(async (operation: (tx: typeof db) => Promise<unknown>) =>
		operation(db),
	),
};

const compatibilityWriter = {
	withWriteGate: vi.fn(() => compatibilityWriter),
	mirrorLegacyToCanonical: vi.fn(async () => {
		const snapshot = bindingWorkflow();
		state.workflows.push(snapshot);
		state.projections.push({ workflowId: ids.workflow });
		state.outbox.push({ workflowId: ids.workflow });
		return { snapshot, events: [], projection: {}, outbox: [] };
	}),
	mirrorCanonicalToLegacy: vi.fn(async () => {
		state.compatibility.push({ workflowId: ids.workflow });
		state.legacyRequests.push({
			id: ids.request,
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: ids.period,
			approverId: ids.manager,
			status: "pending",
			metadata: {
				workflow: { id: ids.workflow, organizationId: "org-1" },
				stage: { id: "stage-1", sequence: 1 },
			},
		});
	}),
};

const context = {
	dbService: {
		db,
		query: (name: string, query: () => Promise<unknown>) =>
			Effect.tryPromise({
				try: query,
				catch: (cause) => new Error(`${name}:${String(cause)}`),
			}),
	},
	writeGate: { acquire: vi.fn(async () => authority(state.mode)) },
	repository: {
		loadSnapshot: vi.fn(async () => state.workflows.at(-1)),
	},
	compatibilityWriter,
	projectionWriter: {},
	outboxWriter: {},
	adapterRegistry: {},
	activationResolver: {},
};

vi.mock("@/db", () => ({ db }));
vi.mock("next/headers", () => ({ headers: state.headers }));
vi.mock("next/server", async () => {
	const actual =
		await vi.importActual<typeof import("next/server")>("next/server");
	return { ...actual, connection: vi.fn() };
});
vi.mock("@/lib/auth", () => ({
	auth: { api: { getSession: state.getSession } },
}));
vi.mock("@/lib/auth-helpers", () => ({
	canApproveFor: state.canApproveFor,
	getAbility: vi.fn(),
}));
vi.mock("@/lib/time-tracking/clocking-service", () => ({
	ClockingAccessError: class ClockingAccessError extends Error {},
	clockingService: { requireActor: state.requireActor },
}));
vi.mock("@/lib/work-balance/service", () => ({
	markEmployeeWorkBalanceDirty: state.markDirty,
}));
vi.mock("@/lib/time-tracking/validation", () => ({
	validateTimeEntryRange: state.validateRange,
}));
vi.mock("@/lib/approvals/policies/manager-eligibility-db", () => ({
	getPrimaryEligibleManagerIdForRequester: state.manager,
}));
vi.mock("@/app/[locale]/(app)/time-tracking/actions/auth", () => ({
	getCurrentEmployee: vi.fn(async () => employee),
	getCurrentSession: state.getSession,
	getRequestMetadata: vi.fn(async () => ({
		ipAddress: "127.0.0.1",
		userAgent: "vitest",
	})),
	getUserTimezone: state.getTimezone,
}));
vi.mock("@/app/[locale]/(app)/time-tracking/actions/shared", () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock("@/lib/effect/runtime", () => ({
	runtime: { runPromise: Effect.runPromise },
}));

vi.mock("@/lib/approvals/workflow/runtime", () => ({
	createProductionApprovalWorkflowRuntime: () => ({
		repository: {
			withTransaction: async (
				operation: (value: typeof context) => Promise<unknown>,
			) => operation(context),
		},
		transitionEngine: {},
	}),
}));

vi.mock("@/lib/approvals/domain-adapters/legacy-write-coordinator", () => ({
	createLegacyApprovalWriteCoordinator: (dependencies: typeof context) => ({
		execute: async (input: LegacyCoordinatorInput) => {
			const gate = await dependencies.writeGate.acquire({
				organizationId: "org-1",
				workflowType: "time_correction",
			});
			const autoComplete = state.autoComplete;
			const correction = [...state.corrections.values()].at(-1);
			if (autoComplete && correction) correction.isSuperseded = false;
			state.legacyRequests.push({
				id: ids.request,
				organizationId: "org-1",
				entityType: "time_entry",
				entityId: ids.period,
				approverId: ids.manager,
				status: autoComplete ? "approved" : "pending",
				metadata: {
					timeCorrection: {
						action: "edit",
						clockInCorrectionId: [...state.corrections.keys()][0],
						workLocationType: "office",
						workCategoryId: null,
					},
					timeCorrectionOriginalWorkMetadata: {
						workLocationType: "office",
						workCategoryId: null,
					},
					submission: {
						key: input.idempotencyKey,
						submissionId: state.currentSubmissionId,
						resultKind: autoComplete ? "auto_completed" : "default_created",
						originalStatus: autoComplete ? "approved" : "pending",
					},
				},
			});
			if (gate.mode === "shadow" || gate.mode === "ready") {
				const mirrored = await dependencies.compatibilityWriter
					.withWriteGate(dependencies.writeGate)
					.mirrorLegacyToCanonical({});
				await input.afterMirror(mirrored);
			}
			return autoComplete
				? {
						kind: "auto_completed",
						chainInstanceId: null,
						approvalRequestId: ids.request,
						reason: "requester_is_approver",
						autoCompletion: {
							period,
							originalNotificationTime: original.timestamp,
							correctedNotificationTime: correction?.timestamp,
							workBalanceDirtyMark: {
								employeeId: ids.employee,
								organizationId: "org-1",
								dirtyFromDate: "2026-07-01",
							},
						},
					}
				: { kind: "default_created", approvalRequestId: ids.request };
		},
	}),
}));

vi.mock("@/lib/approvals/workflow/start-workflow", () => ({
	startApprovalWorkflow: async (input: StartWorkflowInput) => {
		const contextSnapshot = input.finalizeContextSnapshot({
			snapshot: { status: "pending", stages: [{}] },
			contextSnapshot: input.contextSnapshot,
		});
		const snapshot = {
			...bindingWorkflow(),
			contextSnapshot,
			stages: [
				{
					id: "stage-1",
					sequence: 1,
					status: "pending",
					activationMode: "human",
					legacyApprovalRequestId:
						state.mode === "canonical" ? ids.request : null,
					assignments: [
						{
							id: "assignment-1",
							status: "pending",
							approverEmployeeId: ids.manager,
						},
					],
				},
			],
		};
		state.workflows.push(snapshot);
		state.projections.push({ workflowId: ids.workflow });
		state.outbox.push({ workflowId: ids.workflow });
		await input.bindSourceWorkflow(ids.workflow);
		return {
			kind: "created",
			status: "pending",
			terminal: false,
			snapshot,
			events: [],
			projection: {},
			outbox: [],
		};
	},
}));

vi.mock(
	"@/lib/approvals/server/time-correction-approvals",
	async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import("@/lib/approvals/server/time-correction-approvals")
			>();
		return {
			...actual,
			executeTimeCorrectionSubmissionInTransaction: async (
				input: import("@/lib/approvals/server/time-correction-approvals").ExecuteTimeCorrectionSubmissionInput,
			) => {
				state.executeCalls += 1;
				state.currentSubmissionId = input.submissionId ?? "";
				state.submissionIds.push(input.submissionId ?? "");
				state.submissionKeys.push(input.submissionKey);
				return actual.executeTimeCorrectionSubmissionInTransaction(input);
			},
		};
	},
);

vi.mock(
	"@/lib/approvals/server/time-correction-submission",
	async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import("@/lib/approvals/server/time-correction-submission")
			>();
		return {
			...actual,
			dispatchCommittedTimeCorrectionSubmission: state.dispatch,
		};
	},
);

const { POST } = await import("./route");

function request(input: { key?: string | null; originalId?: string } = {}) {
	const headers = new Headers();
	const key = input.key === undefined ? submissionId : input.key;
	if (key !== null) headers.set("Idempotency-Key", key);
	return {
		headers,
		json: vi.fn(async () => ({
			replacesEntryId: input.originalId ?? original.id,
			timestamp: "2026-07-01T08:15:00+02:00",
			timezone: "Europe/Berlin",
			notes: "Correct clock-in",
			workLocationType: "office",
			workCategoryId: null,
		})),
	} as never;
}

describe("POST time correction rollout integration", () => {
	beforeEach(() => {
		state.executeCalls = 0;
		state.effectCount = 0;
		state.autoComplete = false;
		state.currentSubmissionId = "";
		state.submissionIds.length = 0;
		state.submissionKeys.length = 0;
		state.timeEntryFindManyCount = 0;
		state.legacyRequests.length = 0;
		state.workflows.length = 0;
		state.projections.length = 0;
		state.outbox.length = 0;
		state.bindings.length = 0;
		state.compatibility.length = 0;
		state.corrections.clear();
		original.id = ids.clockIn;
		period.clockInId = ids.clockIn;
		period.approvalWorkflowId = null;
		vi.clearAllMocks();
		state.getSession.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: "org-1" },
		});
		state.headers.mockResolvedValue(new Headers());
		state.getTimezone.mockResolvedValue("Europe/Berlin");
		state.requireActor.mockResolvedValue({
			employee,
			organizationId: "org-1",
			userId: "user-1",
		});
		state.canApproveFor.mockResolvedValue(false);
		state.manager.mockResolvedValue(ids.manager);
		state.validateRange.mockResolvedValue({ isValid: true });
		state.dispatch.mockImplementation(async (input) => {
			const effects = input.result.postCommit;
			if (effects.terminal || effects.submittedToEmployeeId)
				state.effectCount += 1;
		});
	});

	it.each([
		[
			"legacy",
			{
				legacy: 1,
				workflows: 0,
				projection: 0,
				outbox: 0,
				bind: 0,
				compatibility: 0,
			},
		],
		[
			"shadow",
			{
				legacy: 1,
				workflows: 1,
				projection: 1,
				outbox: 1,
				bind: 1,
				compatibility: 0,
			},
		],
		[
			"ready",
			{
				legacy: 1,
				workflows: 1,
				projection: 1,
				outbox: 1,
				bind: 1,
				compatibility: 0,
			},
		],
		[
			"canonical",
			{
				legacy: 1,
				workflows: 1,
				projection: 1,
				outbox: 1,
				bind: 1,
				compatibility: 1,
			},
		],
		[
			"complete",
			{
				legacy: 0,
				workflows: 1,
				projection: 1,
				outbox: 1,
				bind: 1,
				compatibility: 0,
			},
		],
	] as const)(
		"runs the actual submission boundary in %s mode",
		async (mode, expected) => {
			state.mode = mode;

			const response = await POST(request());

			expect(response.status).toBe(201);
			expect(await response.json()).toMatchObject({
				approvalId: expect.any(String),
				message: "Correction submitted. Awaiting manager approval.",
			});
			expect(state.executeCalls).toBe(1);
			expect(state.legacyRequests).toHaveLength(expected.legacy);
			expect(state.workflows).toHaveLength(expected.workflows);
			expect(state.projections).toHaveLength(expected.projection);
			expect(state.outbox).toHaveLength(expected.outbox);
			expect(state.bindings).toHaveLength(expected.bind);
			expect(state.compatibility).toHaveLength(expected.compatibility);
		},
	);

	it("allocates a new headerless identity for an identical submission after cancellation", async () => {
		state.mode = "legacy";

		const first = await POST(request({ key: null }));
		const firstCorrectionId = [...state.corrections.keys()][0];
		state.legacyRequests.length = 0;
		state.workflows.length = 0;
		state.corrections.clear();
		period.approvalWorkflowId = null;
		const later = await POST(request({ key: null }));
		const correctionIds = [...state.corrections.keys()];

		expect(first.status).toBe(201);
		expect(later.status).toBe(201);
		expect(state.submissionIds[1]).not.toBe(state.submissionIds[0]);
		expect(state.submissionKeys[1]).not.toBe(state.submissionKeys[0]);
		expect(correctionIds).toHaveLength(1);
		expect(correctionIds[0]).not.toBe(firstCorrectionId);
	});

	it("runs fresh auto-completion maintenance once and makes the exact REST replay effect-free", async () => {
		state.mode = "legacy";
		state.autoComplete = true;

		const first = await POST(request());
		const firstPayload = await first.json();
		const replay = await POST(request());
		const replayPayload = await replay.json();

		expect(first.status).toBe(201);
		expect(replay.status).toBe(201);
		expect(replayPayload).toEqual(firstPayload);
		expect([...state.corrections.values()][0]).toMatchObject({
			isSuperseded: false,
		});
		expect(state.effectCount).toBe(1);
	});
});
