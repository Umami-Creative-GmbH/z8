import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	addCalendarSyncJob,
	markEmployeeWorkBalanceDirty,
	onAbsenceRequestApproved,
	onAbsenceRequestRejected,
	isEligibleManagerForApprovalRequest,
} = vi.hoisted(() => ({
	addCalendarSyncJob: vi.fn().mockResolvedValue(undefined),
	markEmployeeWorkBalanceDirty: vi.fn().mockResolvedValue(undefined),
	onAbsenceRequestApproved: vi.fn(),
	onAbsenceRequestRejected: vi.fn(),
	isEligibleManagerForApprovalRequest: vi.fn(),
}));

vi.mock("@/env", () => ({
	env: {
		BETTER_AUTH_SECRET: "test-secret",
		S3_PUBLIC_BUCKET: "test-bucket",
		S3_PUBLIC_ACCESS_KEY_ID: "test-access-key",
		S3_PUBLIC_SECRET_ACCESS_KEY: "test-secret-key",
		S3_PUBLIC_ENDPOINT: "https://example.com",
		S3_PUBLIC_URL: "https://example.com",
		S3_PUBLIC_REGION: "us-east-1",
		S3_PUBLIC_FORCE_PATH_STYLE: "true",
		NODE_ENV: "test",
	},
}));

vi.mock("@/lib/app-url", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/app-url")>();
	return {
		...actual,
		getOrganizationBaseUrl: vi
			.fn()
			.mockResolvedValue("https://app.example.com"),
	};
});

vi.mock("@/lib/email/render", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/email/render")>();
	return {
		...actual,
		renderAbsenceRequestApproved: vi.fn().mockResolvedValue("<p>approved</p>"),
		renderAbsenceRequestRejected: vi.fn().mockResolvedValue("<p>rejected</p>"),
	};
});

vi.mock("@/lib/notifications/triggers", () => ({
	onAbsenceRequestApproved,
	onAbsenceRequestRejected,
}));

vi.mock("@/lib/queue", () => ({
	addCalendarSyncJob,
}));

vi.mock("@/lib/work-balance/service", () => ({
	markEmployeeWorkBalanceDirty,
}));

vi.mock("@/lib/approvals/policies/manager-eligibility-db", () => ({
	isEligibleManagerForApprovalRequest,
}));

import { ApprovalAuditLogger } from "@/lib/approvals/infrastructure/audit-logger";
import { resolvePolicyAndCreateApproval } from "@/lib/approvals/policies/chain-service";
import {
	buildAbsenceApprovalPolicyContext,
	createAbsenceApprovalManagementAuthorization,
	createAbsenceApprovalWorkflow,
	executeAbsenceDecisionInTransaction,
	formatAbsenceDateForEmail,
	translateAbsenceDecisionError,
} from "@/lib/approvals/server/absence-approvals";
import type {
	ApprovalDbService,
	CurrentApprover,
} from "@/lib/approvals/server/types";
import { ApprovalTransitionEngineError } from "@/lib/approvals/workflow/transition-engine";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	AuthorizationError,
	ConflictError,
	EmailError,
	ValidationError,
} from "@/lib/effect/errors";
import { EmailService } from "@/lib/effect/services/email.service";

beforeEach(() => {
	addCalendarSyncJob.mockClear();
	markEmployeeWorkBalanceDirty.mockClear();
	onAbsenceRequestApproved.mockClear();
	onAbsenceRequestRejected.mockClear();
	isEligibleManagerForApprovalRequest.mockReset();
	isEligibleManagerForApprovalRequest.mockResolvedValue(false);
});

describe("absence canonical decision errors", () => {
	it.each([
		["forbidden", AuthorizationError],
		["version_conflict", ConflictError],
		["idempotency_mismatch", ConflictError],
		["malformed_command", ValidationError],
	] as const)("translates %s before the typed handler boundary", (code, ExpectedError) => {
		const translated = translateAbsenceDecisionError(
			new ApprovalTransitionEngineError(code),
		);

		expect(translated).toBeInstanceOf(ExpectedError);
	});

	it.each([
		"invariant",
		"result_scope",
		"activation_cycle",
	] as const)("keeps internal %s failures internal", (code) => {
		const engineError = new ApprovalTransitionEngineError(code);

		expect(translateAbsenceDecisionError(engineError)).toBe(engineError);
	});
});

function createPolicyResolutionDbService(policies: unknown[]) {
	const inserts: Array<{ table: unknown; values: Record<string, unknown> }> =
		[];
	const updates: Record<string, unknown>[] = [];
	const absence = {
		id: "absence-1",
		employeeId: "emp-requester",
		organizationId: "org-1",
		canonicalRecordId: null,
		startDate: "2026-05-11",
		startPeriod: "full_day" as const,
		endDate: "2026-05-12",
		endPeriod: "full_day" as const,
		status: "pending",
		rejectionReason: null,
		category: { name: "Vacation", type: "vacation", color: null },
		employee: {
			userId: "user-requester",
			organizationId: "org-1",
			user: {
				name: "Avery Requester",
				email: "avery@example.com",
				image: null,
			},
		},
	};
	const db = {
		query: {
			approvalPolicy: { findMany: vi.fn().mockResolvedValue(policies) },
			employeeGroupMember: { findMany: vi.fn().mockResolvedValue([]) },
			employeeGroup: { findMany: vi.fn().mockResolvedValue([]) },
			employee: {
				findMany: vi.fn().mockResolvedValue([
					{
						id: "emp-requester",
						userId: "user-requester",
						organizationId: "org-1",
						isActive: true,
						role: "employee",
					},
					{
						id: "emp-manager",
						organizationId: "org-1",
						isActive: true,
						role: "manager",
					},
				]),
				findFirst: vi.fn().mockResolvedValue({
					id: "emp-requester",
					userId: "user-requester",
					organizationId: "org-1",
					role: "employee",
					user: absence.employee.user,
				}),
			},
			absenceEntry: { findFirst: vi.fn().mockResolvedValue(absence) },
			employeeManagers: {
				findMany: vi.fn().mockResolvedValue([
					{
						employeeId: "emp-requester",
						managerId: "emp-manager",
						isPrimary: true,
					},
				]),
			},
			teamMembership: { findMany: vi.fn().mockResolvedValue([]) },
			team: { findMany: vi.fn().mockResolvedValue([]) },
		},
		insert: vi.fn((table: unknown) => ({
			values: vi.fn((values: Record<string, unknown>) => {
				inserts.push({ table, values });
				return {
					returning: vi
						.fn()
						.mockResolvedValue([{ id: `insert-${inserts.length}` }]),
				};
			}),
		})),
		update: vi.fn(() => ({
			set: vi.fn((values: Record<string, unknown>) => ({
				where: vi.fn(() => {
					updates.push(values);
					return {
						returning: vi.fn().mockResolvedValue([{ id: "absence-1" }]),
					};
				}),
			})),
		})),
	};
	const transaction = vi.fn(
		async (operation: (transactionDb: typeof db) => Promise<unknown>) =>
			await operation(db),
	);
	const dbService = {
		db: {
			...db,
			transaction,
		},
		query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn),
	} as unknown as ApprovalDbService;

	return { dbService, inserts, updates, transaction };
}

const absencePolicyContext = buildAbsenceApprovalPolicyContext({
	id: "absence-1",
	organizationId: "org-1",
	employeeId: "emp-requester",
	categoryId: "category-1",
	employee: { teamId: "team-1" },
});

const absenceCurrentApprover: CurrentApprover = {
	id: "emp-manager",
	userId: "user-manager",
	organizationId: "org-1",
	user: {
		id: "user-manager",
		name: "Morgan Manager",
		email: "morgan@example.com",
		image: null,
	},
};

function createAbsenceDecisionDbService(
	absenceOverrides: Partial<{
		startPeriod: "full_day" | "am" | "pm";
		endPeriod: "full_day" | "am" | "pm";
		category: { name: string; type: string; color: string | null };
	}> = {},
) {
	const db = {
		query: {
			approvalRequest: {
				findFirst: vi.fn().mockResolvedValue({
					id: "approval-1",
					organizationId: "org-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					requestedBy: "emp-requester",
					approverId: "emp-manager",
					status: "pending",
				}),
			},
			approvalChainStageInstance: {
				findFirst: vi.fn().mockResolvedValue(null),
			},
			absenceEntry: {
				findFirst: vi.fn().mockResolvedValue({
					id: "absence-1",
					employeeId: "emp-requester",
					organizationId: "org-1",
					canonicalRecordId: null,
					startDate: "2026-05-11",
					startPeriod: absenceOverrides.startPeriod ?? "full_day",
					endDate: "2026-05-12",
					endPeriod: absenceOverrides.endPeriod ?? "full_day",
					status: "approved",
					rejectionReason: null,
					category: absenceOverrides.category ?? {
						name: "Vacation",
						type: "vacation",
						color: null,
					},
					employee: {
						userId: "user-requester",
						organizationId: "org-1",
						user: {
							name: "Avery Requester",
							email: "avery@example.com",
							image: null,
						},
					},
				}),
			},
			holiday: { findMany: vi.fn().mockResolvedValue([]) },
		},
		update: vi.fn().mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					returning: vi.fn().mockResolvedValue([{ id: "absence-1" }]),
				}),
			}),
		}),
		insert: vi
			.fn()
			.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
		transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => fn(db)),
	};

	return {
		db,
		query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn),
	} as unknown as ApprovalDbService;
}

