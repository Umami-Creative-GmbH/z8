import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
type Condition = { column: string; value: unknown };

const mockState = vi.hoisted(() => ({
	schedules: [] as Row[],
	adminOrgs: ["org-1", "org-2"],
	reportConfigErrors: [] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Each executor's own validation has its suite (executors/registry.test.ts).
vi.mock("@/lib/scheduled-exports/application/executors/registry", () => ({
	validateScheduledReportConfig: vi.fn(async () => mockState.reportConfigErrors),
}));

// A fake that honours `where`: conditions are flattened to column = value pairs.
vi.mock("drizzle-orm", () => ({
	and: vi.fn((...conditions: unknown[]) => conditions.flat()),
	asc: vi.fn((value: unknown) => value),
	desc: vi.fn((value: unknown) => value),
	eq: vi.fn((column: string, value: unknown) => [{ column, value }]),
}));

vi.mock("@/lib/auth-helpers", () => ({
	isOrgAdminCasl: vi.fn(async (organizationId: string) =>
		mockState.adminOrgs.includes(organizationId),
	),
}));

vi.mock("@/lib/effect/services/auth.service", async () => {
	const { Context, Effect, Layer } = await import("effect");
	const AuthService = Context.Service<any>("AuthService");
	const AuthServiceLive = Layer.succeed(AuthService, {
		getSession: () => Effect.succeed({ user: { id: "admin-1" }, session: {} }),
	});
	return { AuthService, AuthServiceLive };
});

vi.mock("@/lib/effect/services/database.service", async () => {
	const { Context, Effect, Layer } = await import("effect");
	const dbModule = await import("@/db");
	const DatabaseService = Context.Service<any>("DatabaseService");
	const DatabaseServiceLive = Layer.succeed(DatabaseService, {
		query: (_name: string, fn: () => Promise<unknown>) => Effect.promise(fn),
		get db() {
			return dbModule.db;
		},
	});
	return { DatabaseService, DatabaseServiceLive };
});

vi.mock("@/lib/effect/runtime", async () => {
	const { Layer } = await import("effect");
	const { AuthServiceLive } = await import("@/lib/effect/services/auth.service");
	const { DatabaseServiceLive } = await import("@/lib/effect/services/database.service");
	return (await import("@/test/effect-runtime")).runtimeModuleOver(
		Layer.mergeAll(AuthServiceLive, DatabaseServiceLive),
	);
});

vi.mock("@/db", () => {
	const matches = (row: Row, where: Condition[]) =>
		where.every(({ column, value }) => row[column] === value);

	return {
		scheduledExport: { id: "id", organizationId: "organizationId", createdAt: "createdAt" },
		scheduledExportExecution: {},
		payrollExportConfig: {},
		db: {
			query: {
				scheduledExport: {
					findFirst: vi.fn(
						async ({ where }: { where: Condition[] }) =>
							mockState.schedules.find((row) => matches(row, where)) ?? undefined,
					),
				},
			},
			insert: vi.fn(() => ({
				values: (values: Row) => ({
					returning: async () => {
						const row = { id: `schedule-${mockState.schedules.length + 1}`, ...values };
						mockState.schedules.push(row);
						return [row];
					},
				}),
			})),
			update: vi.fn(() => ({
				set: (updates: Row) => ({
					where: (where: Condition[]) => ({
						returning: async () => {
							const updated = mockState.schedules.filter((row) => matches(row, where));
							for (const row of updated) Object.assign(row, updates);
							return updated;
						},
					}),
				}),
			})),
		},
	};
});

const { createScheduledExportAction, updateScheduledExportAction } = await import("./actions");

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
		...overrides,
	};
}

const createInput = {
	organizationId: "org-1",
	name: "Monthly payroll",
	scheduleType: "monthly",
	reportType: "payroll_export",
	reportConfig: { formatId: "datev_lohn" },
	dateRangeStrategy: "previous_month",
	deliveryMethod: "email_only",
	emailRecipients: ["payroll@example.com"],
} as const;

beforeEach(() => {
	mockState.schedules = [storedSchedule()];
	mockState.adminOrgs = ["org-1", "org-2"];
	mockState.reportConfigErrors = [];
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
			organizationId: "org-1",
			reportConfig: { formatId: "sage_lohn" },
		});

		expect(created).toEqual({
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
			organizationId: "org-1",
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
			organizationId: "org-1",
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
			organizationId: "org-1",
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
			organizationId: "org-1",
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
			organizationId: "org-1",
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
			organizationId: "org-1",
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

		const otherOrg = await updateScheduledExportAction({
			id: "schedule-1",
			organizationId: "org-2",
			...changes,
		});
		const unknown = await updateScheduledExportAction({
			id: "schedule-missing",
			organizationId: "org-1",
			...changes,
		});

		expect(otherOrg).toEqual({
			success: false,
			error: "Scheduled export not found",
			code: "NotFoundError",
		});
		expect(unknown).toEqual(otherOrg);
		expect(mockState.schedules).toEqual(before);
	});
});
