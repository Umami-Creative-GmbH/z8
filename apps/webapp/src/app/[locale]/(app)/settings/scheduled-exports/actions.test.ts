import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

type Row = Record<string, unknown>;
type Condition = { column: string; value: unknown };

const orgAdmin: StubCaller = {
	userId: "admin-1",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: { id: "employee-admin-1", role: "admin", former: false },
};

const mockState = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	schedules: [] as Row[],
	reportConfigErrors: [] as string[],
	/** Users who are org admins of org-1, and so may own its schedules. */
	eligibleOwners: ["admin-1", "admin-2"],
	audit: [] as Row[],
	executed: [] as Row[],
}));

const AUDIT_LOG = vi.hoisted(() => ({ table: "audit_log" }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/db/schema", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/db/schema")>()),
	auditLog: AUDIT_LOG,
}));

vi.mock("@/lib/audit-logger", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/audit-logger")>()),
	forwardAuditToExternalService: vi.fn(),
}));

// Eligibility itself is SQL, covered by the PostgreSQL suite (schedule-owner.integration.test.ts).
vi.mock("@/lib/scheduled-exports/application/schedule-owner", () => ({
	describeScheduleOwner: vi.fn(
		async (_client: unknown, input: { organizationId: string; userId: string }) => ({
			userId: input.userId,
			name: `Name of ${input.userId}`,
			email: `${input.userId}@example.com`,
			eligible: input.organizationId === "org-1" && mockState.eligibleOwners.includes(input.userId),
		}),
	),
}));

vi.mock("@/lib/scheduled-exports/application/orchestrator", () => ({
	ScheduledExportOrchestrator: class {
		async executeSchedule(schedule: Row, _at: unknown, run: Row) {
			mockState.executed.push({ scheduleId: schedule.id, ...run });
		}
	},
}));

// Each executor's own validation has its suite (executors/registry.test.ts).
vi.mock("@/lib/scheduled-exports/application/executors/registry", () => ({
	validateScheduledReportConfig: vi.fn(async () => mockState.reportConfigErrors),
}));

// A fake that honours `where`: conditions are flattened to column = value pairs.
vi.mock("drizzle-orm", async (importOriginal) => ({
	...(await importOriginal<typeof import("drizzle-orm")>()),
	and: vi.fn((...conditions: unknown[]) => conditions.flat()),
	asc: vi.fn((value: unknown) => value),
	desc: vi.fn((value: unknown) => value),
	eq: vi.fn((column: string, value: unknown) => [{ column, value }]),
}));

const fakeDb = vi.hoisted(() => {
	const matches = (row: Row, where: Condition[]) =>
		where.every(({ column, value }) => row[column] === value);

	const db = {
		query: {
			scheduledExport: {
				findFirst: async ({ where }: { where: Condition[] }) =>
					mockState.schedules.find((row) => matches(row, where)) ?? undefined,
			},
		},
		// One connection: a transaction runs on the same fake.
		transaction: async <T>(run: (tx: unknown) => Promise<T>) => run(db),
		insert: (table: unknown) => ({
			values: (values: Row) => {
				if (table === AUDIT_LOG) {
					mockState.audit.push(values);
					return Promise.resolve();
				}
				return {
					returning: async () => {
						const row = {
							id: `schedule-${mockState.schedules.length + 1}`,
							isActive: true,
							...values,
						};
						mockState.schedules.push(row);
						return [row];
					},
				};
			},
		}),
		update: () => ({
			set: (updates: Row) => ({
				where: (where: Condition[]) => ({
					returning: async () => {
						const updated = mockState.schedules.filter((row) => matches(row, where));
						for (const row of updated) Object.assign(row, updates);
						return updated.map((row) => ({ ...row }));
					},
				}),
			}),
		}),
		delete: () => ({
			where: (where: Condition[]) => ({
				returning: async () => {
					const deleted = mockState.schedules.filter((row) => matches(row, where));
					mockState.schedules = mockState.schedules.filter((row) => !deleted.includes(row));
					return deleted;
				},
			}),
		}),
	};
	return db;
});