function runAbsenceDecisionEffect(
	effect: Effect.Effect<unknown, unknown, unknown>,
	emailService = {
		send: vi.fn(() => Effect.succeed({ messageId: "message-1" })),
	},
) {
	return Effect.runPromise(
		effect.pipe(
			Effect.provideService(EmailService, emailService),
			Effect.provideService(ApprovalAuditLogger, {
				log: vi.fn(() => Effect.void),
				logBatch: vi.fn(() => Effect.void),
			}),
		),
	);
}

describe("formatAbsenceDateForEmail", () => {
	it("formats dates for absence emails", () => {
		expect(
			formatAbsenceDateForEmail(new Date("2026-03-09T00:00:00.000Z")),
		).toBe("Mar 9, 2026");
	});
});

describe("finalizeAbsenceTerminalInTransaction", () => {
	function collectSqlColumnNames(value: unknown): string[] {
		if (!value || typeof value !== "object") return [];
		const candidate = value as {
			config?: { name?: unknown };
			queryChunks?: unknown[];
		};
		return [
			...(typeof candidate.config?.name === "string"
				? [candidate.config.name]
				: []),
			...(candidate.queryChunks?.flatMap(collectSqlColumnNames) ?? []),
		];
	}

	function collectSqlBoundValues(value: unknown): unknown[] {
		if (!value || typeof value !== "object") return [];
		const candidate = value as { value?: unknown; queryChunks?: unknown[] };
		return [
			...("value" in candidate ? [candidate.value] : []),
			...(candidate.queryChunks?.flatMap(collectSqlBoundValues) ?? []),
		];
	}

	function createTerminalFinalizerDb(
		options: {
			sourceRows?: Array<{ id: string }>;
			canonicalRows?: Array<{ id: string }>;
			category?: { name: string; type: string; color: string | null };
			changedLink?: "workflow" | "canonical";
		} = {},
	) {
		const sourceRows = options.sourceRows ?? [{ id: "absence-1" }];
		const canonicalRows = options.canonicalRows ?? [{ id: "canonical-1" }];
		const updates: Array<Record<string, unknown>> = [];
		const transaction = vi.fn();
		const sourceWhereClauses: unknown[] = [];
		const absence = {
			id: "absence-1",
			employeeId: "emp-requester",
			organizationId: "org-1",
			canonicalRecordId: "canonical-1",
			approvalWorkflowId: "workflow-1",
			startDate: "2026-05-11",
			startPeriod: "full_day" as const,
			endDate: "2026-05-12",
			endPeriod: "full_day" as const,
			status: "approved",
			rejectionReason: null,
			category: options.category ?? {
				name: "Vacation",
				type: "vacation",
				color: null,
			},
			employee: {
				userId: "user-requester",
				organizationId: "org-1",
				user: { name: "Avery", email: "avery@example.com", image: null },
			},
		};
		let updateIndex = 0;
		const db = {
			transaction,
			query: {
				absenceEntry: { findFirst: vi.fn().mockResolvedValue(absence) },
			},
			update: vi.fn(() => ({
				set: vi.fn((values: Record<string, unknown>) => ({
					where: vi.fn((whereClause: unknown) => {
						updates.push(values);
						const currentIndex = updateIndex++;
						if (currentIndex === 0) sourceWhereClauses.push(whereClause);
						const expectedColumn =
							options.changedLink === "workflow"
								? "approval_workflow_id"
								: "canonical_record_id";
						const expectedValue =
							options.changedLink === "workflow" ? "workflow-1" : "canonical-1";
						const detectsChangedLink =
							currentIndex === 0 &&
							options.changedLink !== undefined &&
							collectSqlColumnNames(whereClause).includes(expectedColumn) &&
							collectSqlBoundValues(whereClause).includes(expectedValue);
						return {
							returning: vi
								.fn()
								.mockResolvedValue(
									currentIndex === 0
										? detectsChangedLink
											? []
											: sourceRows
										: canonicalRows,
								),
						};
					}),
				})),
			})),
		};
		return {
			dbService: {
				db,
				query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn),
			} as unknown as ApprovalDbService,
			updates,
			transaction,
			sourceWhereClauses,
		};
	}

	it("approves once with the supplied instant and synchronizes the canonical record", async () => {
		const finalizedAt = parseInstant("2026-07-18T09:00:00Z");
		const { finalizeAbsenceTerminalInTransaction } = await import(
			"@/lib/approvals/server/absence-approvals"
		);
		const { dbService, updates, transaction } = createTerminalFinalizerDb();

		const result = await finalizeAbsenceTerminalInTransaction({
			dbService,
			organizationId: "org-1",
			absenceId: "absence-1",
			expectedApprovalWorkflowId: "workflow-1",
			expectedCanonicalRecordId: "canonical-1",
			actorEmployeeId: "emp-manager",
			actorUserId: "user-manager",
			transition: { kind: "approve" },
			finalizedAt,
		});

		expect(updates).toEqual([
			expect.objectContaining({
				status: "approved",
				approvedBy: "emp-manager",
				approvedAt: new Date("2026-07-18T09:00:00.000Z"),
			}),
			expect.objectContaining({
				approvalState: "approved",
				updatedAt: new Date("2026-07-18T09:00:00.000Z"),
				updatedBy: "user-manager",
			}),
		]);
		expect(result).toMatchObject({
			absence: { id: "absence-1" },
			vacationOverrideSummary: {
				updatedAbsenceIds: [],
				createdAbsenceIds: [],
				deletedAbsenceIds: [],
			},
		});
		expect(transaction).not.toHaveBeenCalled();
		expect(addCalendarSyncJob).not.toHaveBeenCalled();
		expect(onAbsenceRequestApproved).not.toHaveBeenCalled();
	});

	it("rejects once with canonical parity and no approval timestamp", async () => {
		const { finalizeAbsenceTerminalInTransaction } = await import(
			"@/lib/approvals/server/absence-approvals"
		);
		const { dbService, updates } = createTerminalFinalizerDb();

		await finalizeAbsenceTerminalInTransaction({
			dbService,
			organizationId: "org-1",
			absenceId: "absence-1",
			expectedApprovalWorkflowId: "workflow-1",
			expectedCanonicalRecordId: "canonical-1",
			actorEmployeeId: "emp-manager",
			actorUserId: "user-manager",
			transition: { kind: "reject", reason: "No balance" },
			finalizedAt: parseInstant("2026-07-18T09:00:00Z"),
		});

		expect(updates[0]).toEqual(
			expect.objectContaining({
				status: "rejected",
				rejectionReason: "No balance",
			}),
		);
		expect(updates[0]).not.toHaveProperty("approvedAt");
		expect(updates[1]).toEqual(
			expect.objectContaining({
				approvalState: "rejected",
				updatedBy: "user-manager",
			}),
		);
	});

	it("fails closed when the scoped pending update affects no row", async () => {
		const { finalizeAbsenceTerminalInTransaction } = await import(
			"@/lib/approvals/server/absence-approvals"
		);
		const { dbService } = createTerminalFinalizerDb({ sourceRows: [] });

		await expect(
			finalizeAbsenceTerminalInTransaction({
				dbService,
				organizationId: "org-1",
				absenceId: "absence-1",
				expectedApprovalWorkflowId: "workflow-1",
				expectedCanonicalRecordId: "canonical-1",
				actorEmployeeId: "emp-manager",
				actorUserId: "user-manager",
				transition: { kind: "approve" },
				finalizedAt: parseInstant("2026-07-18T09:00:00Z"),
			}),
		).rejects.toThrow(/pending absence/i);
	});

	it.each([
		["a different source", [{ id: "absence-2" }]],
		["duplicate sources", [{ id: "absence-1" }, { id: "absence-1" }]],
	] as const)("fails closed when the source CAS returns %s", async (_label, sourceRows) => {
		const { finalizeAbsenceTerminalInTransaction } = await import(
			"@/lib/approvals/server/absence-approvals"
		);
		const { dbService } = createTerminalFinalizerDb({
			sourceRows: [...sourceRows],
		});

		await expect(
			finalizeAbsenceTerminalInTransaction({
				dbService,
				organizationId: "org-1",
				absenceId: "absence-1",
				expectedApprovalWorkflowId: "workflow-1",
				expectedCanonicalRecordId: "canonical-1",
				actorEmployeeId: "emp-manager",
				actorUserId: "user-manager",
				transition: { kind: "approve" },
				finalizedAt: parseInstant("2026-07-18T09:00:00Z"),
			}),
		).rejects.toThrow(/pending absence/i);
	});

	it("rejects a null terminal canonical link before mutating the source", async () => {
		const { finalizeAbsenceTerminalInTransaction } = await import(
			"@/lib/approvals/server/absence-approvals"
		);
		const { dbService, updates } = createTerminalFinalizerDb();

		await expect(
			finalizeAbsenceTerminalInTransaction({
				dbService,
				organizationId: "org-1",
				absenceId: "absence-1",
				expectedApprovalWorkflowId: "workflow-1",
				expectedCanonicalRecordId: null as never,
				actorEmployeeId: "emp-manager",
				actorUserId: "user-manager",
				transition: { kind: "approve" },
				finalizedAt: parseInstant("2026-07-18T09:00:00Z"),
			}),
		).rejects.toThrow(/expected absence links/i);
		expect(updates).toEqual([]);
	});

	it.each([
		["approve", "missing", []],
		["approve", "deleted", []],
		["approve", "mismatched", [{ id: "canonical-2" }]],
		["reject", "missing", []],
		["reject", "deleted", []],
		["reject", "mismatched", [{ id: "canonical-2" }]],
	] as const)("rejects %s when canonical parity is %s after the guarded source update", async (kind, _scenario, canonicalRows) => {
		const { finalizeAbsenceTerminalInTransaction } = await import(
			"@/lib/approvals/server/absence-approvals"
		);
		const { dbService, updates, transaction } = createTerminalFinalizerDb({
			canonicalRows: [...canonicalRows],
		});

		await expect(
			finalizeAbsenceTerminalInTransaction({
				dbService,
				organizationId: "org-1",
				absenceId: "absence-1",
				expectedApprovalWorkflowId: "workflow-1",
				expectedCanonicalRecordId: "canonical-1",
				actorEmployeeId: "emp-manager",
				actorUserId: "user-manager",
				transition:
					kind === "approve" ? { kind } : { kind, reason: "No balance" },
				finalizedAt: parseInstant("2026-07-18T09:00:00Z"),
			}),
		).rejects.toThrow(/canonical absence parity/i);
		expect(updates[0]).toEqual(
			expect.objectContaining({
				status: kind === "approve" ? "approved" : "rejected",
			}),
		);
		expect(transaction).not.toHaveBeenCalled();
	});

	it("rejects duplicate canonical affected-row evidence", async () => {
		const { finalizeAbsenceTerminalInTransaction } = await import(
			"@/lib/approvals/server/absence-approvals"
		);
		const { dbService } = createTerminalFinalizerDb({
			canonicalRows: [{ id: "canonical-1" }, { id: "canonical-1" }],
		});

		await expect(
			finalizeAbsenceTerminalInTransaction({
				dbService,
				organizationId: "org-1",
				absenceId: "absence-1",
				expectedApprovalWorkflowId: "workflow-1",
				expectedCanonicalRecordId: "canonical-1",
				actorEmployeeId: "emp-manager",
				actorUserId: "user-manager",
				transition: { kind: "approve" },
				finalizedAt: parseInstant("2026-07-18T09:00:00Z"),
			}),
		).rejects.toThrow(/canonical absence parity/i);
	});

	it("uses the shared finalizer to apply sick vacation overrides inside the caller transaction", async () => {
		vi.resetModules();
		const adjustVacationAbsencesForSickness = vi.fn().mockResolvedValue({
			updatedAbsenceIds: ["vacation-updated"],
			createdAbsenceIds: [],
			deletedAbsenceIds: [],
		});
		vi.doMock(
			"@/lib/absences/sick-vacation-override",
			async (importOriginal) => {
				const actual =
					await importOriginal<
						typeof import("@/lib/absences/sick-vacation-override")
					>();
				return { ...actual, adjustVacationAbsencesForSickness };
			},
		);
		const { finalizeAbsenceTerminalInTransaction } = await import(
			"@/lib/approvals/server/absence-approvals"
		);
		const { dbService, transaction } = createTerminalFinalizerDb({
			category: { name: "Sick", type: "sick", color: null },
		});

		const result = await finalizeAbsenceTerminalInTransaction({
			dbService,
			organizationId: "org-1",
			absenceId: "absence-1",
			expectedApprovalWorkflowId: "workflow-1",
			expectedCanonicalRecordId: "canonical-1",
			actorEmployeeId: "emp-manager",
			actorUserId: "user-manager",
			transition: { kind: "approve" },
			finalizedAt: parseInstant("2026-07-18T09:00:00Z"),
		});

		expect(adjustVacationAbsencesForSickness).toHaveBeenCalledWith({
			tx: dbService.db,
			organizationId: "org-1",
			employeeId: "emp-requester",
			sickStartDate: "2026-05-11",
			sickEndDate: "2026-05-12",
			updatedBy: "user-manager",
		});
		expect(result).toMatchObject({
			vacationOverrideSummary: { updatedAbsenceIds: ["vacation-updated"] },
		});
		expect(transaction).not.toHaveBeenCalled();
		vi.doUnmock("@/lib/absences/sick-vacation-override");
	});

	it.each([
		["approve", "workflow"],
		["approve", "canonical"],
		["reject", "workflow"],
		["reject", "canonical"],
	] as const)("rejects %s after a concurrent %s link change", async (kind, changedLink) => {
		const { finalizeAbsenceTerminalInTransaction } = await import(
			"@/lib/approvals/server/absence-approvals"
		);
		const { dbService, sourceWhereClauses } = createTerminalFinalizerDb({
			changedLink,
		});

		await expect(
			finalizeAbsenceTerminalInTransaction({
				dbService,
				organizationId: "org-1",
				absenceId: "absence-1",
				expectedApprovalWorkflowId: "workflow-1",
				expectedCanonicalRecordId: "canonical-1",
				actorEmployeeId: "emp-manager",
				actorUserId: "user-manager",
				transition:
					kind === "approve" ? { kind } : { kind, reason: "No balance" },
				finalizedAt: parseInstant("2026-07-18T09:00:00Z"),
			}),
		).rejects.toThrow(/pending absence/i);
		expect(sourceWhereClauses).toHaveLength(1);
	});
});

