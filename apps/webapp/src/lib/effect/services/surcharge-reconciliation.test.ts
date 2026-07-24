import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { reconcileSurchargeWorkPeriodsWithDatabase } from "./surcharge.service";

const input = {
	organizationId: "org-1",
	employeeId: "employee-1",
	surchargePeriodIds: ["period-1"],
	staleSurchargePeriodIds: [],
};

function assignmentFixture(input?: {
	id?: string;
	isActive?: boolean;
	effectiveFrom?: Date | null;
	effectiveUntil?: Date | null;
	modelId?: string;
	modelOrganizationId?: string;
}) {
	return {
		id: input?.id ?? "assignment-1",
		organizationId: "org-1",
		isActive: input?.isActive ?? true,
		effectiveFrom:
			input && "effectiveFrom" in input
				? input.effectiveFrom
				: new Date("2026-07-01T00:00:00Z"),
		effectiveUntil:
			input && "effectiveUntil" in input
				? input.effectiveUntil
				: new Date("2026-07-19T10:00:00Z"),
		model: {
			id: input?.modelId ?? "model-1",
			organizationId: input?.modelOrganizationId ?? "org-1",
			name: "Sunday",
			isActive: true,
			rules: [
				{
					id: `rule-${input?.modelId ?? "1"}`,
					name: "Sunday 50%",
					ruleType: "day_of_week",
					percentage: "0.5000",
					dayOfWeek: "sunday",
					priority: 1,
					isActive: true,
				},
			],
		},
	};
}

function database(options?: {
	periods?: Array<Record<string, unknown>>;
	model?: Record<string, unknown> | null;
	teamId?: string | null;
	assignmentScopes?: Array<Array<Record<string, unknown>>>;
}) {
	const deletes: unknown[] = [];
	const inserts: unknown[] = [];
	const assignmentQueries: Array<Record<string, unknown>> = [];
	const calculations: Array<Record<string, unknown>> = [{ id: "stale" }];
	const period = {
		id: "period-1",
		organizationId: "org-1",
		employeeId: "employee-1",
		startTime: new Date("2026-07-19T08:00:00Z"),
		endTime: new Date("2026-07-19T10:00:00Z"),
		approvalStatus: "approved",
	};
	const assignment =
		options?.model === undefined ? assignmentFixture() : options.model;
	const assignmentScopes =
		options?.assignmentScopes ?? (assignment ? [[assignment]] : [[]]);
	const tx = {
		query: {
			workPeriod: {
				findMany: vi.fn().mockResolvedValue(options?.periods ?? [period]),
			},
			employee: {
				findMany: vi.fn().mockResolvedValue([
					{
						id: "employee-1",
						organizationId: "org-1",
						teamId: options?.teamId ?? null,
					},
				]),
			},
			surchargeModelAssignment: {
				findMany: vi.fn((query) => {
					assignmentQueries.push(query);
					return Promise.resolve(assignmentScopes.shift() ?? []);
				}),
			},
			organization: {
				findFirst: vi.fn().mockResolvedValue({
					id: "org-1",
					timezone: "UTC",
					surchargesEnabled: true,
				}),
			},
		},
		delete: vi.fn(() => ({
			where: vi.fn((where) => {
				deletes.push(where);
				calculations.length = 0;
				return Promise.resolve();
			}),
		})),
		insert: vi.fn(() => ({
			values: vi.fn((values) => {
				inserts.push(values);
				calculations.push(values);
				return Promise.resolve();
			}),
		})),
	};
	return {
		db: {
			transaction: vi.fn(async (run) => {
				const before = [...calculations];
				try {
					return await run(tx);
				} catch (error) {
					calculations.splice(0, calculations.length, ...before);
					throw error;
				}
			}),
		},
		tx,
		deletes,
		inserts,
		assignmentQueries,
		calculations,
	};
}