vi.mock("@/db", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/db")>()),
	scheduledExport: { id: "id", organizationId: "organizationId", createdAt: "createdAt" },
	db: fakeDb,
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => mockState.caller, { db: fakeDb }));
});

const {
	changeScheduledExportOwnerAction,
	createScheduledExportAction,
	deleteScheduledExportAction,
	getExecutionHistoryAction,
	getFilterOptionsAction,
	getPayrollConfigsAction,
	getScheduledExportAction,
	getScheduledExportsAction,
	getScheduleOwnerCandidatesAction,
	previewNextExecutionsAction,
	runScheduledExportNowAction,
	toggleScheduledExportAction,
	updateScheduledExportAction,
} = await import("./actions");

function storedSchedule(overrides: Row = {}): Row {
	return {
		id: "schedule-1",
		organizationId: "org-1",
		name: "Monthly payroll",
		scheduleType: "monthly",
		cronExpression: null,
		timezone: "Europe/Berlin",
		reportType: "payroll_export",
		deliveryMethod: "email_only",
		emailRecipients: ["payroll@example.com"],
		isActive: true,
		ownerId: "admin-1",
		...overrides,
	};
}

const createInput = {
	name: "Monthly payroll",
	scheduleType: "monthly",
	reportType: "payroll_export",
	reportConfig: { formatId: "datev_lohn" },
	dateRangeStrategy: "previous_month",
	deliveryMethod: "email_only",
	emailRecipients: ["payroll@example.com"],
} as const;

/** Signed in as an admin of org-2, where schedule-1 belongs to org-1. */
const otherOrgAdmin: StubCaller = { ...orgAdmin, activeOrganizationId: "org-2" };

beforeEach(() => {
	mockState.caller = orgAdmin;
	mockState.schedules = [storedSchedule()];
	mockState.reportConfigErrors = [];
	mockState.eligibleOwners = ["admin-1", "admin-2"];
	mockState.audit = [];
	mockState.executed = [];
});

/** The audit rows written, with their JSON columns parsed. */
function auditEntries() {
	return mockState.audit.map((row) => ({
		action: row.action,
		performedBy: row.performedBy,
		entityType: row.entityType,
		entityId: row.entityId,
		organizationId: row.organizationId,
		changes: row.changes ? JSON.parse(row.changes as string) : null,
		metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
	}));
}

describe("scheduled export settings access", () => {
	const scopedManager: StubCaller = {
		...orgAdmin,
		membershipRole: "member",
		employee: { id: "employee-manager", role: "manager", former: false },
	};

	it.each([
		["create", () => createScheduledExportAction(createInput)],
		["list", () => getScheduledExportsAction()],
		["owner candidates", () => getScheduleOwnerCandidatesAction()],
		["get", () => getScheduledExportAction({ scheduleId: "schedule-1" })],
		["update", () => updateScheduledExportAction({ id: "schedule-1", name: "Renamed" })],
		[
			"change owner",
			() => changeScheduledExportOwnerAction({ scheduleId: "schedule-1", newOwnerId: "admin-2" }),
		],
		["delete", () => deleteScheduledExportAction({ scheduleId: "schedule-1" })],
		["toggle", () => toggleScheduledExportAction({ scheduleId: "schedule-1", isActive: false })],
		["execution history", () => getExecutionHistoryAction({ scheduleId: "schedule-1" })],
		["run now", () => runScheduledExportNowAction({ scheduleId: "schedule-1" })],
		["filter options", () => getFilterOptionsAction()],
		["payroll configs", () => getPayrollConfigsAction()],
	])("refuses %s to a scoped manager", async (_name, run) => {
		mockState.caller = scopedManager;
		const before = structuredClone(mockState.schedules);

		expect(await run()).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mockState.schedules).toEqual(before);
		expect(mockState.audit).toEqual([]);
		expect(mockState.executed).toEqual([]);
	});

	it("previews the next runs for an org member, and refuses a pending membership", async () => {
		mockState.caller = {
			...orgAdmin,
			membershipRole: "member",
			employee: { id: "employee-member", role: "employee", former: false },
		};
		const input = { scheduleType: "daily", timezone: "UTC", count: 2 } as const;

		expect(await previewNextExecutionsAction(input)).toMatchObject({
			success: true,
			data: [expect.any(String), expect.any(String)],
		});

		mockState.caller = { ...orgAdmin, membershipRole: null };
		expect(await previewNextExecutionsAction(input)).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
	});

	it("refuses an invalid cron expression as a validation error", async () => {
		const result = await previewNextExecutionsAction({
			scheduleType: "cron",
			cronExpression: "not a cron",
			timezone: "UTC",
		});

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
	});
});