describe("absence requester decision notifications", () => {
	it("marks work balances dirty when approving an absence", async () => {
		vi.resetModules();
		vi.doMock("@/lib/approvals/server/shared", () => ({
			processApproval: vi.fn(),
			processApprovalWithCurrentEmployee: vi.fn(
				(
					dbService: ApprovalDbService,
					currentEmployee: CurrentApprover,
					_entityType: string,
					entityId: string,
					_action: string,
					_reason: string | undefined,
					updateEntity: (
						dbService: ApprovalDbService,
						entityId: string,
						currentEmployee: CurrentApprover,
					) => Effect.Effect<unknown, unknown, unknown>,
				) =>
					Effect.gen(function* (_) {
						yield* _(
							Effect.promise(() =>
								dbService.db.transaction(async () => undefined),
							),
						);
						return yield* _(updateEntity(dbService, entityId, currentEmployee));
					}),
			),
		}));
		const { approveAbsenceWithCurrentApproverEffect } = await import(
			"@/lib/approvals/server/absence-approvals"
		);
		const dbService = createAbsenceDecisionDbService();

		await runAbsenceDecisionEffect(
			approveAbsenceWithCurrentApproverEffect(
				dbService,
				absenceCurrentApprover,
				"absence-1",
			),
		);

		expect(markEmployeeWorkBalanceDirty).toHaveBeenCalledWith({
			employeeId: "emp-requester",
			organizationId: "org-1",
			dirtyFromDate: "2026-05-11",
		});
		expect(dbService.db.transaction).toHaveBeenCalled();
		expect(
			vi.mocked(dbService.db.transaction).mock.invocationCallOrder[0],
		).toBeLessThan(markEmployeeWorkBalanceDirty.mock.invocationCallOrder[0]);
		vi.doUnmock("@/lib/approvals/server/shared");
	});

	it("keeps approval successful when dirty marking fails", async () => {
		vi.resetModules();
		vi.doMock("@/lib/approvals/server/shared", () => ({
			processApproval: vi.fn(),
			processApprovalWithCurrentEmployee: vi.fn(
				(
					dbService: ApprovalDbService,
					currentEmployee: CurrentApprover,
					_entityType: string,
					entityId: string,
					_action: string,
					_reason: string | undefined,
					updateEntity: (
						dbService: ApprovalDbService,
						entityId: string,
						currentEmployee: CurrentApprover,
					) => Effect.Effect<unknown, unknown, unknown>,
				) => updateEntity(dbService, entityId, currentEmployee),
			),
		}));
		const { approveAbsenceWithCurrentApproverEffect } = await import(
			"@/lib/approvals/server/absence-approvals"
		);
		const dbService = createAbsenceDecisionDbService();
		markEmployeeWorkBalanceDirty.mockRejectedValueOnce(
			new Error("dirty marker failed"),
		);

		await expect(
			runAbsenceDecisionEffect(
				approveAbsenceWithCurrentApproverEffect(
					dbService,
					absenceCurrentApprover,
					"absence-1",
				),
			),
		).resolves.toBeDefined();
		expect(onAbsenceRequestApproved).toHaveBeenCalled();
		vi.doUnmock("@/lib/approvals/server/shared");
	});

	it("keeps approval successful when requester email delivery fails", async () => {
		vi.resetModules();
		vi.doMock("@/lib/approvals/server/shared", () => ({
			processApproval: vi.fn(),
			processApprovalWithCurrentEmployee: vi.fn(
				(
					dbService: ApprovalDbService,
					currentEmployee: CurrentApprover,
					_entityType: string,
					entityId: string,
					_action: string,
					_reason: string | undefined,
					updateEntity: (
						dbService: ApprovalDbService,
						entityId: string,
						currentEmployee: CurrentApprover,
					) => Effect.Effect<unknown, unknown, unknown>,
				) => updateEntity(dbService, entityId, currentEmployee),
			),
		}));
		const { approveAbsenceWithCurrentApproverEffect } = await import(
			"@/lib/approvals/server/absence-approvals"
		);
		const dbService = createAbsenceDecisionDbService();
		const emailService = {
			send: vi.fn(() =>
				Effect.fail(
					new EmailError({
						message: "Failed to send email",
						recipient: "avery@example.com",
					}),
				),
			),
		};

		await expect(
			runAbsenceDecisionEffect(
				approveAbsenceWithCurrentApproverEffect(
					dbService,
					absenceCurrentApprover,
					"absence-1",
				),
				emailService,
			),
		).resolves.toBeDefined();
		expect(emailService.send).toHaveBeenCalledWith(
			expect.objectContaining({ to: "avery@example.com" }),
		);
		expect(onAbsenceRequestApproved).toHaveBeenCalled();
		vi.doUnmock("@/lib/approvals/server/shared");
	});

	it("keeps rejection successful when requester email delivery fails", async () => {
		vi.resetModules();
		vi.doMock("@/lib/approvals/server/shared", () => ({
			processApproval: vi.fn(),
			processApprovalWithCurrentEmployee: vi.fn(
				(
					dbService: ApprovalDbService,
					currentEmployee: CurrentApprover,
					_entityType: string,
					entityId: string,
					_action: string,
					_reason: string | undefined,
					updateEntity: (
						dbService: ApprovalDbService,
						entityId: string,
						currentEmployee: CurrentApprover,
					) => Effect.Effect<unknown, unknown, unknown>,
				) => updateEntity(dbService, entityId, currentEmployee),
			),
		}));
		const { rejectAbsenceWithCurrentApproverEffect } = await import(
			"@/lib/approvals/server/absence-approvals"
		);
		const dbService = createAbsenceDecisionDbService();
		const emailService = {
			send: vi.fn(() =>
				Effect.fail(
					new EmailError({
						message: "Failed to send email",
						recipient: "avery@example.com",
					}),
				),
			),
		};

		await expect(
			runAbsenceDecisionEffect(
				rejectAbsenceWithCurrentApproverEffect(
					dbService,
					absenceCurrentApprover,
					"absence-1",
					"Insufficient balance",
				),
				emailService,
			),
		).resolves.toBeDefined();
		expect(emailService.send).toHaveBeenCalledWith(
			expect.objectContaining({ to: "avery@example.com" }),
		);
		expect(onAbsenceRequestRejected).toHaveBeenCalled();
		vi.doUnmock("@/lib/approvals/server/shared");
	});

	it("applies sick vacation overrides when approving a full-day sick absence", async () => {
		vi.resetModules();
		const syncCanonicalAbsenceApprovalState = vi
			.fn()
			.mockResolvedValue(undefined);
		const syncCanonicalAbsenceApprovalStateInTransaction = vi
			.fn()
			.mockResolvedValue(undefined);
		const adjustVacationAbsencesForSickness = vi.fn().mockResolvedValue({
			updatedAbsenceIds: ["vacation-updated"],
			createdAbsenceIds: ["vacation-created"],
			deletedAbsenceIds: ["vacation-deleted"],
		});
		vi.doMock(
			"@/app/[locale]/(app)/absences/actions.canonical",
			async (importOriginal) => {
				const actual =
					await importOriginal<
						typeof import("@/app/[locale]/(app)/absences/actions.canonical")
					>();
				return {
					...actual,
					syncCanonicalAbsenceApprovalState,
					syncCanonicalAbsenceApprovalStateInTransaction,
				};
			},
		);
		vi.doMock(
			"@/lib/absences/sick-vacation-override",
			async (importOriginal) => {
				const actual =
					await importOriginal<
						typeof import("@/lib/absences/sick-vacation-override")
					>();
				return { ...actual, adjustVacationAbsencesForSickness };
			},
		);
		vi.doMock("@/lib/approvals/server/shared", () => ({
			processApproval: vi.fn(),
			processApprovalWithCurrentEmployee: vi.fn(
				(
					dbService: ApprovalDbService,
					currentEmployee: CurrentApprover,
					_entityType: string,
					entityId: string,
					_action: string,
					_reason: string | undefined,
					_updateEntity: unknown,
					_preflight: unknown,
					_options: unknown,
					handlers: {
						updateEntity: (
							dbService: ApprovalDbService,
							entityId: string,
							currentEmployee: CurrentApprover,
						) => Effect.Effect<unknown, unknown, unknown>;
						afterCommit: (
							result: unknown,
							dbService: ApprovalDbService,
							entityId: string,
							currentEmployee: CurrentApprover,
						) => Effect.Effect<void, unknown, unknown>;
					},
				) =>
					Effect.gen(function* (_) {
						const result = yield* _(
							handlers.updateEntity(dbService, entityId, currentEmployee),
						);
						expect(addCalendarSyncJob).not.toHaveBeenCalledWith({
							absenceId: "absence-1",
							employeeId: "emp-requester",
							organizationId: "org-1",
							action: "create",
						});
						expect(addCalendarSyncJob).not.toHaveBeenCalledWith({
							absenceId: "vacation-updated",
							employeeId: "emp-requester",
							organizationId: "org-1",
							action: "update",
						});
						expect(addCalendarSyncJob).not.toHaveBeenCalledWith({
							absenceId: "vacation-created",
							employeeId: "emp-requester",
							organizationId: "org-1",
							action: "create",
						});
						expect(addCalendarSyncJob).not.toHaveBeenCalledWith({
							absenceId: "vacation-deleted",
							employeeId: "emp-requester",
							organizationId: "org-1",
							action: "delete",
						});
						yield* _(
							handlers.afterCommit(
								result,
								dbService,
								entityId,
								currentEmployee,
							),
						);
						return result;
					}),
			),
		}));
		const { approveAbsenceWithCurrentApproverEffect } = await import(
			"@/lib/approvals/server/absence-approvals"
		);
		const dbService = createAbsenceDecisionDbService({
			category: { name: "Sick", type: "sick", color: null },
			startPeriod: "full_day",
			endPeriod: "full_day",
		});

		await runAbsenceDecisionEffect(
			approveAbsenceWithCurrentApproverEffect(
				dbService,
				absenceCurrentApprover,
				"absence-1",
			),
		);

		expect(adjustVacationAbsencesForSickness).toHaveBeenCalledWith({
			tx: dbService.db,
			organizationId: "org-1",
			employeeId: "emp-requester",
			sickStartDate: "2026-05-11",
			sickEndDate: "2026-05-12",
			updatedBy: "user-manager",
		});
		expect(syncCanonicalAbsenceApprovalState).not.toHaveBeenCalled();
		expect(
			syncCanonicalAbsenceApprovalStateInTransaction,
		).not.toHaveBeenCalled();
		expect(addCalendarSyncJob).toHaveBeenCalledWith({
			absenceId: "absence-1",
			employeeId: "emp-requester",
			organizationId: "org-1",
			action: "create",
		});
		expect(addCalendarSyncJob).toHaveBeenCalledWith({
			absenceId: "vacation-updated",
			employeeId: "emp-requester",
			organizationId: "org-1",
			action: "update",
		});
		expect(addCalendarSyncJob).toHaveBeenCalledWith({
			absenceId: "vacation-created",
			employeeId: "emp-requester",
			organizationId: "org-1",
			action: "create",
		});
		expect(addCalendarSyncJob).toHaveBeenCalledWith({
			absenceId: "vacation-deleted",
			employeeId: "emp-requester",
			organizationId: "org-1",
			action: "delete",
		});
		vi.doUnmock("@/app/[locale]/(app)/absences/actions.canonical");
		vi.doUnmock("@/lib/absences/sick-vacation-override");
		vi.doUnmock("@/lib/approvals/server/shared");
	});

	it("does not apply sick vacation overrides when rejecting a sick absence", async () => {
		vi.resetModules();
		const adjustVacationAbsencesForSickness = vi.fn();
		vi.doMock(
			"@/lib/absences/sick-vacation-override",
			async (importOriginal) => {
				const actual =
					await importOriginal<
						typeof import("@/lib/absences/sick-vacation-override")
					>();
				return { ...actual, adjustVacationAbsencesForSickness };
			},
		);
		vi.doMock("@/lib/approvals/server/shared", () => ({
			processApproval: vi.fn(),
			processApprovalWithCurrentEmployee: vi.fn(
				(
					dbService: ApprovalDbService,
					currentEmployee: CurrentApprover,
					_entityType: string,
					entityId: string,
					_action: string,
					_reason: string | undefined,
					updateEntity: (
						dbService: ApprovalDbService,
						entityId: string,
						currentEmployee: CurrentApprover,
					) => Effect.Effect<unknown, unknown, unknown>,
				) => updateEntity(dbService, entityId, currentEmployee),
			),
		}));
		const { rejectAbsenceWithCurrentApproverEffect } = await import(
			"@/lib/approvals/server/absence-approvals"
		);
		const dbService = createAbsenceDecisionDbService({
			category: { name: "Sick", type: "sick", color: null },
			startPeriod: "full_day",
			endPeriod: "full_day",
		});

		await runAbsenceDecisionEffect(
			rejectAbsenceWithCurrentApproverEffect(
				dbService,
				absenceCurrentApprover,
				"absence-1",
				"Not eligible",
			),
		);

		expect(adjustVacationAbsencesForSickness).not.toHaveBeenCalled();
		vi.doUnmock("@/lib/absences/sick-vacation-override");
		vi.doUnmock("@/lib/approvals/server/shared");
	});

	it("notifies the requester after approving an absence request", async () => {
		vi.resetModules();
		vi.doMock("@/lib/approvals/server/shared", () => ({
			processApproval: vi.fn(),
			processApprovalWithCurrentEmployee: vi.fn(
				(
					dbService: ApprovalDbService,
					currentEmployee: CurrentApprover,
					_entityType: string,
					entityId: string,
					_action: string,
					_reason: string | undefined,
					updateEntity: (
						dbService: ApprovalDbService,
						entityId: string,
						currentEmployee: CurrentApprover,
					) => Effect.Effect<unknown, unknown, unknown>,
				) =>
					updateEntity(dbService, entityId, currentEmployee).pipe(
						Effect.provideService(EmailService, {
							send: vi.fn(() => Effect.succeed({ messageId: "message-1" })),
						}),
					),
			),
		}));
		const { approveAbsenceWithCurrentApproverEffect } = await import(
			"@/lib/approvals/server/absence-approvals"
		);
		const dbService = createAbsenceDecisionDbService();

		await runAbsenceDecisionEffect(
			approveAbsenceWithCurrentApproverEffect(
				dbService,
				absenceCurrentApprover,
				"absence-1",
			),
		);

		expect(onAbsenceRequestApproved).toHaveBeenCalledWith(
			expect.objectContaining({
				absenceId: "absence-1",
				employeeUserId: "user-requester",
				organizationId: "org-1",
				categoryName: "Vacation",
				approverName: "Morgan Manager",
			}),
		);
		expect(onAbsenceRequestRejected).not.toHaveBeenCalled();
		vi.doUnmock("@/lib/approvals/server/shared");
	});

	it("notifies the requester after rejecting an absence request", async () => {
		vi.resetModules();
		vi.doMock("@/lib/approvals/server/shared", () => ({
			processApproval: vi.fn(),
			processApprovalWithCurrentEmployee: vi.fn(
				(
					dbService: ApprovalDbService,
					currentEmployee: CurrentApprover,
					_entityType: string,
					entityId: string,
					_action: string,
					_reason: string | undefined,
					updateEntity: (
						dbService: ApprovalDbService,
						entityId: string,
						currentEmployee: CurrentApprover,
					) => Effect.Effect<unknown, unknown, unknown>,
				) =>
					updateEntity(dbService, entityId, currentEmployee).pipe(
						Effect.provideService(EmailService, {
							send: vi.fn(() => Effect.succeed({ messageId: "message-1" })),
						}),
					),
			),
		}));
		const { rejectAbsenceWithCurrentApproverEffect } = await import(
			"@/lib/approvals/server/absence-approvals"
		);
		const dbService = createAbsenceDecisionDbService();

		await runAbsenceDecisionEffect(
			rejectAbsenceWithCurrentApproverEffect(
				dbService,
				absenceCurrentApprover,
				"absence-1",
				"Insufficient balance",
			),
		);

		expect(onAbsenceRequestRejected).toHaveBeenCalledWith(
			expect.objectContaining({
				absenceId: "absence-1",
				employeeUserId: "user-requester",
				organizationId: "org-1",
				categoryName: "Vacation",
				approverName: "Morgan Manager",
				rejectionReason: "Insufficient balance",
			}),
		);
		expect(onAbsenceRequestApproved).not.toHaveBeenCalled();
		vi.doUnmock("@/lib/approvals/server/shared");
	});
});