describe("reconcileSurchargeWorkPeriodsWithDatabase", () => {
	it("replaces an existing target calculation in one transaction", async () => {
		const fake = database();

		await reconcileSurchargeWorkPeriodsWithDatabase(fake.db as never, input);

		expect(fake.db.transaction).toHaveBeenCalledOnce();
		expect(fake.tx.delete).toHaveBeenCalledOnce();
		expect(fake.inserts).toEqual([
			expect.objectContaining({
				organizationId: "org-1",
				employeeId: "employee-1",
				workPeriodId: "period-1",
				surchargeMinutes: 60,
			}),
		]);
	});

	it("leaves the replaced row deleted when recalculation is zero", async () => {
		const fake = database({ model: null });

		await reconcileSurchargeWorkPeriodsWithDatabase(fake.db as never, input);

		expect(fake.tx.delete).toHaveBeenCalledOnce();
		expect(fake.inserts).toEqual([]);
	});

	it("selects historical assignment applicability at the completed period end", async () => {
		const fake = database();

		await reconcileSurchargeWorkPeriodsWithDatabase(fake.db as never, input);

		const dialect = new PgDialect();
		const assignmentQueries = fake.assignmentQueries.map((query) =>
			dialect.sqlToQuery(query.where as SQL),
		);
		const effectiveInstants = assignmentQueries.flatMap(({ params }) =>
			params.filter(
				(value): value is string =>
					typeof value === "string" && value.startsWith("2026-07-19T10:00:00"),
			),
		);
		expect(effectiveInstants).toEqual([
			"2026-07-19T10:00:00.000Z",
			"2026-07-19T10:00:00.000Z",
		]);
		expect(assignmentQueries.map(({ sql }) => sql).join("\n")).not.toContain(
			'"is_active"',
		);
		expect(fake.assignmentQueries).toEqual([
			expect.objectContaining({ limit: 2 }),
		]);
	});

	it.each([
		["retired first", false],
		["replacement first", true],
	] as const)("rejects overlapping employee history with %s", async (_label, reverse) => {
		const retired = assignmentFixture({
			id: "assignment-retired",
			isActive: false,
			effectiveFrom: new Date("2026-01-01T00:00:00Z"),
			effectiveUntil: null,
			modelId: "model-retired",
		});
		const replacement = assignmentFixture({
			id: "assignment-replacement",
			effectiveFrom: new Date("2026-07-01T00:00:00Z"),
			effectiveUntil: null,
			modelId: "model-replacement",
		});
		const rows = reverse ? [replacement, retired] : [retired, replacement];
		const fake = database({ assignmentScopes: [rows] });

		await expect(
			reconcileSurchargeWorkPeriodsWithDatabase(fake.db as never, input),
		).rejects.toThrow("Surcharge reconciliation failed");

		expect(fake.assignmentQueries).toEqual([
			expect.objectContaining({ limit: 2 }),
		]);
		expect(fake.inserts).toEqual([]);
		expect(fake.calculations).toEqual([{ id: "stale" }]);
	});

	it.each([
		"team",
		"organization",
	] as const)("rejects ambiguous %s assignment history", async (scope) => {
		const rows = [
			assignmentFixture({ id: `${scope}-1`, modelId: `${scope}-model-1` }),
			assignmentFixture({ id: `${scope}-2`, modelId: `${scope}-model-2` }),
		];
		const fake = database({
			teamId: scope === "team" ? "team-1" : null,
			assignmentScopes: [[], rows],
		});

		await expect(
			reconcileSurchargeWorkPeriodsWithDatabase(fake.db as never, input),
		).rejects.toThrow("Surcharge reconciliation failed");
		expect(fake.assignmentQueries).toHaveLength(2);
		expect(fake.assignmentQueries).toEqual([
			expect.objectContaining({ limit: 2 }),
			expect.objectContaining({ limit: 2 }),
		]);
		expect(fake.calculations).toEqual([{ id: "stale" }]);
	});

	it("selects the one nonoverlapping historical replacement regardless current active state", async () => {
		const historical = assignmentFixture({
			id: "assignment-historical",
			isActive: false,
			effectiveFrom: new Date("2026-01-01T00:00:00Z"),
			effectiveUntil: new Date("2026-07-19T10:00:00Z"),
			modelId: "model-historical",
		});
		const fake = database({ assignmentScopes: [[historical]] });

		await reconcileSurchargeWorkPeriodsWithDatabase(fake.db as never, input);

		expect(fake.inserts).toEqual([
			expect.objectContaining({ surchargeModelId: "model-historical" }),
		]);
	});

	it("falls through employee to team and does not query lower organization scope", async () => {
		const team = assignmentFixture({
			id: "assignment-team",
			modelId: "model-team",
		});
		const organization = assignmentFixture({
			id: "assignment-organization",
			modelId: "model-organization",
		});
		const fake = database({
			teamId: "team-1",
			assignmentScopes: [[], [team], [organization]],
		});

		await reconcileSurchargeWorkPeriodsWithDatabase(fake.db as never, input);

		expect(fake.assignmentQueries).toHaveLength(2);
		expect(fake.assignmentQueries).toEqual([
			expect.objectContaining({ limit: 2 }),
			expect.objectContaining({ limit: 2 }),
		]);
		expect(fake.inserts).toEqual([
			expect.objectContaining({ surchargeModelId: "model-team" }),
		]);
	});

	it("falls through empty employee and team scopes to organization", async () => {
		const organization = assignmentFixture({
			id: "assignment-organization",
			modelId: "model-organization",
		});
		const fake = database({
			teamId: "team-1",
			assignmentScopes: [[], [], [organization]],
		});

		await reconcileSurchargeWorkPeriodsWithDatabase(fake.db as never, input);

		expect(fake.assignmentQueries).toHaveLength(3);
		expect(fake.inserts).toEqual([
			expect.objectContaining({ surchargeModelId: "model-organization" }),
		]);
	});

	it("fails closed for a foreign joined model after entering the reconciliation transaction", async () => {
		const fake = database({
			model: {
				id: "assignment-1",
				organizationId: "org-1",
				model: {
					id: "model-foreign",
					organizationId: "org-2",
					isActive: true,
					rules: [],
				},
			},
		});

		await expect(
			reconcileSurchargeWorkPeriodsWithDatabase(fake.db as never, input),
		).rejects.toThrow("Surcharge reconciliation failed");
		expect(fake.tx.delete).toHaveBeenCalledOnce();
		expect(fake.tx.insert).not.toHaveBeenCalled();
	});

	it("retains the internal reconciliation failure as the generic error cause", async () => {
		const rootCause = new Error("database diagnostic");
		const failingDatabase = {
			transaction: vi.fn().mockRejectedValue(rootCause),
		};

		const error = await reconcileSurchargeWorkPeriodsWithDatabase(
			failingDatabase as never,
			input,
		).catch((cause: unknown) => cause);

		expect(error).toBeInstanceOf(Error);
		expect(error).toMatchObject({
			message: "Surcharge reconciliation failed",
			cause: rootCause,
		});
	});

	it("fails closed before delete for a missing or foreign period", async () => {
		const fake = database({ periods: [] });

		await expect(
			reconcileSurchargeWorkPeriodsWithDatabase(fake.db as never, input),
		).rejects.toThrow("Surcharge reconciliation failed");
		expect(fake.tx.delete).not.toHaveBeenCalled();
		expect(fake.tx.insert).not.toHaveBeenCalled();
	});

	it("fails closed before delete when a target period is not approved", async () => {
		const fake = database({
			periods: [
				{
					id: "period-1",
					organizationId: "org-1",
					employeeId: "employee-1",
					startTime: new Date("2026-07-19T08:00:00Z"),
					endTime: new Date("2026-07-19T10:00:00Z"),
					approvalStatus: "pending",
				},
			],
		});

		await expect(
			reconcileSurchargeWorkPeriodsWithDatabase(fake.db as never, input),
		).rejects.toThrow("Surcharge reconciliation failed");
		expect(fake.tx.delete).not.toHaveBeenCalled();
	});
});
