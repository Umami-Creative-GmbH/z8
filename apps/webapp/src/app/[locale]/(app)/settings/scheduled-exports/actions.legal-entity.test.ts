import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	session: {
		user: { id: "user-1", email: "admin@example.com", name: "Admin" },
		session: {
			id: "session-1",
			userId: "user-1",
			expiresAt: new Date("2099-01-01T00:00:00.000Z"),
			token: "token",
			activeOrganizationId: "org-1",
		},
	},
	isOrgAdminCasl: vi.fn(async () => true),
	findLegalEntity: vi.fn(async () => ({ id: "entity-a", organizationId: "org-1" })),
	findSchedule: vi.fn(async () => ({
		id: "schedule-1",
		organizationId: "org-1",
		legalEntityId: "entity-a",
		name: "Payroll",
		description: null,
		scheduleType: "manual",
		cronExpression: null,
		timezone: "UTC",
		reportType: "payroll_export",
		reportConfig: {},
		deliveryMethod: "s3_only",
		dateRangeStrategy: "previous_month",
		isActive: true,
		lastExecutionAt: null,
		nextExecutionAt: null,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
	})),
	findExecutions: vi.fn(async () => []),
	findEmployees: vi.fn(async () => []),
	findTeams: vi.fn(async () => []),
	findProjects: vi.fn(async () => []),
	updateWhere: vi.fn(),
	deleteWhere: vi.fn(),
	updateReturning: vi.fn(async () => [{
		id: "schedule-1",
		name: "Payroll",
		description: null,
		scheduleType: "manual",
		cronExpression: null,
		timezone: "UTC",
		reportType: "payroll_export",
		deliveryMethod: "s3_only",
		dateRangeStrategy: "previous_month",
		isActive: false,
		lastExecutionAt: null,
		nextExecutionAt: null,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
	}]),
	orchestratorExecute: vi.fn(async () => undefined),
	revalidatePath: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	desc: vi.fn((column: unknown) => ({ desc: column })),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			legalEntity: { findFirst: mockState.findLegalEntity },
			scheduledExport: { findFirst: mockState.findSchedule },
			scheduledExportExecution: { findMany: mockState.findExecutions },
			employee: { findMany: mockState.findEmployees },
			team: { findMany: mockState.findTeams },
			project: { findMany: mockState.findProjects },
		},
		update: vi.fn(() => ({
			set: vi.fn(() => ({
				where: vi.fn((where) => {
					mockState.updateWhere(where);
					return { returning: mockState.updateReturning };
				}),
			})),
		})),
		delete: vi.fn(() => ({
			where: vi.fn((where) => {
				mockState.deleteWhere(where);
				return Promise.resolve();
			}),
		})),
	},
	employee: {
		organizationId: "employee.organizationId",
		legalEntityId: "employee.legalEntityId",
		isActive: "employee.isActive",
	},
	project: { organizationId: "project.organizationId" },
	scheduledExport: {
		id: "scheduledExport.id",
		organizationId: "scheduledExport.organizationId",
		legalEntityId: "scheduledExport.legalEntityId",
	},
	scheduledExportExecution: {
		scheduledExportId: "scheduledExportExecution.scheduledExportId",
		organizationId: "scheduledExportExecution.organizationId",
		legalEntityId: "scheduledExportExecution.legalEntityId",
		triggeredAt: "scheduledExportExecution.triggeredAt",
	},
	team: { organizationId: "team.organizationId" },
}));

vi.mock("@/db/schema", () => ({
	legalEntity: {
		id: "legalEntity.id",
		organizationId: "legalEntity.organizationId",
	},
}));

vi.mock("@/lib/auth-helpers", () => ({
	isOrgAdminCasl: mockState.isOrgAdminCasl,
}));

vi.mock("@/lib/effect/services/auth.service", async () => {
	const { Context } = await import("effect");

	class AuthService extends Context.Tag("AuthService")<
		AuthService,
		{ readonly getSession: () => unknown }
	>() {}

	return { AuthService };
});

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect, Layer } = await import("effect");
	const { AuthService } = await import("@/lib/effect/services/auth.service");

	return {
		AppLayer: Layer.succeed(AuthService, {
			getSession: () => Effect.succeed(mockState.session),
		}),
	};
});