describe("absence approval policy resolution", () => {
	it("forces absence decisions through the transactional approval path", async () => {
		vi.resetModules();
		const processApprovalWithCurrentEmployee = vi.fn(() => Effect.void);
		vi.doMock("@/lib/approvals/server/shared", () => ({
			processApprovalWithCurrentEmployee,
			processApproval: vi.fn(),
		}));
		const { approveAbsenceWithCurrentApproverEffect } = await import(
			"@/lib/approvals/server/absence-approvals"
		);

		approveAbsenceWithCurrentApproverEffect(
			{} as ApprovalDbService,
			{
				id: "emp-manager",
				userId: "user-manager",
				organizationId: "org-1",
				user: {
					id: "user-manager",
					name: "Manager",
					email: "manager@example.com",
					image: null,
				},
			},
			"absence-1",
		);

		expect(processApprovalWithCurrentEmployee).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			"absence_entry",
			"absence-1",
			"approve",
			undefined,
			expect.any(Function),
			undefined,
			expect.objectContaining({ transactional: true }),
			expect.objectContaining({
				updateEntity: expect.any(Function),
				afterCommit: expect.any(Function),
			}),
		);
		vi.doUnmock("@/lib/approvals/server/shared");
	});

	it("forces absence rejections through the transactional approval path", async () => {
		vi.resetModules();
		const processApprovalWithCurrentEmployee = vi.fn(() => Effect.void);
		vi.doMock("@/lib/approvals/server/shared", () => ({
			processApprovalWithCurrentEmployee,
			processApproval: vi.fn(),
		}));
		const { rejectAbsenceWithCurrentApproverEffect } = await import(
			"@/lib/approvals/server/absence-approvals"
		);

		rejectAbsenceWithCurrentApproverEffect(
			{} as ApprovalDbService,
			{
				id: "emp-manager",
				userId: "user-manager",
				organizationId: "org-1",
				user: {
					id: "user-manager",
					name: "Manager",
					email: "manager@example.com",
					image: null,
				},
			},
			"absence-1",
			"Too late",
		);

		expect(processApprovalWithCurrentEmployee).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			"absence_entry",
			"absence-1",
			"reject",
			"Too late",
			expect.any(Function),
			undefined,
			expect.objectContaining({ transactional: true }),
			expect.objectContaining({
				updateEntity: expect.any(Function),
				afterCommit: expect.any(Function),
			}),
		);
		vi.doUnmock("@/lib/approvals/server/shared");
	});

	it("creates absence approvals through the shared policy resolver", async () => {
		const { dbService, inserts } = createPolicyResolutionDbService([]);

		const result = await Effect.runPromise(
			createAbsenceApprovalWorkflow(dbService, {
				absence: {
					id: "absence-1",
					organizationId: "org-1",
					employeeId: "emp-requester",
					categoryId: "category-1",
					employee: { teamId: "team-1" },
				},
				defaultApproverId: "emp-manager",
			}),
		);

		expect(result).toEqual({
			kind: "default_created",
			approvalRequestId: "insert-1",
		});
		expect(inserts).toHaveLength(1);
		expect(inserts[0].values).toMatchObject({
			organizationId: "org-1",
			entityType: "absence_entry",
			entityId: "absence-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
		});
	});

	it("uses existing default approval behavior when no approval policy matches", async () => {
		const { dbService, inserts } = createPolicyResolutionDbService([]);

		const result = await Effect.runPromise(
			resolvePolicyAndCreateApproval(dbService, {
				context: absencePolicyContext,
				defaultApproverId: "emp-manager",
			}),
		);

		expect(result).toEqual({
			kind: "default_created",
			approvalRequestId: "insert-1",
		});
		expect(inserts).toHaveLength(1);
		expect(inserts[0].values).toMatchObject({
			organizationId: "org-1",
			entityType: "absence_entry",
			entityId: "absence-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
		});
	});

	it("creates a chain approval request when an approval policy matches", async () => {
		const { dbService, inserts, transaction } = createPolicyResolutionDbService(
			[
				{
					id: "policy-1",
					organizationId: "org-1",
					name: "Absence policy",
					isActive: true,
					priority: 1,
					conditions: [
						{
							conditionType: "approval_type",
							operator: "equals",
							valueJson: "absence_entry",
						},
					],
					stages: [
						{
							id: "stage-1",
							stepOrder: 1,
							label: "Manager",
							approverType: "direct_manager",
							approverEmployeeId: null,
							fallbackBehavior: "fail",
						},
					],
				},
			],
		);
		const outerRepositoryTransaction = vi.fn(
			async (operation: () => Promise<unknown>) => await operation(),
		);

		const result = await outerRepositoryTransaction(() =>
			Effect.runPromise(
				createAbsenceApprovalWorkflow(dbService, {
					absence: {
						id: "absence-1",
						organizationId: "org-1",
						employeeId: "emp-requester",
						categoryId: "category-1",
						employee: { teamId: "team-1" },
					},
					defaultApproverId: "emp-manager",
					transactionBehavior: "existing",
				}),
			),
		);

		expect(result).toEqual({
			kind: "chain_created",
			chainInstanceId: "insert-1",
			approvalRequestId: "insert-2",
		});
		expect(inserts).toHaveLength(3);
		expect(inserts.map((insert) => insert.values.organizationId)).toEqual([
			"org-1",
			"org-1",
			"org-1",
		]);
		expect(inserts[0].values).toMatchObject({
			policyId: "policy-1",
			entityType: "absence_entry",
		});
		expect(inserts[1].values).toMatchObject({
			approverId: "emp-manager",
			entityId: "absence-1",
		});
		expect(inserts[2].values).toMatchObject({
			chainInstanceId: "insert-1",
			approvalRequestId: "insert-2",
			resolvedApproverEmployeeId: "emp-manager",
		});
		expect(transaction).not.toHaveBeenCalled();
		expect(outerRepositoryTransaction).toHaveBeenCalledOnce();
	});

	it("falls back to manager approval when a matched absence policy cannot resolve", async () => {
		const { dbService, inserts } = createPolicyResolutionDbService([
			{
				id: "policy-1",
				organizationId: "org-1",
				name: "Broken absence policy",
				isActive: true,
				priority: 1,
				conditions: [
					{
						conditionType: "approval_type",
						operator: "equals",
						valueJson: "absence_entry",
					},
				],
				stages: [
					{
						id: "stage-1",
						stepOrder: 1,
						label: "Missing approver",
						approverType: "specific_employee",
						approverEmployeeId: "missing-employee",
						fallbackBehavior: "fail",
					},
				],
			},
		]);

		const result = await Effect.runPromise(
			createAbsenceApprovalWorkflow(dbService, {
				absence: {
					id: "absence-1",
					organizationId: "org-1",
					employeeId: "emp-requester",
					categoryId: "category-1",
					employee: { teamId: "team-1" },
				},
				defaultApproverId: "emp-manager",
			}),
		);

		expect(result).toEqual({
			kind: "default_created",
			approvalRequestId: "insert-1",
		});
		expect(inserts).toHaveLength(1);
		expect(inserts[0].values).toMatchObject({
			organizationId: "org-1",
			entityType: "absence_entry",
			entityId: "absence-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
		});
	});

	it("finalizes an auto-completed requester approval without sending transaction-bound notifications", async () => {
		const { dbService, inserts, updates } = createPolicyResolutionDbService([]);

		const result = await Effect.runPromise(
			createAbsenceApprovalWorkflow(dbService, {
				absence: {
					id: "absence-1",
					organizationId: "org-1",
					employeeId: "emp-requester",
					categoryId: "category-1",
					employee: { teamId: "team-1" },
				},
				defaultApproverId: "emp-requester",
			}),
		);

		expect(result).toMatchObject({
			kind: "auto_completed",
			chainInstanceId: null,
			reason: "requester_is_approver",
			autoCompletion: {
				absence: { id: "absence-1", status: "pending" },
				vacationOverrideSummary: {
					updatedAbsenceIds: [],
					createdAbsenceIds: [],
					deletedAbsenceIds: [],
				},
				workBalanceDirtyMark: {
					employeeId: "emp-requester",
					organizationId: "org-1",
					dirtyFromDate: "2026-05-11",
				},
			},
		});
		expect(inserts.map((insert) => insert.values)).toEqual([
			expect.objectContaining({
				requestedBy: "emp-requester",
				approverId: "emp-requester",
				status: "approved",
			}),
		]);
		expect(updates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					status: "approved",
					approvedBy: "emp-requester",
				}),
			]),
		);
		expect(onAbsenceRequestApproved).not.toHaveBeenCalled();
	});
});

