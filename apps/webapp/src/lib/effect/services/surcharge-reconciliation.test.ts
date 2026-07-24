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
	const period = {
		id: "period-1",
		organizationId: "org-1",
		employeeId: "employee-1",
		startTime: new Date("2026-07-19T08:00:00Z"),
		endTime: new Date("2026-07-19T10:00:00Z"),
		approvalStatus: "approved",
	};
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
				findFirst: vi.fn().mockResolvedValue(
					options?.model === undefined
						? {
								model: {
									id: "model-1",
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
						: options.model,
				),
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
