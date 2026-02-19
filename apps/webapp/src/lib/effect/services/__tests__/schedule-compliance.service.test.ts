import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { DatabaseService } from "../database.service";
import {
	ScheduleComplianceService,
	ScheduleComplianceServiceLive,
} from "../schedule-compliance.service";
import { WorkPolicyService } from "../work-policy.service";

describe("ScheduleComplianceService", () => {
	it("evaluateScheduleWindow returns organizationId and fingerprint", async () => {
		const mockDb = {
			query: {
				shift: {
					findMany: vi.fn(async () => [
						{
							employeeId: "emp_1",
							date: new Date("2026-02-19T00:00:00.000Z"),
							startTime: "08:00",
							endTime: "18:00",
						},
						{
							employeeId: null,
							date: new Date("2026-02-19T00:00:00.000Z"),
							startTime: "10:00",
							endTime: "14:00",
						},
					]),
				},
				workPeriod: {
					findMany: vi.fn(async () => [
						{
							employeeId: "emp_1",
							startTime: new Date("2026-02-18T21:00:00.000Z"),
							endTime: new Date("2026-02-19T06:00:00.000Z"),
							durationMinutes: 540,
						},
					]),
				},
			},
			insert: vi.fn(() => ({
				values: vi.fn(async () => undefined),
			})),
		};

		const dbLayer = Layer.succeed(
			DatabaseService,
			DatabaseService.of({
				db: mockDb as never,
				query: (_name, query) => Effect.promise(query) as never,
			}),
		);

		const workPolicyLayer = Layer.succeed(
			WorkPolicyService,
			{
				getEffectivePolicy: vi.fn(() =>
					Effect.succeed({
						policyId: "policy_1",
						policyName: "Default",
						assignmentType: "organization",
						assignedVia: "Organization Default",
						schedule: null,
						regulation: {
							maxDailyMinutes: 480,
							maxWeeklyMinutes: null,
							maxUninterruptedMinutes: null,
							breakRules: [],
							minRestPeriodMinutes: 660,
							restPeriodEnforcement: "warn",
							overtimeDailyThresholdMinutes: 420,
							overtimeWeeklyThresholdMinutes: 2000,
							overtimeMonthlyThresholdMinutes: 8000,
							alertBeforeLimitMinutes: 30,
							alertThresholdPercent: 80,
						},
					}),
				),
			} as never,
		);

		const layer = ScheduleComplianceServiceLive.pipe(
			Layer.provide(workPolicyLayer),
			Layer.provide(dbLayer),
		);

		const result = await Effect.runPromise(
			Effect.gen(function* (_) {
				const service = yield* _(ScheduleComplianceService);
				return yield* _(
					service.evaluateScheduleWindow({
						organizationId: "org_1",
						startDate: new Date("2026-02-17T00:00:00.000Z"),
						endDate: new Date("2026-02-23T23:59:59.999Z"),
						timezone: "Europe/Berlin",
					}),
				);
			}).pipe(Effect.provide(layer)),
		);

		expect(result.organizationId).toBe("org_1");
		expect(typeof result.fingerprint).toBe("string");
		expect(result.fingerprint.length).toBeGreaterThan(0);
	});

	it("recordPublishAcknowledgment inserts acknowledgment row", async () => {
		const insertValues = vi.fn<[Record<string, unknown>], Promise<void>>(async () => undefined);
		const mockDb = {
			query: {
				shift: { findMany: vi.fn(async () => []) },
				workPeriod: { findMany: vi.fn(async () => []) },
			},
			insert: vi.fn(() => ({
				values: insertValues,
			})),
		};

		const dbLayer = Layer.succeed(
			DatabaseService,
			DatabaseService.of({
				db: mockDb as never,
				query: (_name, query) => Effect.promise(query) as never,
			}),
		);

		const workPolicyLayer = Layer.succeed(
			WorkPolicyService,
			{
				getEffectivePolicy: vi.fn(() => Effect.succeed(null)),
			} as never,
		);

		const layer = ScheduleComplianceServiceLive.pipe(
			Layer.provide(workPolicyLayer),
			Layer.provide(dbLayer),
		);

		await Effect.runPromise(
			Effect.gen(function* (_) {
				const service = yield* _(ScheduleComplianceService);
				return yield* _(
					service.recordPublishAcknowledgment({
						organizationId: "org_1",
						actorEmployeeId: "emp_1",
						publishedRangeStart: new Date("2026-02-17T00:00:00.000Z"),
						publishedRangeEnd: new Date("2026-02-23T23:59:59.999Z"),
						warningCountTotal: 2,
						warningCountsByType: { maxHours: 1, restTime: 1 },
						evaluationFingerprint: "fp-123",
					}),
				);
			}).pipe(Effect.provide(layer)),
		);

		expect(mockDb.insert).toHaveBeenCalledTimes(1);
		expect(insertValues).toHaveBeenCalledTimes(1);
		expect(insertValues.mock.calls[0]?.[0]?.organizationId).toBe("org_1");
	});
});