describe("scheduled export owner", () => {
	it("makes the creating admin the owner and audits the creation", async () => {
		const created = await createScheduledExportAction(createInput);

		expect(created).toMatchObject({
			success: true,
			data: { ownerId: "admin-1", ownerEligible: true },
		});
		const id = created.success ? created.data.id : "";
		expect(mockState.schedules.find((row) => row.id === id)).toMatchObject({
			organizationId: "org-1",
			ownerId: "admin-1",
			createdBy: "admin-1",
		});
		expect(auditEntries()).toEqual([
			{
				action: "scheduled_export.created",
				performedBy: "admin-1",
				entityType: "scheduled_export",
				entityId: id,
				organizationId: "org-1",
				changes: null,
				metadata: expect.objectContaining({
					name: "Monthly payroll",
					reportType: "payroll_export",
					deliveryMethod: "email_only",
					emailRecipients: ["payroll@example.com"],
					ownerId: "admin-1",
				}),
			},
		]);
	});

	it("refuses resuming a schedule whose owner is no longer an org admin", async () => {
		mockState.schedules = [storedSchedule({ isActive: false, ownerId: "former-admin" })];

		const result = await toggleScheduledExportAction({ scheduleId: "schedule-1", isActive: true });

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mockState.schedules[0]?.isActive).toBe(false);
		expect(mockState.audit).toEqual([]);
	});

	it("refuses running a schedule now whose owner is no longer an org admin", async () => {
		mockState.schedules = [storedSchedule({ ownerId: "former-admin" })];

		const result = await runScheduledExportNowAction({ scheduleId: "schedule-1" });

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mockState.executed).toEqual([]);
		expect(mockState.audit).toEqual([]);
	});

	it("audits a run-now request and runs it on behalf of the owner", async () => {
		mockState.schedules = [storedSchedule({ ownerId: "admin-2" })];

		const result = await runScheduledExportNowAction({ scheduleId: "schedule-1" });

		expect(result.success).toBe(true);
		expect(mockState.executed).toEqual([
			{ scheduleId: "schedule-1", trigger: "run_now", requestedBy: "admin-1" },
		]);
		expect(auditEntries()).toEqual([
			expect.objectContaining({
				action: "scheduled_export.run_requested",
				performedBy: "admin-1",
				entityId: "schedule-1",
				metadata: expect.objectContaining({ ownerId: "admin-2" }),
			}),
		]);
	});

	it("hands a schedule to another org admin and audits the change", async () => {
		mockState.schedules = [storedSchedule({ isActive: false, ownerId: "former-admin" })];

		const result = await changeScheduledExportOwnerAction({
			scheduleId: "schedule-1",
			newOwnerId: "admin-2",
		});

		expect(result).toMatchObject({ success: true, data: { ownerId: "admin-2", isActive: false } });
		expect(mockState.schedules[0]).toMatchObject({ ownerId: "admin-2", updatedBy: "admin-1" });
		expect(auditEntries()).toEqual([
			expect.objectContaining({
				action: "scheduled_export.owner_changed",
				performedBy: "admin-1",
				entityId: "schedule-1",
				changes: { ownerId: { before: "former-admin", after: "admin-2" } },
			}),
		]);
	});

	it("refuses handing a schedule to someone who isn't an org admin", async () => {
		const result = await changeScheduledExportOwnerAction({
			scheduleId: "schedule-1",
			newOwnerId: "payroll-clerk",
		});

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mockState.schedules[0]?.ownerId).toBe("admin-1");
		expect(mockState.audit).toEqual([]);
	});

	it("treats another organization's schedule as not found when changing its owner", async () => {
		mockState.caller = otherOrgAdmin;

		const result = await changeScheduledExportOwnerAction({
			scheduleId: "schedule-1",
			newOwnerId: "admin-2",
		});

		expect(result).toMatchObject({ success: false, code: "NotFoundError" });
		expect(mockState.schedules[0]?.ownerId).toBe("admin-1");
	});
});

