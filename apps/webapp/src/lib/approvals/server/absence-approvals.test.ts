import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	addCalendarSyncJob,
	markEmployeeWorkBalanceDirty,
	onAbsenceRequestApproved,
	onAbsenceRequestRejected,
} = vi.hoisted(() => ({
	addCalendarSyncJob: vi.fn().mockResolvedValue(undefined),
	markEmployeeWorkBalanceDirty: vi.fn().mockResolvedValue(undefined),
	onAbsenceRequestApproved: vi.fn(),
	onAbsenceRequestRejected: vi.fn(),
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
		getOrganizationBaseUrl: vi.fn().mockResolvedValue("https://app.example.com"),
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

import { resolvePolicyAndCreateApproval } from "@/lib/approvals/policies/chain-service";
import {
	buildAbsenceApprovalPolicyContext,
	createAbsenceApprovalWorkflow,
	formatAbsenceDateForEmail,
} from "@/lib/approvals/server/absence-approvals";
import { ApprovalAuditLogger } from "@/lib/approvals/infrastructure/audit-logger";
import type { ApprovalDbService, CurrentApprover } from "@/lib/approvals/server/types";
import { EmailService } from "@/lib/effect/services/email.service";

beforeEach(() => {
	addCalendarSyncJob.mockClear();
	markEmployeeWorkBalanceDirty.mockClear();
	onAbsenceRequestApproved.mockClear();
	onAbsenceRequestRejected.mockClear();
});

function createPolicyResolutionDbService(policies: unknown[]) {
	const inserts: Array<{ table: unknown; values: Record<string, unknown> }> = [];
	const dbService = {
		db: {
			query: {
				approvalPolicy: { findMany: vi.fn().mockResolvedValue(policies) },
				employeeGroupMember: { findMany: vi.fn().mockResolvedValue([]) },
				employeeGroup: { findMany: vi.fn().mockResolvedValue([]) },
				employee: {
					findMany: vi.fn().mockResolvedValue([
						{ id: "emp-requester", userId: "user-requester", organizationId: "org-1", isActive: true, role: "employee" },
						{ id: "emp-manager", organizationId: "org-1", isActive: true, role: "manager" },
					]),
				},
				employeeManagers: {
					findMany: vi
						.fn()
						.mockResolvedValue([
							{ employeeId: "emp-requester", managerId: "emp-manager", isPrimary: true },
						]),
				},
				teamMembership: { findMany: vi.fn().mockResolvedValue([]) },
				team: { findMany: vi.fn().mockResolvedValue([]) },
			},
			insert: vi.fn((table: unknown) => ({
				values: vi.fn((values: Record<string, unknown>) => {
					inserts.push({ table, values });
					return { returning: vi.fn().mockResolvedValue([{ id: `insert-${inserts.length}` }]) };
				}),
			})),
			update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
		},
		query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn),
	} as unknown as ApprovalDbService;

	return { dbService, inserts };
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
			approvalChainStageInstance: { findFirst: vi.fn().mockResolvedValue(null) },
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
					category: absenceOverrides.category ?? { name: "Vacation", type: "vacation", color: null },
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
		update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn() }) }),
		insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
		transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => fn(db)),
	};

	return {
		db,
		query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn),
	} as unknown as ApprovalDbService;
}

function runAbsenceDecisionEffect(effect: Effect.Effect<unknown, unknown, unknown>) {
	return Effect.runPromise(
		effect.pipe(
			Effect.provideService(EmailService, {
				send: vi.fn(() => Effect.succeed({ messageId: "message-1" })),
			}),
			Effect.provideService(ApprovalAuditLogger, {
				log: vi.fn(() => Effect.void),
				logBatch: vi.fn(() => Effect.void),
			}),
		),
	);
}

