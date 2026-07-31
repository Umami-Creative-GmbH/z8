import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { PolicyClockOutSurchargeSnapshot } from "@/lib/time-tracking/policy-clock-out-surcharge-snapshot";
import {
	evaluateSurchargeSnapshot,
	reconcileSurchargeWorkPeriodsWithDatabase,
} from "./surcharge.service";

const surchargeSnapshot = {
	version: 1,
	evaluatedAt: "2026-07-19T10:00:00Z",
	resolution: {
		kind: "surcharge_model",
		teamId: null,
		assignmentId: "10000000-0000-4000-8000-000000000001",
		assignmentType: "employee",
		assignmentPriority: 2,
		modelId: "20000000-0000-4000-8000-000000000001",
		modelName: "Sunday",
		rules: [
			{
				id: "30000000-0000-4000-8000-000000000001",
				name: "Sunday 50%",
				ruleType: "day_of_week",
				percentage: "0.5000",
				dayOfWeek: "sunday",
				windowStartTime: null,
				windowEndTime: null,
				specificDate: null,
				dateRangeStart: null,
				dateRangeEnd: null,
				priority: 1,
				validFrom: null,
				validUntil: null,
			},
		],
	},
} as const satisfies PolicyClockOutSurchargeSnapshot;

const input = {
	organizationId: "org-1",
	employeeId: "employee-1",
	surchargePeriodIds: ["period-1"],
	staleSurchargePeriodIds: [],
	surchargeSnapshot,
};

describe("calculateSurchargeForWorkPeriod", () => {
	async function loadCalculationPolicy() {
		const surchargeModule = (await import("./surcharge.service")) as Record<
			string,
			unknown
		>;
		const calculationPolicy = surchargeModule.calculateSurchargeForWorkPeriod;
		expect(calculationPolicy).toBeTypeOf("function");
		return calculationPolicy as (
			service: unknown,
			input: unknown,
		) => Effect.Effect<void>;
	}

	it("uses captured disabled evidence without reading a live enabled setting", async () => {
		const isSurchargesEnabled = vi.fn(() => Effect.succeed(true));
		const reconcileWorkPeriods = vi.fn(() => Effect.void);
		const persistSurchargeCalculation = vi.fn(() => Effect.void);
		const calculateSurchargeForWorkPeriod = await loadCalculationPolicy();
		const disabledSnapshot = {
			version: 1 as const,
			evaluatedAt: surchargeSnapshot.evaluatedAt,
			resolution: { kind: "none" as const },
		};

		await Effect.runPromise(
			calculateSurchargeForWorkPeriod(
				{
					isSurchargesEnabled,
					reconcileWorkPeriods,
					persistSurchargeCalculation,
				},
				{
					workPeriodId: "period-1",
					organizationId: "org-1",
					immutableEvidence: {
						employeeId: "employee-1",
						snapshot: disabledSnapshot,
					},
				},
			),
		);

		expect(isSurchargesEnabled).not.toHaveBeenCalled();
		expect(reconcileWorkPeriods).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeId: "employee-1",
			surchargePeriodIds: ["period-1"],
			staleSurchargePeriodIds: [],
			surchargeSnapshot: disabledSnapshot,
		});
		expect(persistSurchargeCalculation).not.toHaveBeenCalled();
	});

	it("uses captured enabled evidence without reading a live disabled setting", async () => {
		const isSurchargesEnabled = vi.fn(() => Effect.succeed(false));
		const reconcileWorkPeriods = vi.fn(() => Effect.void);
		const persistSurchargeCalculation = vi.fn(() => Effect.void);
		const calculateSurchargeForWorkPeriod = await loadCalculationPolicy();

		await Effect.runPromise(
			calculateSurchargeForWorkPeriod(
				{
					isSurchargesEnabled,
					reconcileWorkPeriods,
					persistSurchargeCalculation,
				},
				{
					workPeriodId: "period-1",
					organizationId: "org-1",
					immutableEvidence: {
						employeeId: "employee-1",
						snapshot: surchargeSnapshot,
					},
				},
			),
		);

		expect(isSurchargesEnabled).not.toHaveBeenCalled();
		expect(reconcileWorkPeriods).toHaveBeenCalledOnce();
		expect(persistSurchargeCalculation).not.toHaveBeenCalled();
	});
});