describe("scheduled export lifecycle audit", () => {
	it("audits an update with a before/after diff, and a pause as its own entry", async () => {
		const result = await updateScheduledExportAction({
			id: "schedule-1",
			emailRecipients: ["payroll@example.com", "tax@example.com"],
			isActive: false,
		});

		expect(result.success).toBe(true);
		expect(auditEntries()).toEqual([
			expect.objectContaining({
				action: "scheduled_export.updated",
				performedBy: "admin-1",
				entityId: "schedule-1",
				changes: {
					emailRecipients: {
						before: ["payroll@example.com"],
						after: ["payroll@example.com", "tax@example.com"],
						added: ["tax@example.com"],
						removed: [],
					},
				},
			}),
			expect.objectContaining({
				action: "scheduled_export.paused",
				performedBy: "admin-1",
				entityId: "schedule-1",
				metadata: expect.objectContaining({ automatic: false }),
			}),
		]);
	});

	it("writes no entry for an update that changes nothing", async () => {
		const result = await updateScheduledExportAction({
			id: "schedule-1",
			name: "Monthly payroll",
		});

		expect(result.success).toBe(true);
		expect(mockState.audit).toEqual([]);
	});

	it("audits a deletion with what the schedule was", async () => {
		const result = await deleteScheduledExportAction({ scheduleId: "schedule-1" });

		expect(result.success).toBe(true);
		expect(mockState.schedules).toEqual([]);
		expect(auditEntries()).toEqual([
			expect.objectContaining({
				action: "scheduled_export.deleted",
				performedBy: "admin-1",
				entityId: "schedule-1",
				metadata: expect.objectContaining({
					name: "Monthly payroll",
					emailRecipients: ["payroll@example.com"],
					ownerId: "admin-1",
				}),
			}),
		]);
	});

	it("deletes nothing and audits nothing for another organization's schedule", async () => {
		mockState.caller = otherOrgAdmin;

		const result = await deleteScheduledExportAction({ scheduleId: "schedule-1" });

		expect(result).toMatchObject({ success: false, code: "NotFoundError" });
		expect(mockState.schedules).toHaveLength(1);
		expect(mockState.audit).toEqual([]);
	});
});

describe("scheduled export report configuration", () => {
	it("refuses a report configuration its executor rejects on create and update", async () => {
		mockState.reportConfigErrors = ["Payroll export format is not configured: sage_lohn"];
		const before = structuredClone(mockState.schedules);

		const created = await createScheduledExportAction({
			...createInput,
			reportConfig: { formatId: "sage_lohn" },
		});
		const updated = await updateScheduledExportAction({
			id: "schedule-1",
			reportConfig: { formatId: "sage_lohn" },
		});

		expect(created).toMatchObject({
			success: false,
			error: "Payroll export format is not configured: sage_lohn",
			code: "ValidationError",
		});
		expect(updated).toEqual(created);
		expect(mockState.schedules).toEqual(before);
	});
});