describe("formatAbsenceDateForEmail", () => {
	it("formats dates for absence emails", () => {
		expect(formatAbsenceDateForEmail(new Date("2026-03-09T00:00:00.000Z"))).toBe("Mar 9, 2026");
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
				) => updateEntity(dbService, entityId, currentEmployee),
			),
		}));
		const { approveAbsenceWithCurrentApproverEffect } = await import(
			"@/lib/approvals/server/absence-approvals"
		);
		const dbService = createAbsenceDecisionDbService();

		await runAbsenceDecisionEffect(
			approveAbsenceWithCurrentApproverEffect(dbService, absenceCurrentApprover, "absence-1"),
		);

		expect(markEmployeeWorkBalanceDirty).toHaveBeenCalledWith({
			employeeId: "emp-requester",
			organizationId: "org-1",
			dirtyFromDate: "2026-05-11",
		});
		vi.doUnmock("@/lib/approvals/server/shared");
	});

	it("applies sick vacation overrides when approving a full-day sick absence", async () => {
		vi.resetModules();
		const syncCanonicalAbsenceApprovalState = vi.fn().mockResolvedValue(undefined);
		const syncCanonicalAbsenceApprovalStateInTransaction = vi.fn().mockResolvedValue(undefined);
		const adjustVacationAbsencesForSickness = vi.fn().mockResolvedValue({
			updatedAbsenceIds: ["vacation-updated"],
			createdAbsenceIds: ["vacation-created"],
			deletedAbsenceIds: ["vacation-deleted"],
		});
		vi.doMock("@/app/[locale]/(app)/absences/actions.canonical", async (importOriginal) => {
			const actual = await importOriginal<typeof import("@/app/[locale]/(app)/absences/actions.canonical")>();
			return {
				...actual,
				syncCanonicalAbsenceApprovalState,
				syncCanonicalAbsenceApprovalStateInTransaction,
			};
		});
		vi.doMock("@/lib/absences/sick-vacation-override", async (importOriginal) => {
			const actual = await importOriginal<typeof import("@/lib/absences/sick-vacation-override")>();
			return { ...actual, adjustVacationAbsencesForSickness };
		});
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
				) => Effect.gen(function* (_) {
					const result = yield* _(updateEntity(dbService, entityId, currentEmployee));
					expect(addCalendarSyncJob).not.toHaveBeenCalledWith({
						absenceId: "absence-1",
						employeeId: "emp-requester",
						action: "create",
					});
					expect(addCalendarSyncJob).not.toHaveBeenCalledWith({
						absenceId: "vacation-updated",
						employeeId: "emp-requester",
						action: "update",
					});
					expect(addCalendarSyncJob).not.toHaveBeenCalledWith({
						absenceId: "vacation-created",
						employeeId: "emp-requester",
						action: "create",
					});
					expect(addCalendarSyncJob).not.toHaveBeenCalledWith({
						absenceId: "vacation-deleted",
						employeeId: "emp-requester",
						action: "delete",
					});
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
			approveAbsenceWithCurrentApproverEffect(dbService, absenceCurrentApprover, "absence-1"),
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
		expect(syncCanonicalAbsenceApprovalStateInTransaction).toHaveBeenCalledWith(dbService.db, {
			organizationId: "org-1",
			canonicalRecordId: null,
			approvalState: "approved",
			updatedBy: "user-manager",
		});
		expect(addCalendarSyncJob).toHaveBeenCalledWith({
			absenceId: "absence-1",
			employeeId: "emp-requester",
			action: "create",
		});
		expect(addCalendarSyncJob).toHaveBeenCalledWith({
			absenceId: "vacation-updated",
			employeeId: "emp-requester",
			action: "update",
		});
		expect(addCalendarSyncJob).toHaveBeenCalledWith({
			absenceId: "vacation-created",
			employeeId: "emp-requester",
			action: "create",
		});
		expect(addCalendarSyncJob).toHaveBeenCalledWith({
			absenceId: "vacation-deleted",
			employeeId: "emp-requester",
			action: "delete",
		});
		vi.doUnmock("@/app/[locale]/(app)/absences/actions.canonical");
		vi.doUnmock("@/lib/absences/sick-vacation-override");
		vi.doUnmock("@/lib/approvals/server/shared");
	});

	it("does not apply sick vacation overrides when rejecting a sick absence", async () => {
		vi.resetModules();
		const adjustVacationAbsencesForSickness = vi.fn();
		vi.doMock("@/lib/absences/sick-vacation-override", async (importOriginal) => {
			const actual = await importOriginal<typeof import("@/lib/absences/sick-vacation-override")>();
			return { ...actual, adjustVacationAbsencesForSickness };
		});
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
			approveAbsenceWithCurrentApproverEffect(dbService, absenceCurrentApprover, "absence-1"),
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
				user: { id: "user-manager", name: "Manager", email: "manager@example.com", image: null },
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
				user: { id: "user-manager", name: "Manager", email: "manager@example.com", image: null },
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
		);
		vi.doUnmock("@/lib/approvals/server/shared");
	});

	it("forces exported absence approval actions through the transactional process path", async () => {
		vi.resetModules();
		const processApproval = vi.fn().mockResolvedValue(undefined);
		vi.doMock("@/lib/approvals/server/shared", () => ({
			processApproval,
			processApprovalWithCurrentEmployee: vi.fn(),
		}));
		const { approveAbsenceEffect } = await import("@/lib/approvals/server/absence-approvals");

		await approveAbsenceEffect("absence-1");

		expect(processApproval).toHaveBeenCalledWith(
			"absence_entry",
			"absence-1",
			"approve",
			undefined,
			expect.any(Function),
			undefined,
			expect.objectContaining({ transactional: true }),
		);
		vi.doUnmock("@/lib/approvals/server/shared");
	});

	it("forces exported absence rejection actions through the transactional process path", async () => {
		vi.resetModules();
		const processApproval = vi.fn().mockResolvedValue(undefined);
		vi.doMock("@/lib/approvals/server/shared", () => ({
			processApproval,
			processApprovalWithCurrentEmployee: vi.fn(),
		}));
		const { rejectAbsenceEffect } = await import("@/lib/approvals/server/absence-approvals");

		await rejectAbsenceEffect("absence-1", "Too late");

		expect(processApproval).toHaveBeenCalledWith(
			"absence_entry",
			"absence-1",
			"reject",
			"Too late",
			expect.any(Function),
			undefined,
			expect.objectContaining({ transactional: true }),
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

		expect(result).toEqual({ kind: "default_created", approvalRequestId: "insert-1" });
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

		expect(result).toEqual({ kind: "default_created", approvalRequestId: "insert-1" });
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
		const { dbService, inserts } = createPolicyResolutionDbService([
			{
				id: "policy-1",
				organizationId: "org-1",
				name: "Absence policy",
				isActive: true,
				priority: 1,
				conditions: [
					{ conditionType: "approval_type", operator: "equals", valueJson: "absence_entry" },
				],
				stages: [
					{
						id: "stage-1",
						stepOrder: 1,
						label: "Manager",
						approverType: "direct_manager",
						approverEmployeeId: null,
					},
				],
			},
		]);

		const result = await Effect.runPromise(
			resolvePolicyAndCreateApproval(dbService, {
				context: absencePolicyContext,
				defaultApproverId: "emp-manager",
			}),
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
		expect(inserts[0].values).toMatchObject({ policyId: "policy-1", entityType: "absence_entry" });
		expect(inserts[1].values).toMatchObject({ approverId: "emp-manager", entityId: "absence-1" });
		expect(inserts[2].values).toMatchObject({
			chainInstanceId: "insert-1",
			approvalRequestId: "insert-2",
			resolvedApproverEmployeeId: "emp-manager",
		});
	});

	it("falls back to manager approval when a matched absence policy cannot resolve", async () => {
		const { dbService, inserts } = createPolicyResolutionDbService([
			{
				id: "policy-1",
				organizationId: "org-1",
				name: "Broken absence policy",
				isActive: true,
				priority: 1,
				conditions: [{ conditionType: "approval_type", operator: "equals", valueJson: "absence_entry" }],
				stages: [
					{
						id: "stage-1",
						stepOrder: 1,
						label: "Missing approver",
						approverType: "specific_employee",
						approverEmployeeId: "missing-employee",
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

		expect(result).toEqual({ kind: "default_created", approvalRequestId: "insert-1" });
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
});