describe("evaluateSurchargeSnapshot", () => {
	const endpoint = (
		instant: string,
		utcOffsetMinutes: number,
		timezone: string,
	) => ({ instant: parseInstant(instant), utcOffsetMinutes, timezone });

	it("preserves minute max-wins behavior with exact same-offset captures", () => {
		const result = evaluateSurchargeSnapshot({
			snapshot: {
				...surchargeSnapshot,
				resolution: {
					...surchargeSnapshot.resolution,
					rules: [
						{
							...surchargeSnapshot.resolution.rules[0],
							id: "30000000-0000-4000-8000-000000000002",
							name: "Night 25%",
							ruleType: "time_window",
							percentage: "0.2500",
							dayOfWeek: null,
							windowStartTime: "22:00",
							windowEndTime: "06:00",
							priority: 2,
						},
						surchargeSnapshot.resolution.rules[0],
					],
				},
			},
			start: endpoint("2026-07-19T22:00:00Z", 0, "UTC"),
			end: endpoint("2026-07-19T23:00:00Z", 0, "UTC"),
		});

		expect(result).toMatchObject({
			baseMinutes: 60,
			qualifyingMinutes: 60,
			surchargeMinutes: 30,
		});
		expect(result.appliedRules).toEqual([
			expect.objectContaining({
				ruleId: surchargeSnapshot.resolution.rules[0].id,
				qualifyingMinutes: 60,
			}),
		]);
	});

	it("uses date ranges and validity instants without native Date arithmetic", () => {
		const result = evaluateSurchargeSnapshot({
			snapshot: {
				...surchargeSnapshot,
				resolution: {
					...surchargeSnapshot.resolution,
					rules: [
						{
							...surchargeSnapshot.resolution.rules[0],
							name: "Summer",
							ruleType: "date_based",
							dayOfWeek: null,
							dateRangeStart: "2026-07-01",
							dateRangeEnd: "2026-07-31",
							validFrom: "2026-07-19T08:30:00Z",
						},
					],
				},
			},
			start: endpoint("2026-07-19T08:00:00Z", 0, "UTC"),
			end: endpoint("2026-07-19T10:00:00Z", 0, "UTC"),
		});

		expect(result).toMatchObject({
			qualifyingMinutes: 90,
			surchargeMinutes: 45,
		});
	});

	it("returns zero evidence for a stored none resolution", () => {
		expect(
			evaluateSurchargeSnapshot({
				snapshot: {
					version: 1,
					evaluatedAt: "2026-07-19T10:00:00Z",
					resolution: { kind: "none" },
				},
				start: endpoint("2026-07-19T08:00:00Z", 0, "UTC"),
				end: endpoint("2026-07-19T10:00:00Z", 0, "UTC"),
			}),
		).toMatchObject({ qualifyingMinutes: 0, surchargeMinutes: 0 });
	});

	it("uses captured opening and closing offsets for a DST change near midnight", () => {
		const result = evaluateSurchargeSnapshot({
			snapshot: {
				...surchargeSnapshot,
				resolution: {
					...surchargeSnapshot.resolution,
					rules: [
						{
							...surchargeSnapshot.resolution.rules[0],
							ruleType: "time_window",
							dayOfWeek: null,
							windowStartTime: "23:00",
							windowEndTime: "01:00",
						},
					],
				},
			},
			start: endpoint("2026-10-24T21:30:00Z", 120, "Europe/Berlin"),
			end: endpoint("2026-10-25T00:30:00Z", 60, "Europe/Berlin"),
		});

		expect(result).toMatchObject({
			baseMinutes: 180,
			qualifyingMinutes: 150,
			surchargeMinutes: 75,
		});
	});

	it("keeps equal time-window boundaries empty", () => {
		const result = evaluateSurchargeSnapshot({
			snapshot: {
				...surchargeSnapshot,
				resolution: {
					...surchargeSnapshot.resolution,
					rules: [
						{
							...surchargeSnapshot.resolution.rules[0],
							ruleType: "time_window",
							dayOfWeek: null,
							windowStartTime: "06:00",
							windowEndTime: "06:00",
						},
					],
				},
			},
			start: endpoint("2026-07-19T06:00:00Z", 0, "UTC"),
			end: endpoint("2026-07-19T07:00:00Z", 0, "UTC"),
		});

		expect(result).toMatchObject({
			baseMinutes: 60,
			qualifyingMinutes: 0,
			surchargeMinutes: 0,
		});
	});

	it("treats normal time-window openings as inclusive and closings as exclusive", () => {
		const result = evaluateSurchargeSnapshot({
			snapshot: {
				...surchargeSnapshot,
				resolution: {
					...surchargeSnapshot.resolution,
					rules: [
						{
							...surchargeSnapshot.resolution.rules[0],
							ruleType: "time_window",
							dayOfWeek: null,
							windowStartTime: "09:00",
							windowEndTime: "10:00",
						},
					],
				},
			},
			start: endpoint("2026-07-19T08:59:00Z", 0, "UTC"),
			end: endpoint("2026-07-19T10:01:00Z", 0, "UTC"),
		});

		expect(result).toMatchObject({
			baseMinutes: 62,
			qualifyingMinutes: 60,
			surchargeMinutes: 30,
		});
	});

	it("uses travel endpoint offsets without inventing an interior transition", () => {
		const result = evaluateSurchargeSnapshot({
			snapshot: {
				...surchargeSnapshot,
				resolution: {
					...surchargeSnapshot.resolution,
					rules: [
						{
							...surchargeSnapshot.resolution.rules[0],
							ruleType: "time_window",
							dayOfWeek: null,
							windowStartTime: "23:00",
							windowEndTime: "01:00",
						},
					],
				},
			},
			start: endpoint("2026-07-19T21:30:00Z", 120, "Europe/Berlin"),
			end: endpoint("2026-07-20T04:30:00Z", -240, "America/New_York"),
		});

		expect(result).toMatchObject({
			baseMinutes: 420,
			qualifyingMinutes: 420,
			surchargeMinutes: 210,
		});
	});

	it.each([
		"day_of_week",
		"date_based",
	] as const)("derives %s local-day boundaries from both travel captures", (ruleType) => {
		const result = evaluateSurchargeSnapshot({
			snapshot: {
				...surchargeSnapshot,
				resolution: {
					...surchargeSnapshot.resolution,
					rules: [
						{
							...surchargeSnapshot.resolution.rules[0],
							ruleType,
							dayOfWeek: ruleType === "day_of_week" ? "sunday" : null,
							specificDate: ruleType === "date_based" ? "2026-07-19" : null,
						},
					],
				},
			},
			start: endpoint("2026-07-19T21:30:00Z", 120, "Europe/Berlin"),
			end: endpoint("2026-07-20T04:30:00Z", -240, "America/New_York"),
		});

		expect(result).toMatchObject({
			baseMinutes: 420,
			qualifyingMinutes: 390,
			surchargeMinutes: 195,
		});
	});

	it("keeps a date range continuous across eastbound travel", () => {
		const result = evaluateSurchargeSnapshot({
			snapshot: {
				...surchargeSnapshot,
				resolution: {
					...surchargeSnapshot.resolution,
					rules: [
						{
							...surchargeSnapshot.resolution.rules[0],
							ruleType: "date_based",
							dayOfWeek: null,
							dateRangeStart: "2026-07-19",
							dateRangeEnd: "2026-07-20",
						},
					],
				},
			},
			start: endpoint("2026-07-19T21:30:00Z", -240, "America/New_York"),
			end: endpoint("2026-07-20T04:30:00Z", 120, "Europe/Berlin"),
		});

		expect(result).toMatchObject({
			baseMinutes: 420,
			qualifyingMinutes: 420,
			surchargeMinutes: 210,
		});
	});

	it("treats validity endpoints as inclusive and adjacent minutes as excluded", () => {
		const result = evaluateSurchargeSnapshot({
			snapshot: {
				...surchargeSnapshot,
				resolution: {
					...surchargeSnapshot.resolution,
					rules: [
						{
							...surchargeSnapshot.resolution.rules[0],
							dayOfWeek: "monday",
							validFrom: "2026-07-20T10:01:00Z",
							validUntil: "2026-07-20T10:02:00Z",
						},
					],
				},
			},
			start: endpoint("2026-07-20T10:00:00Z", 0, "UTC"),
			end: endpoint("2026-07-20T10:04:00Z", 0, "UTC"),
		});

		expect(result).toMatchObject({
			qualifyingMinutes: 2,
			surchargeMinutes: 1,
		});
	});

	it("uses maximum percentage, then snapshot priority order for equal overlaps", () => {
		const baseRule = surchargeSnapshot.resolution.rules[0];
		const result = evaluateSurchargeSnapshot({
			snapshot: {
				...surchargeSnapshot,
				resolution: {
					...surchargeSnapshot.resolution,
					rules: [
						{
							...baseRule,
							id: "30000000-0000-4000-8000-000000000002",
							name: "Higher priority 50%",
							priority: 3,
						},
						{
							...baseRule,
							id: "30000000-0000-4000-8000-000000000003",
							name: "Lower priority 50%",
							priority: 2,
						},
						{
							...baseRule,
							id: "30000000-0000-4000-8000-000000000004",
							name: "Lower percentage",
							percentage: "0.2500",
							priority: 1,
						},
					],
				},
			},
			start: endpoint("2026-07-19T10:00:00Z", 0, "UTC"),
			end: endpoint("2026-07-19T10:03:00Z", 0, "UTC"),
		});

		expect(result.surchargeMinutes).toBe(2);
		expect(result.appliedRules).toEqual([
			expect.objectContaining({
				ruleId: "30000000-0000-4000-8000-000000000002",
				qualifyingMinutes: 3,
				surchargeMinutes: 2,
			}),
		]);
	});

	it.each([
		{ utcOffsetMinutes: 841, timezone: "UTC" },
		{ utcOffsetMinutes: 0, timezone: "not/a-zone" },
	])("rejects malformed endpoint capture %#", (capture) => {
		expect(() =>
			evaluateSurchargeSnapshot({
				snapshot: surchargeSnapshot,
				start: {
					instant: parseInstant("2026-07-19T08:00:00Z"),
					...capture,
				},
				end: endpoint("2026-07-19T10:00:00Z", 0, "UTC"),
			}),
		).toThrow("Surcharge endpoint capture is invalid");
	});
});

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
	failOnInsert?: number;
}) {
	const deletes: unknown[] = [];
	const inserts: unknown[] = [];
	const assignmentQueries: Array<Record<string, unknown>> = [];
	const calculations: Array<Record<string, unknown>> = [{ id: "stale" }];
	let insertCount = 0;
	const period = {
		id: "period-1",
		organizationId: "org-1",
		employeeId: "employee-1",
		startTime: new Date("2026-07-19T08:00:00Z"),
		endTime: new Date("2026-07-19T10:00:00Z"),
		approvalStatus: "approved",
		clockIn: {
			timestamp: new Date("2026-07-19T08:00:00Z"),
			timezone: "UTC",
			utcOffsetMinutes: 0,
		},
		clockOut: {
			timestamp: new Date("2026-07-19T10:00:00Z"),
			timezone: "UTC",
			utcOffsetMinutes: 0,
		},
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
				insertCount += 1;
				if (insertCount === options?.failOnInsert) {
					return Promise.reject(new Error("surcharge insert failed"));
				}
				const rows = Array.isArray(values) ? values : [values];
				inserts.push(...rows);
				calculations.push(...rows);
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

	it("evaluates only stored evidence without assignment or organization configuration reads", async () => {
		const fake = database();
		await reconcileSurchargeWorkPeriodsWithDatabase(fake.db as never, input);

		expect(
			fake.tx.query.surchargeModelAssignment.findMany,
		).not.toHaveBeenCalled();
		expect(fake.tx.query.organization.findFirst).not.toHaveBeenCalled();
	});

	it("matches direct evaluator output for immediate no-approval reconciliation", async () => {
		const travelSnapshot = {
			...surchargeSnapshot,
			resolution: {
				...surchargeSnapshot.resolution,
				rules: [
					{
						...surchargeSnapshot.resolution.rules[0],
						ruleType: "time_window" as const,
						dayOfWeek: null,
						windowStartTime: "23:00",
						windowEndTime: "01:00",
					},
				],
			},
		};
		const period = {
			id: "period-1",
			organizationId: "org-1",
			employeeId: "employee-1",
			startTime: new Date("2026-07-19T21:30:00Z"),
			endTime: new Date("2026-07-20T04:30:00Z"),
			approvalStatus: "approved",
			clockIn: {
				timestamp: new Date("2026-07-19T21:30:00Z"),
				timezone: "Europe/Berlin",
				utcOffsetMinutes: 120,
			},
			clockOut: {
				timestamp: new Date("2026-07-20T04:30:00Z"),
				timezone: "America/New_York",
				utcOffsetMinutes: -240,
			},
		};
		const expected = evaluateSurchargeSnapshot({
			snapshot: travelSnapshot,
			start: {
				instant: parseInstant("2026-07-19T21:30:00Z"),
				utcOffsetMinutes: 120,
				timezone: "Europe/Berlin",
			},
			end: {
				instant: parseInstant("2026-07-20T04:30:00Z"),
				utcOffsetMinutes: -240,
				timezone: "America/New_York",
			},
		});
		const fake = database({ periods: [period] });

		await reconcileSurchargeWorkPeriodsWithDatabase(fake.db as never, {
			...input,
			surchargeSnapshot: travelSnapshot,
		});

		expect(fake.inserts).toEqual([
			expect.objectContaining({
				baseMinutes: expected.baseMinutes,
				qualifyingMinutes: expected.qualifyingMinutes,
				surchargeMinutes: expected.surchargeMinutes,
			}),
		]);
	});

	it("uses stored synthetic split endpoint captures for each final segment", async () => {
		const splitSnapshot = {
			...surchargeSnapshot,
			resolution: {
				...surchargeSnapshot.resolution,
				rules: [
					{
						...surchargeSnapshot.resolution.rules[0],
						ruleType: "time_window" as const,
						dayOfWeek: null,
						windowStartTime: "23:00",
						windowEndTime: "01:00",
					},
				],
			},
		};
		const periods = [
			{
				id: "period-1",
				organizationId: "org-1",
				employeeId: "employee-1",
				startTime: new Date("2026-10-24T21:30:00Z"),
				endTime: new Date("2026-10-24T23:00:00Z"),
				approvalStatus: "approved",
				clockIn: {
					timestamp: new Date("2026-10-24T21:30:00Z"),
					timezone: "Europe/Berlin",
					utcOffsetMinutes: 120,
				},
				clockOut: {
					timestamp: new Date("2026-10-24T23:00:00Z"),
					timezone: "Europe/Berlin",
					utcOffsetMinutes: 120,
				},
			},
			{
				id: "period-2",
				organizationId: "org-1",
				employeeId: "employee-1",
				startTime: new Date("2026-10-24T23:30:00Z"),
				endTime: new Date("2026-10-25T00:30:00Z"),
				approvalStatus: "approved",
				clockIn: {
					timestamp: new Date("2026-10-24T23:30:00Z"),
					timezone: "Europe/Berlin",
					utcOffsetMinutes: 60,
				},
				clockOut: {
					timestamp: new Date("2026-10-25T00:30:00Z"),
					timezone: "Europe/Berlin",
					utcOffsetMinutes: 60,
				},
			},
		];
		const fake = database({ periods });

		await reconcileSurchargeWorkPeriodsWithDatabase(fake.db as never, {
			...input,
			surchargePeriodIds: ["period-1", "period-2"],
			surchargeSnapshot: splitSnapshot,
		});

		expect(fake.inserts).toEqual([
			expect.objectContaining({
				workPeriodId: "period-1",
				qualifyingMinutes: 90,
				surchargeMinutes: 45,
			}),
			expect.objectContaining({
				workPeriodId: "period-2",
				qualifyingMinutes: 30,
				surchargeMinutes: 15,
			}),
		]);
		expect(fake.tx.insert).toHaveBeenCalledOnce();
	});

	it("rolls back both split calculations when the batch insert fails", async () => {
		const periods = [
			{
				id: "period-1",
				organizationId: "org-1",
				employeeId: "employee-1",
				startTime: new Date("2026-07-19T08:00:00Z"),
				endTime: new Date("2026-07-19T09:00:00Z"),
				approvalStatus: "approved",
				clockIn: {
					timestamp: new Date("2026-07-19T08:00:00Z"),
					timezone: "UTC",
					utcOffsetMinutes: 0,
				},
				clockOut: {
					timestamp: new Date("2026-07-19T09:00:00Z"),
					timezone: "UTC",
					utcOffsetMinutes: 0,
				},
			},
			{
				id: "period-2",
				organizationId: "org-1",
				employeeId: "employee-1",
				startTime: new Date("2026-07-19T09:30:00Z"),
				endTime: new Date("2026-07-19T10:30:00Z"),
				approvalStatus: "approved",
				clockIn: {
					timestamp: new Date("2026-07-19T09:30:00Z"),
					timezone: "UTC",
					utcOffsetMinutes: 0,
				},
				clockOut: {
					timestamp: new Date("2026-07-19T10:30:00Z"),
					timezone: "UTC",
					utcOffsetMinutes: 0,
				},
			},
		];
		const fake = database({ periods, failOnInsert: 1 });

		await expect(
			reconcileSurchargeWorkPeriodsWithDatabase(fake.db as never, {
				...input,
				surchargePeriodIds: ["period-1", "period-2"],
			}),
		).rejects.toThrow("Surcharge reconciliation failed");
		expect(fake.calculations).toEqual([{ id: "stale" }]);
	});

	it("deletes stale calculations and creates none from stored none after a later assignment", async () => {
		const fake = database({ model: assignmentFixture({ modelId: "later" }) });

		await reconcileSurchargeWorkPeriodsWithDatabase(fake.db as never, {
			...input,
			surchargeSnapshot: {
				version: 1,
				evaluatedAt: surchargeSnapshot.evaluatedAt,
				resolution: { kind: "none" },
			},
		});

		expect(fake.tx.delete).toHaveBeenCalledOnce();
		expect(fake.inserts).toEqual([]);
		expect(
			fake.tx.query.surchargeModelAssignment.findMany,
		).not.toHaveBeenCalled();
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

	it("fails closed before delete when one atomic target belongs to another organization", async () => {
		const fake = database({
			periods: [
				{
					id: "period-1",
					organizationId: "org-1",
					employeeId: "employee-1",
				},
			],
		});

		await expect(
			reconcileSurchargeWorkPeriodsWithDatabase(fake.db as never, {
				...input,
				surchargePeriodIds: ["period-1", "foreign-period"],
			}),
		).rejects.toThrow("Surcharge reconciliation failed");
		expect(fake.tx.delete).not.toHaveBeenCalled();
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

	it.each([
		{ clockInTimezone: "not/a-zone", clockInOffset: 0 },
		{ clockInTimezone: "UTC", clockInOffset: 900 },
	])("fails closed before delete for malformed endpoint evidence %#", async (evidence) => {
		const fake = database({
			periods: [
				{
					id: "period-1",
					organizationId: "org-1",
					employeeId: "employee-1",
					startTime: new Date("2026-07-19T08:00:00Z"),
					endTime: new Date("2026-07-19T10:00:00Z"),
					approvalStatus: "approved",
					clockIn: {
						timestamp: new Date("2026-07-19T08:00:00Z"),
						timezone: evidence.clockInTimezone,
						utcOffsetMinutes: evidence.clockInOffset,
					},
					clockOut: {
						timestamp: new Date("2026-07-19T10:00:00Z"),
						timezone: "UTC",
						utcOffsetMinutes: 0,
					},
				},
			],
		});

		await expect(
			reconcileSurchargeWorkPeriodsWithDatabase(fake.db as never, input),
		).rejects.toThrow("Surcharge reconciliation failed");
		expect(fake.tx.delete).not.toHaveBeenCalled();
	});
});