vi.mock("@/lib/effect/result", async () => {
	const { Cause, Effect, Exit, Option } = await import("effect");

	const toServerActionResult = <T>(exit: unknown) =>
		Exit.match(exit as never, {
			onFailure: (cause) => {
				const defects = Cause.defects(cause);
				const defect = [...defects][0] ?? null;
				const failure = Option.getOrNull(Cause.failureOption(cause));
				const error = defect ?? failure ?? cause;

				if (error instanceof Error) {
					return {
						success: false as const,
						error: error.message || "An unexpected error occurred",
						code: "UNKNOWN_ERROR",
					};
				}

				return {
					success: false as const,
					error: "An unexpected error occurred",
					code: "UNKNOWN_ERROR",
				};
			},
			onSuccess: (data) => ({ success: true as const, data }),
		});

	return {
		runServerActionSafe: async (effect: Parameters<typeof Effect.runPromiseExit>[0]) => {
			const exit = await Effect.runPromiseExit(effect);
			return toServerActionResult(exit);
		},
	};
});

vi.mock("@/lib/scheduled-exports/application/orchestrator", () => ({
	ScheduledExportOrchestrator: class {
		executeSchedule = mockState.orchestratorExecute;
	},
}));

vi.mock("next/cache", () => ({
	revalidatePath: mockState.revalidatePath,
}));

import {
	deleteScheduledExportAction,
	getExecutionHistoryAction,
	getFilterOptionsAction,
	runScheduledExportNowAction,
	toggleScheduledExportAction,
	updateScheduledExportAction,
} from "./actions";

describe("scheduled export legal entity scoping", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("scopes updates by organization, legal entity, and schedule id", async () => {
		await updateScheduledExportAction({
			id: "schedule-1",
			organizationId: "org-1",
			legalEntityId: "entity-a",
			name: "Updated",
		});

		expect(JSON.stringify(mockState.updateWhere.mock.calls[0]?.[0])).toContain("scheduledExport.legalEntityId");
		expect(JSON.stringify(mockState.updateWhere.mock.calls[0]?.[0])).toContain("entity-a");
	});

	it("scopes deletes by organization, legal entity, and schedule id", async () => {
		await deleteScheduledExportAction("org-1", "entity-a", "schedule-1");

		expect(JSON.stringify(mockState.deleteWhere.mock.calls[0]?.[0])).toContain("scheduledExport.legalEntityId");
		expect(JSON.stringify(mockState.deleteWhere.mock.calls[0]?.[0])).toContain("entity-a");
	});

	it("scopes toggles by organization, legal entity, and schedule id", async () => {
		await toggleScheduledExportAction("org-1", "entity-a", "schedule-1", false);

		expect(JSON.stringify(mockState.updateWhere.mock.calls[0]?.[0])).toContain("scheduledExport.legalEntityId");
		expect(JSON.stringify(mockState.updateWhere.mock.calls[0]?.[0])).toContain("entity-a");
	});

	it("scopes execution history by schedule legal entity", async () => {
		await getExecutionHistoryAction("org-1", "entity-a", "schedule-1", 50);
		const call = (mockState.findExecutions.mock.calls as Array<Array<{ where?: unknown }>>)[0];
		const where = JSON.stringify(call?.[0]?.where);

		expect(where).toContain("scheduledExportExecution.legalEntityId");
		expect(where).toContain("entity-a");
	});

	it("scopes run-now schedule lookup by legal entity", async () => {
		await runScheduledExportNowAction("org-1", "entity-a", "schedule-1");
		const call = (mockState.findSchedule.mock.calls as Array<Array<{ where?: unknown }>>)[0];
		const where = JSON.stringify(call?.[0]?.where);

		expect(where).toContain("scheduledExport.legalEntityId");
		expect(where).toContain("entity-a");
	});

	it("scopes filter employees by selected legal entity", async () => {
		await getFilterOptionsAction("org-1", "entity-a");
		const call = (mockState.findEmployees.mock.calls as Array<Array<{ where?: unknown }>>)[0];
		const where = JSON.stringify(call?.[0]?.where);

		expect(where).toContain("employee.legalEntityId");
		expect(where).toContain("entity-a");
	});
});
