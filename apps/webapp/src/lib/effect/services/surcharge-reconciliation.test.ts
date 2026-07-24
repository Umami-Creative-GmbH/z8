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

function database(options?: {
	periods?: Array<Record<string, unknown>>;
	model?: Record<string, unknown> | null;
}) {
	const deletes: unknown[] = [];
	const inserts: unknown[] = [];
	const assignmentWhere: unknown[] = [];
	const period = {
		id: "period-1",
		organizationId: "org-1",
		employeeId: "employee-1",
		startTime: new Date("2026-07-19T08:00:00Z"),
		endTime: new Date("2026-07-19T10:00:00Z"),
		approvalStatus: "approved",
	};
	const assignment =
		options?.model === undefined
			? {
					id: "assignment-1",
					organizationId: "org-1",
					isActive: true,
					effectiveFrom: new Date("2026-07-01T00:00:00Z"),
					effectiveUntil: new Date("2026-07-19T10:00:00Z"),
					model: {
						id: "model-1",
						organizationId: "org-1",
						name: "Sunday",
						isActive: true,
						rules: [
							{
								id: "rule-1",
								name: "Sunday 50%",
								ruleType: "day_of_week",
								percentage: "0.5000",
								dayOfWeek: "sunday",
								priority: 1,
								isActive: true,
							},
						],
					},
				}
			: options.model;
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
						teamId: null,
					},
				]),
			},
			surchargeModelAssignment: {
				findFirst: vi.fn((query) => {
					assignmentWhere.push(query.where);
					return Promise.resolve(assignment);
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
				return Promise.resolve();
			}),
		})),
		insert: vi.fn(() => ({
			values: vi.fn((values) => {
				inserts.push(values);
				return Promise.resolve();
			}),
		})),
	};
	return {
		db: {
			transaction: vi.fn(async (run) => run(tx)),
		},
		tx,
		deletes,
		inserts,
		assignmentWhere,
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
		const assignmentQueries = fake.assignmentWhere.map((where) =>
			dialect.sqlToQuery(where as SQL),
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