describe("scheduled export recipient validation", () => {
	it("rejects an invalid address on update with the same error as create", async () => {
		const created = await createScheduledExportAction({
			...createInput,
			emailRecipients: ["not-an-email"],
		});
		const updated = await updateScheduledExportAction({
			id: "schedule-1",
			emailRecipients: ["not-an-email"],
		});

		expect(created).toMatchObject({
			success: false,
			error: "Invalid email addresses: not-an-email",
		});
		expect(updated).toEqual(created);
		expect(mockState.schedules[0]?.emailRecipients).toEqual(["payroll@example.com"]);
	});

	it("refuses switching to email delivery while the stored list is empty", async () => {
		mockState.schedules = [storedSchedule({ deliveryMethod: "s3_only", emailRecipients: [] })];

		const result = await updateScheduledExportAction({
			id: "schedule-1",
			deliveryMethod: "s3_and_email",
		});

		expect(result).toMatchObject({
			success: false,
			error: "At least one email recipient is required for email delivery",
		});
		expect(mockState.schedules[0]?.deliveryMethod).toBe("s3_only");
	});

	it("refuses switching to email delivery with an empty list given", async () => {
		mockState.schedules = [
			storedSchedule({ deliveryMethod: "s3_only", emailRecipients: ["payroll@example.com"] }),
		];

		const result = await updateScheduledExportAction({
			id: "schedule-1",
			deliveryMethod: "email_only",
			emailRecipients: [],
		});

		expect(result).toMatchObject({
			success: false,
			error: "At least one email recipient is required for email delivery",
		});
		expect(mockState.schedules[0]).toMatchObject({
			deliveryMethod: "s3_only",
			emailRecipients: ["payroll@example.com"],
		});
	});

	it("refuses clearing the recipients of a schedule that delivers by email", async () => {
		const result = await updateScheduledExportAction({
			id: "schedule-1",
			emailRecipients: [],
		});

		expect(result).toMatchObject({
			success: false,
			error: "At least one email recipient is required for email delivery",
		});
		expect(mockState.schedules[0]?.emailRecipients).toEqual(["payroll@example.com"]);
	});

	it("allows clearing the recipients while switching to S3-only delivery", async () => {
		const result = await updateScheduledExportAction({
			id: "schedule-1",
			deliveryMethod: "s3_only",
			emailRecipients: [],
		});

		expect(result).toMatchObject({ success: true, data: { deliveryMethod: "s3_only" } });
		expect(mockState.schedules[0]?.emailRecipients).toEqual([]);
	});

	it("stores the same normalised list on create and update", async () => {
		const recipients = [" Payroll@Example.com", "payroll@example.com ", "HR@example.com"];

		const created = await createScheduledExportAction({
			...createInput,
			emailRecipients: recipients,
		});
		const updated = await updateScheduledExportAction({
			id: "schedule-1",
			emailRecipients: recipients,
		});

		expect(created.success).toBe(true);
		expect(updated.success).toBe(true);
		expect(mockState.schedules.map((row) => row.emailRecipients)).toEqual([
			["payroll@example.com", "hr@example.com"],
			["payroll@example.com", "hr@example.com"],
		]);
	});
});

describe("scheduled export update org scoping", () => {
	it.each([
		["a rename", { name: "Renamed" }],
		["a change to the schedule timing", { scheduleType: "weekly", timezone: "UTC" }],
	] as const)("treats another organization's schedule as not found on %s", async (_, changes) => {
		const before = structuredClone(mockState.schedules);

		mockState.caller = otherOrgAdmin;
		const otherOrg = await updateScheduledExportAction({ id: "schedule-1", ...changes });
		mockState.caller = orgAdmin;
		const unknown = await updateScheduledExportAction({ id: "schedule-missing", ...changes });

		expect(otherOrg).toMatchObject({
			success: false,
			error: "Scheduled export not found",
			code: "NotFoundError",
		});
		expect(unknown).toEqual(otherOrg);
		expect(mockState.schedules).toEqual(before);
	});
});