describe("absence decision rollout routing", () => {
	function collectDecisionColumnNames(value: unknown): string[] {
		if (!value || typeof value !== "object") return [];
		const candidate = value as {
			config?: { name?: unknown };
			queryChunks?: unknown[];
		};
		return [
			...(typeof candidate.config?.name === "string"
				? [candidate.config.name]
				: []),
			...(candidate.queryChunks?.flatMap(collectDecisionColumnNames) ?? []),
		];
	}

	const modes = ["legacy", "shadow", "ready", "canonical", "complete"] as const;
	const decisions = modes.flatMap((mode) => [
		{ mode, action: "approve" as const, reason: undefined },
		{ mode, action: "reject" as const, reason: "Private medical detail" },
	]);

	it.each(
		decisions,
	)("routes $action in $mode mode with one outer transaction", async ({
		mode,
		action,
		reason,
	}) => {
		const events: string[] = [];
		const innerTransaction = vi.fn();
		const transition = vi.fn(async (_context, request) => {
			events.push("transition");
			return { snapshot: { status: "approved" }, request };
		});
		const processLegacy = vi.fn(async (_dbService, actor) => {
			events.push("legacy-decision");
			expect(actor).toMatchObject({
				id: "emp-manager",
				userId: "user-manager",
				organizationId: "org-1",
			});
			return { absence: { id: "absence-1" } };
		});
		let captureCount = 0;
		const captureLegacyState = vi.fn(async () => {
			captureCount += 1;
			events.push(captureCount === 1 ? "capture-before" : "capture-after");
			return {
				organizationId: "org-1",
				source: {
					organizationId: "org-1",
					workflowType: "absence",
					sourceType: "absence_entry",
					sourceId: "absence-1",
				},
			};
		});
		const context = {
			dbService: {
				db: {
					transaction: innerTransaction,
					query: {
						employee: {
							findMany: vi.fn().mockResolvedValue([
								{
									id: "emp-manager",
									userId: "user-manager",
									organizationId: "org-1",
									isActive: true,
									user: {
										id: "user-manager",
										name: "Manager",
										email: "manager@example.com",
										image: null,
									},
								},
							]),
						},
						absenceEntry: {
							findFirst: vi.fn().mockResolvedValue({
								id: "absence-1",
								organizationId: "org-1",
								approvalWorkflowId:
									mode === "canonical" || mode === "complete"
										? "workflow-1"
										: null,
							}),
						},
						approvalWorkflow: {
							findFirst: vi
								.fn()
								.mockResolvedValue(
									mode === "shadow" || mode === "ready"
										? { id: "workflow-1", version: 4 }
										: null,
								),
						},
					},
				},
			},
			writeGate: {
				acquire: vi.fn(async () => ({
					mode,
					behavior: {
						serveFrom:
							mode === "canonical" || mode === "complete"
								? "canonical"
								: "legacy",
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
				})),
			},
			compatibilityWriter: {
				withWriteGate() {
					return this;
				},
				mirrorLegacyToCanonical: vi.fn(async () => {
					events.push("mirror");
					return {};
				}),
			},
			repository: {
				loadSnapshot: vi.fn().mockResolvedValue({
					id: "workflow-1",
					organizationId: "org-1",
					workflowType: "absence",
					sourceType: "absence_entry",
					sourceId: "absence-1",
					version: 4,
					currentStageOrder: 1,
					stages: [
						{
							id: "stage-1",
							legacyApprovalRequestId:
								mode === "complete" ? null : "approval-target-1",
							sequence: 1,
							status: "pending",
							assignments: [
								{
									id: "assignment-1",
									status: "pending",
									approverEmployeeId: "emp-manager",
								},
							],
						},
					],
				}),
			},
		};
		const outerTransaction = vi.fn(async (operation) => operation(context));

		const result = await executeAbsenceDecisionInTransaction({
			runtime: {
				repository: { withTransaction: outerTransaction },
				transitionEngine: { executeInTransaction: transition },
			},
			organizationId: "org-1",
			actorEmployeeId: "emp-manager",
			actorUserId: "user-manager",
			absenceId: "absence-1",
			approvalRequestId:
				mode === "complete"
					? "assignment-1"
					: mode === "canonical"
						? "approval-target-1"
						: undefined,
			action,
			reason,
			processLegacy,
			captureLegacyState,
			nowInstant: () => parseInstant("2026-07-19T10:00:00Z"),
		});

		expect(outerTransaction).toHaveBeenCalledOnce();
		expect(innerTransaction).not.toHaveBeenCalled();
		expect(
			collectDecisionColumnNames(
				context.dbService.db.query.employee.findMany.mock.calls[0]?.[0]?.where,
			),
		).toEqual(
			expect.arrayContaining(["organization_id", "user_id", "is_active"]),
		);
		if (mode === "legacy") {
			expect(events).toEqual(["legacy-decision"]);
			expect(processLegacy).toHaveBeenCalledWith(
				expect.objectContaining({ db: context.dbService.db }),
				expect.objectContaining({ id: "emp-manager", userId: "user-manager" }),
				"existing",
			);
		} else if (mode === "shadow" || mode === "ready") {
			expect(events).toEqual([
				"capture-before",
				"legacy-decision",
				"capture-after",
				"mirror",
			]);
			expect(captureLegacyState).toHaveBeenCalledTimes(2);
			expect(captureLegacyState.mock.calls[0]?.[0].dbService).toBe(
				context.dbService,
			);
			expect(captureLegacyState.mock.calls[1]?.[0].dbService).toBe(
				context.dbService,
			);
			expect(
				context.compatibilityWriter.mirrorLegacyToCanonical,
			).toHaveBeenCalledWith(
				expect.objectContaining({
					expectedVersion: 4,
					idempotencyKey: expect.stringContaining(
						`absence:absence-1:${action}:4:`,
					),
				}),
			);
		} else {
			expect(events).toEqual(["transition"]);
			expect(processLegacy).not.toHaveBeenCalled();
			expect(transition).toHaveBeenCalledWith(
				expect.objectContaining({
					dbService: context.dbService,
					repository: context.repository,
				}),
				expect.objectContaining({
					organizationId: "org-1",
					workflowId: "workflow-1",
					expectedVersion: 4,
					principal: { kind: "employee", userId: "user-manager" },
					command:
						action === "approve"
							? {
									type: "approve",
									stageId: "stage-1",
									assignmentId: "assignment-1",
								}
							: {
									type: "reject",
									stageId: "stage-1",
									assignmentId: "assignment-1",
									reason,
								},
				}),
			);
			const request = transition.mock.calls[0]?.[1];
			const stableTarget =
				mode === "complete" ? "assignment-1" : "approval-target-1";
			expect(request.idempotencyKey).toContain(
				`absence:org-1:workflow-1:${stableTarget}:${action}:`,
			);
			expect(request.idempotencyKey).not.toContain(":4:");
			expect(request.idempotencyKey).not.toContain(
				reason ?? "Private medical detail",
			);
			expect(addCalendarSyncJob).not.toHaveBeenCalled();
			expect(markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
			expect(onAbsenceRequestApproved).not.toHaveBeenCalled();
			expect(onAbsenceRequestRejected).not.toHaveBeenCalled();
		}
		expect(result.mode).toBe(mode);
		expect(result.actor).toMatchObject({
			id: "emp-manager",
			userId: "user-manager",
			organizationId: "org-1",
		});
	});

	it("replays a completed stable target without deciding the next stage", async () => {
		const snapshot = {
			id: "workflow-1",
			organizationId: "org-1",
			workflowType: "absence",
			sourceType: "absence_entry",
			sourceId: "absence-1",
			version: 4,
			currentStageOrder: 1,
			stages: [
				{
					id: "stage-1",
					legacyApprovalRequestId: "approval-target-1",
					sequence: 1,
					status: "pending",
					assignments: [
						{
							id: "assignment-1",
							status: "pending",
							approverEmployeeId: "emp-manager",
						},
					],
				},
				{
					id: "stage-2",
					legacyApprovalRequestId: "approval-target-2",
					sequence: 2,
					status: "waiting",
					assignments: [
						{
							id: "assignment-2",
							status: "pending",
							approverEmployeeId: "emp-manager",
						},
					],
				},
			],
		};
		const receipts = new Map<string, unknown>();
		const sourceMutations: string[] = [];
		let sourceStatus = "pending";
		const transition = vi.fn(async (_context, request) => {
			const replay = receipts.get(request.idempotencyKey);
			if (replay) return replay;
			if (request.command.stageId === "stage-1") {
				snapshot.stages[0].status = "approved";
				snapshot.stages[0].assignments[0].status = "approved";
				snapshot.stages[1].status = "pending";
				snapshot.currentStageOrder = 2;
				snapshot.version = 6;
			} else {
				snapshot.stages[1].status = "approved";
				snapshot.stages[1].assignments[0].status = "approved";
				snapshot.version = 7;
				sourceStatus = "approved";
				sourceMutations.push("approved");
			}
			const result = { snapshot: structuredClone(snapshot) };
			receipts.set(request.idempotencyKey, result);
			return result;
		});
		const context = {
			dbService: {
				db: {
					query: {
						employee: {
							findMany: vi.fn().mockResolvedValue([
								{
									id: "emp-manager",
									userId: "user-manager",
									organizationId: "org-1",
									isActive: true,
									user: { id: "user-manager" },
								},
							]),
						},
						absenceEntry: {
							findFirst: vi.fn().mockResolvedValue({
								id: "absence-1",
								organizationId: "org-1",
								approvalWorkflowId: "workflow-1",
							}),
						},
					},
				},
			},
			writeGate: {
				acquire: vi.fn().mockResolvedValue({
					mode: "canonical",
					behavior: {
						serveFrom: "canonical",
						writeLegacy: true,
						writeCanonical: true,
						decideCanonical: true,
						mirror: "canonical_to_legacy",
					},
				}),
			},
			repository: {
				loadSnapshot: vi.fn(async () => structuredClone(snapshot)),
			},
		};
		const runtime = {
			repository: {
				withTransaction: async (operation) => operation(context as never),
			},
			transitionEngine: { executeInTransaction: transition },
		};
		const decide = (approvalRequestId: string) =>
			executeAbsenceDecisionInTransaction({
				runtime,
				organizationId: "org-1",
				actorEmployeeId: "emp-manager",
				actorUserId: "user-manager",
				absenceId: "absence-1",
				approvalRequestId,
				action: "approve",
				processLegacy: vi.fn(),
				captureLegacyState: vi.fn(),
				nowInstant: () => parseInstant("2026-07-19T10:00:00Z"),
			});

		await decide("approval-target-1");
		await decide("approval-target-1");

		expect(transition.mock.calls[0]?.[1].idempotencyKey).toBe(
			transition.mock.calls[1]?.[1].idempotencyKey,
		);
		expect(transition.mock.calls[0]?.[1].expectedVersion).toBe(4);
		expect(transition.mock.calls[1]?.[1].expectedVersion).toBe(6);
		expect(transition.mock.calls[1]?.[1].command).toMatchObject({
			stageId: "stage-1",
			assignmentId: "assignment-1",
		});
		expect(snapshot.stages[1].status).toBe("pending");
		expect(sourceStatus).toBe("pending");
		expect(sourceMutations).toEqual([]);

		await decide("approval-target-2");

		expect(transition.mock.calls[2]?.[1].idempotencyKey).not.toBe(
			transition.mock.calls[1]?.[1].idempotencyKey,
		);
		expect(transition.mock.calls[2]?.[1].command).toMatchObject({
			stageId: "stage-2",
			assignmentId: "assignment-2",
		});
		expect(sourceMutations).toEqual(["approved"]);
		expect(sourceStatus).toBe("approved");
	});

	it("lets requester-auto activation terminal-finalize exactly once in the engine", async () => {
		let sourceFinalizations = 0;
		const transition = vi.fn(async () => {
			sourceFinalizations += 1;
			return { snapshot: { status: "approved" } };
		});
		const context = {
			dbService: {
				db: {
					query: {
						employee: {
							findMany: vi.fn().mockResolvedValue([
								{
									id: "emp-requester",
									userId: "user-requester",
									organizationId: "org-1",
									isActive: true,
									user: { id: "user-requester" },
								},
							]),
						},
						absenceEntry: {
							findFirst: vi.fn().mockResolvedValue({
								id: "absence-1",
								organizationId: "org-1",
								approvalWorkflowId: "workflow-1",
							}),
						},
					},
				},
			},
			writeGate: {
				acquire: vi.fn().mockResolvedValue({
					mode: "complete",
					behavior: {
						serveFrom: "canonical",
						writeLegacy: false,
						writeCanonical: true,
						decideCanonical: true,
						mirror: "none",
					},
				}),
			},
			repository: {
				loadSnapshot: vi.fn().mockResolvedValue({
					id: "workflow-1",
					organizationId: "org-1",
					workflowType: "absence",
					sourceType: "absence_entry",
					sourceId: "absence-1",
					version: 4,
					stages: [
						{
							id: "stage-auto",
							legacyApprovalRequestId: "approval-auto",
							assignments: [{ id: "assignment-auto" }],
						},
					],
				}),
			},
		};

		await executeAbsenceDecisionInTransaction({
			runtime: {
				repository: {
					withTransaction: async (operation) => operation(context as never),
				},
				transitionEngine: { executeInTransaction: transition },
			},
			organizationId: "org-1",
			actorEmployeeId: "emp-requester",
			actorUserId: "user-requester",
			absenceId: "absence-1",
			approvalRequestId: "approval-auto",
			action: "approve",
			processLegacy: vi.fn(),
			captureLegacyState: vi.fn(),
			nowInstant: () => parseInstant("2026-07-19T10:00:00Z"),
		});

		expect(transition).toHaveBeenCalledOnce();
		expect(sourceFinalizations).toBe(1);
		expect(addCalendarSyncJob).not.toHaveBeenCalled();
		expect(onAbsenceRequestApproved).not.toHaveBeenCalled();
	});

	it.each(
		(["legacy", "shadow", "ready", "canonical", "complete"] as const).flatMap(
			(mode) => [
				{ mode, actorState: "deactivated" as const, actorRows: [] },
				{
					mode,
					actorState: "changed" as const,
					actorRows: [
						{
							id: "different-employee",
							userId: "user-manager",
							organizationId: "org-1",
							isActive: true,
							user: { id: "user-manager" },
						},
					],
				},
				{
					mode,
					actorState: "duplicated" as const,
					actorRows: ["duplicate-1", "duplicate-2"].map((id) => ({
						id,
						userId: "user-manager",
						organizationId: "org-1",
						isActive: true,
						user: { id: "user-manager" },
					})),
				},
			],
		),
	)("rejects a $actorState transaction actor before $mode decision work", async ({
		mode,
		actorRows,
	}) => {
		const captureLegacyState = vi.fn();
		const processLegacy = vi.fn();
		const transition = vi.fn();
		const context = {
			dbService: {
				db: {
					query: {
						employee: {
							findMany: vi.fn().mockResolvedValue(actorRows),
						},
					},
				},
			},
		};

		await expect(
			executeAbsenceDecisionInTransaction({
				runtime: {
					repository: {
						withTransaction: async (operation) => operation(context as never),
					},
					transitionEngine: { executeInTransaction: transition },
				},
				organizationId: "org-1",
				actorEmployeeId: "emp-manager",
				actorUserId: "user-manager",
				absenceId: "absence-1",
				approvalRequestId:
					mode === "canonical" || mode === "complete"
						? "approval-target-1"
						: undefined,
				action: "approve",
				processLegacy,
				captureLegacyState,
				nowInstant: () => parseInstant("2026-07-19T10:00:00Z"),
			}),
		).rejects.toThrow(/active absence approval actor/i);
		expect(captureLegacyState).not.toHaveBeenCalled();
		expect(processLegacy).not.toHaveBeenCalled();
		expect(transition).not.toHaveBeenCalled();
	});

	it.each([
		"capture_after",
		"mirror",
	] as const)("rolls back shadow source state when %s fails", async (failurePoint) => {
		let committed = { sourceStatus: "pending", requestStatus: "pending" };
		let active = structuredClone(committed);
		let captureCount = 0;
		const mirrorLegacyToCanonical = vi.fn(async () => {
			if (failurePoint === "mirror") throw new Error("mirror failed");
			return {};
		});
		const context = {
			dbService: {
				db: {
					query: {
						employee: {
							findMany: vi.fn().mockResolvedValue([
								{
									id: "emp-manager",
									userId: "user-manager",
									organizationId: "org-1",
									isActive: true,
									user: { id: "user-manager" },
								},
							]),
						},
						absenceEntry: {
							findFirst: vi.fn().mockResolvedValue({
								id: "absence-1",
								organizationId: "org-1",
								approvalWorkflowId: null,
							}),
						},
						approvalWorkflow: {
							findFirst: vi
								.fn()
								.mockResolvedValue({ id: "workflow-1", version: 4 }),
						},
					},
				},
			},
			writeGate: {
				acquire: vi.fn().mockResolvedValue({
					mode: "shadow",
					behavior: {
						serveFrom: "legacy",
						writeLegacy: true,
						writeCanonical: true,
						decideCanonical: false,
						mirror: "legacy_to_canonical",
					},
				}),
			},
			compatibilityWriter: {
				withWriteGate() {
					return this;
				},
				mirrorLegacyToCanonical,
			},
		};
		const captureLegacyState = vi.fn(async () => {
			captureCount += 1;
			if (captureCount === 2 && failurePoint === "capture_after") {
				throw new Error("capture after failed");
			}
			return {
				organizationId: "org-1",
				source: {
					organizationId: "org-1",
					workflowType: "absence",
					sourceType: "absence_entry",
					sourceId: "absence-1",
				},
				sourceSnapshot: { status: active.sourceStatus },
			};
		});
		const processLegacy = vi.fn(async () => {
			active.sourceStatus = "approved";
			active.requestStatus = "approved";
			return { absence: { id: "absence-1" } };
		});
		const withTransaction = async (operation) => {
			active = structuredClone(committed);
			try {
				const result = await operation(context);
				committed = structuredClone(active);
				return result;
			} finally {
				active = structuredClone(committed);
			}
		};

		await expect(
			executeAbsenceDecisionInTransaction({
				runtime: {
					repository: { withTransaction },
					transitionEngine: { executeInTransaction: vi.fn() },
				},
				organizationId: "org-1",
				actorEmployeeId: "emp-manager",
				actorUserId: "user-manager",
				absenceId: "absence-1",
				action: "approve",
				processLegacy,
				captureLegacyState,
				nowInstant: () => parseInstant("2026-07-19T10:00:00Z"),
			}),
		).rejects.toThrow(
			failurePoint === "mirror" ? "mirror failed" : "capture after failed",
		);
		expect(committed).toEqual({
			sourceStatus: "pending",
			requestStatus: "pending",
		});
		expect(addCalendarSyncJob).not.toHaveBeenCalled();
		expect(markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
		expect(onAbsenceRequestApproved).not.toHaveBeenCalled();
	});

	it.each([
		"canonical",
		"complete",
	] as const)("rolls back %s engine source mutation without direct side effects", async (mode) => {
		let committed = { sourceStatus: "pending" };
		let active = structuredClone(committed);
		const context = {
			dbService: {
				db: {
					query: {
						employee: {
							findMany: vi.fn().mockResolvedValue([
								{
									id: "emp-manager",
									userId: "user-manager",
									organizationId: "org-1",
									isActive: true,
									user: { id: "user-manager" },
								},
							]),
						},
						absenceEntry: {
							findFirst: vi.fn().mockResolvedValue({
								id: "absence-1",
								organizationId: "org-1",
								approvalWorkflowId: "workflow-1",
							}),
						},
					},
				},
			},
			writeGate: {
				acquire: vi.fn().mockResolvedValue({
					mode,
					behavior: {
						serveFrom: "canonical",
						writeLegacy: mode === "canonical",
						writeCanonical: true,
						decideCanonical: true,
						mirror: mode === "canonical" ? "canonical_to_legacy" : "none",
					},
				}),
			},
			repository: {
				loadSnapshot: vi.fn().mockResolvedValue({
					id: "workflow-1",
					organizationId: "org-1",
					workflowType: "absence",
					sourceType: "absence_entry",
					sourceId: "absence-1",
					version: 4,
					stages: [
						{
							id: "stage-1",
							legacyApprovalRequestId: "approval-target-1",
							assignments: [{ id: "assignment-1" }],
						},
					],
				}),
			},
		};
		const withTransaction = async (operation) => {
			active = structuredClone(committed);
			try {
				const result = await operation(context);
				committed = structuredClone(active);
				return result;
			} finally {
				active = structuredClone(committed);
			}
		};
		const transition = vi.fn(async () => {
			active.sourceStatus = "approved";
			throw new Error("engine rollback");
		});

		await expect(
			executeAbsenceDecisionInTransaction({
				runtime: {
					repository: { withTransaction },
					transitionEngine: { executeInTransaction: transition },
				},
				organizationId: "org-1",
				actorEmployeeId: "emp-manager",
				actorUserId: "user-manager",
				absenceId: "absence-1",
				approvalRequestId: "approval-target-1",
				action: "approve",
				processLegacy: vi.fn(),
				captureLegacyState: vi.fn(),
				nowInstant: () => parseInstant("2026-07-19T10:00:00Z"),
			}),
		).rejects.toThrow("engine rollback");
		expect(committed.sourceStatus).toBe("pending");
		expect(addCalendarSyncJob).not.toHaveBeenCalled();
		expect(markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
		expect(onAbsenceRequestApproved).not.toHaveBeenCalled();
		expect(onAbsenceRequestRejected).not.toHaveBeenCalled();
	});

	it.each([
		"missing_target",
		"missing",
		"cross_org",
		"mismatched",
	] as const)("fails a canonical %s workflow link before decision or source mutation", async (linkState) => {
		const transition = vi.fn();
		const processLegacy = vi.fn();
		const context = {
			dbService: {
				db: {
					query: {
						employee: {
							findMany: vi.fn().mockResolvedValue([
								{
									id: "emp-manager",
									userId: "user-manager",
									organizationId: "org-1",
									isActive: true,
									user: { id: "user-manager" },
								},
							]),
						},
						absenceEntry: {
							findFirst: vi.fn().mockResolvedValue({
								id: "absence-1",
								organizationId: "org-1",
								approvalWorkflowId:
									linkState === "missing" ? null : "workflow-1",
							}),
						},
					},
				},
			},
			writeGate: {
				acquire: vi.fn().mockResolvedValue({
					mode: "canonical",
					behavior: {
						serveFrom: "canonical",
						writeLegacy: true,
						writeCanonical: true,
						decideCanonical: true,
						mirror: "canonical_to_legacy",
					},
				}),
			},
			repository: {
				loadSnapshot: vi.fn().mockResolvedValue({
					id: "workflow-1",
					organizationId: linkState === "cross_org" ? "org-2" : "org-1",
					workflowType: "absence",
					sourceType: "absence_entry",
					sourceId: "foreign-absence",
					version: 4,
					stages: [],
				}),
			},
		};

		await expect(
			executeAbsenceDecisionInTransaction({
				runtime: {
					repository: {
						withTransaction: async (operation) => operation(context as never),
					},
					transitionEngine: { executeInTransaction: transition },
				},
				organizationId: "org-1",
				actorEmployeeId: "emp-manager",
				actorUserId: "user-manager",
				absenceId: "absence-1",
				approvalRequestId:
					linkState === "missing_target" ? undefined : "approval-target-1",
				action: "approve",
				processLegacy,
				captureLegacyState: vi.fn(),
				nowInstant: () => parseInstant("2026-07-19T10:00:00Z"),
			}),
		).rejects.toThrow(
			linkState === "missing_target" ? /decision target/i : /workflow link/i,
		);
		expect(transition).not.toHaveBeenCalled();
		expect(processLegacy).not.toHaveBeenCalled();
	});
});

describe("canonical absence fallback-manager authorization", () => {
	const workflow = {
		id: "workflow-1",
		organizationId: "org-1",
		currentStageOrder: 1,
		stages: [
			{
				id: "stage-1",
				sequence: 1,
				status: "pending",
				legacyApprovalRequestId: "approval-1",
				assignments: [{ id: "assignment-1" }],
			},
		],
	};
	const actor = {
		id: "manager-2",
		userId: "manager-user-2",
		organizationId: "org-1",
		user: {
			id: "manager-user-2",
			name: "Fallback Manager",
			email: "fallback@example.com",
			image: null,
		},
	};
	const command = {
		type: "approve" as const,
		stageId: "stage-1",
		assignmentId: "assignment-1",
	};

	it("allows a currently eligible fallback manager for the exact active request", async () => {
		isEligibleManagerForApprovalRequest.mockResolvedValueOnce(true);
		const db = { query: {} };
		const authorize = createAbsenceApprovalManagementAuthorization({
			currentEmployee: actor,
			canManageOrganizationApproval: async () => false,
		});

		await expect(
			authorize({
				dbService: { db },
				organizationId: "org-1",
				actorEmployeeId: "manager-2",
				workflow,
				command,
			} as never),
		).resolves.toBe(true);
		expect(isEligibleManagerForApprovalRequest).toHaveBeenCalledWith({
			db,
			approvalRequestId: "approval-1",
			managerEmployeeId: "manager-2",
			organizationId: "org-1",
		});
	});

	it.each([
		["stale eligibility", workflow, false],
		["cross organization", { ...workflow, organizationId: "org-2" }, true],
	] as const)("denies %s without global manage escalation", async (_label, candidate, eligible) => {
		isEligibleManagerForApprovalRequest.mockResolvedValueOnce(eligible);
		const authorize = createAbsenceApprovalManagementAuthorization({
			currentEmployee: actor,
			canManageOrganizationApproval: async () => false,
		});

		await expect(
			authorize({
				dbService: { db: { query: {} } },
				organizationId: "org-1",
				actorEmployeeId: "manager-2",
				workflow: candidate,
				command,
			} as never),
		).resolves.toBe(false);
	});
});
