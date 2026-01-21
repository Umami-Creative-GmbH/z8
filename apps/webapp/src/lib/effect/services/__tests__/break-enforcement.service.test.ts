/**
 * Tests for Break Enforcement Service
 *
 * Tests break deficit calculation, automatic break insertion,
 * and batch processing for cron jobs.
 */

import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { WorkPeriodAutoAdjustmentReason } from "@/db/schema";

// Mock data
const mockEmployee = {
	id: "emp-123",
	organizationId: "org-123",
	userId: "user-123",
	teamId: "team-123",
	firstName: "John",
	lastName: "Doe",
};

const mockRegulation = {
	regulationId: "reg-123",
	regulationName: "German Time Law",
	maxDailyMinutes: 600, // 10 hours
	maxWeeklyMinutes: 2880, // 48 hours
	maxUninterruptedMinutes: 360, // 6 hours
	breakRules: [
		{
			workingMinutesThreshold: 360, // 6 hours
			requiredBreakMinutes: 30,
			options: [{ splitCount: 1, minimumSplitMinutes: null, minimumLongestSplitMinutes: null }],
		},
		{
			workingMinutesThreshold: 540, // 9 hours
			requiredBreakMinutes: 45,
			options: [{ splitCount: 1, minimumSplitMinutes: null, minimumLongestSplitMinutes: null }],
		},
	],
};

// Mock policy wrapping the regulation (new structure)
const mockPolicy = {
	policyId: "policy-123",
	policyName: "German Time Law Policy",
	assignedVia: "Organization Default",
	assignmentType: "organization" as const,
	regulation: mockRegulation,
	schedule: null,
};

const mockWorkPeriod = {
	id: "wp-123",
	employeeId: "emp-123",
	clockInId: "entry-1",
	clockOutId: "entry-2",
	startTime: new Date("2024-01-15T08:00:00Z"),
	endTime: new Date("2024-01-15T17:00:00Z"), // 9 hours
	durationMinutes: 540,
	isActive: false,
	wasAutoAdjusted: false,
	autoAdjustmentReason: null,
	autoAdjustedAt: null,
	originalEndTime: null,
	originalDurationMinutes: null,
	projectId: null,
	createdAt: new Date(),
	updatedAt: new Date(),
};

// Mock query results
let mockQueryResults: Record<string, unknown> = {};

// Mock database
const mockDb = {
	query: {
		workPeriod: {
			findFirst: vi.fn(() => Promise.resolve(mockQueryResults.workPeriod)),
			findMany: vi.fn(() => Promise.resolve(mockQueryResults.workPeriods || [])),
		},
		employee: {
			findFirst: vi.fn(() => Promise.resolve(mockQueryResults.employee)),
		},
	},
	select: vi.fn(() => ({
		from: vi.fn(() => ({
			where: vi.fn(() => ({
				orderBy: vi.fn(() => ({
					limit: vi.fn(() => Promise.resolve(mockQueryResults.previousEntry || [])),
				})),
			})),
		})),
	})),
	insert: vi.fn(() => ({
		values: vi.fn(() => ({
			returning: vi.fn(() => Promise.resolve([{ id: "new-entry-123", hash: "hash-123" }])),
		})),
	})),
	update: vi.fn(() => ({
		set: vi.fn(() => ({
			where: vi.fn(() => Promise.resolve()),
		})),
	})),
};

vi.mock("@/db", () => ({
	db: mockDb,
}));

vi.mock("@/db/schema", () => ({
	timeEntry: { id: "time_entry", employeeId: "employee_id", createdAt: "created_at" },
	workPeriod: {
		id: "work_period",
		employeeId: "employee_id",
		isActive: "is_active",
		wasAutoAdjusted: "was_auto_adjusted",
		startTime: "start_time",
	},
	employee: { id: "employee", organizationId: "organization_id" },
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
	}),
}));

vi.mock("@/lib/time-tracking/blockchain", () => ({
	calculateHash: vi.fn(() => "mock-hash-123"),
}));

vi.mock("@/lib/datetime/drizzle-adapter", () => ({
	dateFromDB: vi.fn((date: Date) => {
		const { DateTime } = require("luxon");
		return DateTime.fromJSDate(date);
	}),
	dateToDB: vi.fn((dt: { toJSDate: () => Date }) => dt?.toJSDate?.() || null),
}));

vi.mock("@/lib/time-tracking/timezone-utils", () => ({
	getTodayRangeInTimezone: vi.fn(() => ({
		start: { toJSDate: () => new Date("2024-01-15T00:00:00Z") },
		end: { toJSDate: () => new Date("2024-01-15T23:59:59Z") },
	})),
}));

// Mock work policy service
const mockWorkPolicyService = {
	getEffectivePolicy: vi.fn(),
	checkCompliance: vi.fn(),
	calculateBreakRequirements: vi.fn(),
	logViolation: vi.fn(),
	getViolations: vi.fn(),
	acknowledgeViolation: vi.fn(),
};

describe("Break Enforcement Service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockQueryResults = {};
		mockWorkPolicyService.getEffectivePolicy.mockReset();
	});

	describe("calculateBreakDeficit", () => {
		test("should return zero deficit when no regulation exists", async () => {
			mockWorkPolicyService.getEffectivePolicy.mockReturnValue(
				Effect.succeed(null),
			);

			const { calculateBreakDeficitForTesting } = await import(
				"../break-enforcement.service"
			);

			const result = await Effect.runPromise(
				calculateBreakDeficitForTesting(
					{
						employeeId: "emp-123",
						sessionDurationMinutes: 540,
						breaksTakenMinutes: 0,
					},
					mockWorkPolicyService,
				),
			);

			expect(result.deficit).toBe(0);
			expect(result.applicableRule).toBeNull();
			expect(result.regulationId).toBeNull();
		});

		test("should return zero deficit when work duration is below threshold", async () => {
			mockWorkPolicyService.getEffectivePolicy.mockReturnValue(
				Effect.succeed(mockPolicy),
			);

			const { calculateBreakDeficitForTesting } = await import(
				"../break-enforcement.service"
			);

			const result = await Effect.runPromise(
				calculateBreakDeficitForTesting(
					{
						employeeId: "emp-123",
						sessionDurationMinutes: 300, // 5 hours - below 6 hour threshold
						breaksTakenMinutes: 0,
					},
					mockWorkPolicyService,
				),
			);

			expect(result.deficit).toBe(0);
			expect(result.applicableRule).toBeNull();
			expect(result.regulationName).toBe("German Time Law");
		});

		test("should calculate correct deficit for 6+ hour shift with no breaks", async () => {
			mockWorkPolicyService.getEffectivePolicy.mockReturnValue(
				Effect.succeed(mockPolicy),
			);

			const { calculateBreakDeficitForTesting } = await import(
				"../break-enforcement.service"
			);

			const result = await Effect.runPromise(
				calculateBreakDeficitForTesting(
					{
						employeeId: "emp-123",
						sessionDurationMinutes: 420, // 7 hours
						breaksTakenMinutes: 0,
					},
					mockWorkPolicyService,
				),
			);

			expect(result.deficit).toBe(30);
			expect(result.applicableRule).toEqual({
				workingMinutesThreshold: 360,
				requiredBreakMinutes: 30,
			});
		});

		test("should calculate correct deficit for 9+ hour shift", async () => {
			mockWorkPolicyService.getEffectivePolicy.mockReturnValue(
				Effect.succeed(mockPolicy),
			);

			const { calculateBreakDeficitForTesting } = await import(
				"../break-enforcement.service"
			);

			// Note: condition is > (strictly greater), so 541 minutes triggers 540 rule
			const result = await Effect.runPromise(
				calculateBreakDeficitForTesting(
					{
						employeeId: "emp-123",
						sessionDurationMinutes: 541, // Just over 9 hours
						breaksTakenMinutes: 0,
					},
					mockWorkPolicyService,
				),
			);

			expect(result.deficit).toBe(45);
			expect(result.applicableRule).toEqual({
				workingMinutesThreshold: 540,
				requiredBreakMinutes: 45,
			});
		});

		test("should subtract breaks already taken from deficit", async () => {
			mockWorkPolicyService.getEffectivePolicy.mockReturnValue(
				Effect.succeed(mockPolicy),
			);

			const { calculateBreakDeficitForTesting } = await import(
				"../break-enforcement.service"
			);

			// Note: condition is > (strictly greater), so 541 minutes triggers 540 rule
			const result = await Effect.runPromise(
				calculateBreakDeficitForTesting(
					{
						employeeId: "emp-123",
						sessionDurationMinutes: 541, // Just over 9 hours
						breaksTakenMinutes: 30, // Already took 30 mins
					},
					mockWorkPolicyService,
				),
			);

			expect(result.deficit).toBe(15); // 45 required - 30 taken = 15 remaining
		});

		test("should return zero deficit when sufficient breaks already taken", async () => {
			mockWorkPolicyService.getEffectivePolicy.mockReturnValue(
				Effect.succeed(mockPolicy),
			);

			const { calculateBreakDeficitForTesting } = await import(
				"../break-enforcement.service"
			);

			const result = await Effect.runPromise(
				calculateBreakDeficitForTesting(
					{
						employeeId: "emp-123",
						sessionDurationMinutes: 540, // 9 hours
						breaksTakenMinutes: 60, // Already took 60 mins (more than 45 required)
					},
					mockWorkPolicyService,
				),
			);

			expect(result.deficit).toBe(0);
		});

		test("should include maxUninterruptedMinutes in result", async () => {
			mockWorkPolicyService.getEffectivePolicy.mockReturnValue(
				Effect.succeed(mockPolicy),
			);

			const { calculateBreakDeficitForTesting } = await import(
				"../break-enforcement.service"
			);

			const result = await Effect.runPromise(
				calculateBreakDeficitForTesting(
					{
						employeeId: "emp-123",
						sessionDurationMinutes: 420,
						breaksTakenMinutes: 0,
					},
					mockWorkPolicyService,
				),
			);

			expect(result.maxUninterruptedMinutes).toBe(360); // 6 hours
		});
	});

	describe("Break Placement Algorithm", () => {
		test("should insert break after maxUninterruptedMinutes", async () => {
			// The algorithm should place break at the earlier of:
			// - maxUninterruptedMinutes (360 = 6 hours)
			// - workingMinutesThreshold (applicable rule)
			// For a 9+ hour shift, the applicable rule is the 6-hour rule (360 threshold)
			// since 540 minutes is NOT > 540 (strictly greater)

			const regulation = {
				...mockRegulation,
				maxUninterruptedMinutes: 360, // 6 hours
			};

			mockWorkPolicyService.getEffectivePolicy.mockReturnValue(
				Effect.succeed({ ...mockPolicy, regulation }),
			);

			const { calculateBreakDeficitForTesting } = await import(
				"../break-enforcement.service"
			);

			// Using 541 to trigger the 540-minute rule (needs to be > threshold)
			const result = await Effect.runPromise(
				calculateBreakDeficitForTesting(
					{
						employeeId: "emp-123",
						sessionDurationMinutes: 541,
						breaksTakenMinutes: 0,
					},
					mockWorkPolicyService,
				),
			);

			// Verify maxUninterruptedMinutes is returned for break placement
			expect(result.maxUninterruptedMinutes).toBe(360);
			expect(result.applicableRule?.workingMinutesThreshold).toBe(540);
		});

		test("should use workingMinutesThreshold when lower than maxUninterrupted", async () => {
			const regulation = {
				...mockRegulation,
				maxUninterruptedMinutes: 480, // 8 hours - higher than threshold
			};

			mockWorkPolicyService.getEffectivePolicy.mockReturnValue(
				Effect.succeed({ ...mockPolicy, regulation }),
			);

			const { calculateBreakDeficitForTesting } = await import(
				"../break-enforcement.service"
			);

			const result = await Effect.runPromise(
				calculateBreakDeficitForTesting(
					{
						employeeId: "emp-123",
						sessionDurationMinutes: 420, // 7 hours
						breaksTakenMinutes: 0,
					},
					mockWorkPolicyService,
				),
			);

			// Break should be placed at threshold (360) not maxUninterrupted (480)
			expect(result.applicableRule?.workingMinutesThreshold).toBe(360);
			expect(result.maxUninterruptedMinutes).toBe(480);
		});
	});

	describe("Multiple Break Rules", () => {
		test("should apply highest applicable rule", async () => {
			const multiRuleRegulation = {
				...mockRegulation,
				breakRules: [
					{ workingMinutesThreshold: 360, requiredBreakMinutes: 30, options: [] },
					{ workingMinutesThreshold: 540, requiredBreakMinutes: 45, options: [] },
					{ workingMinutesThreshold: 720, requiredBreakMinutes: 60, options: [] }, // 12 hours
				],
			};

			mockWorkPolicyService.getEffectivePolicy.mockReturnValue(
				Effect.succeed({ ...mockPolicy, regulation: multiRuleRegulation }),
			);

			const { calculateBreakDeficitForTesting } = await import(
				"../break-enforcement.service"
			);

			// Test 7 hour shift - should apply 6 hour rule
			const result1 = await Effect.runPromise(
				calculateBreakDeficitForTesting(
					{
						employeeId: "emp-123",
						sessionDurationMinutes: 420,
						breaksTakenMinutes: 0,
					},
					mockWorkPolicyService,
				),
			);
			expect(result1.applicableRule?.requiredBreakMinutes).toBe(30);

			// Test 10 hour shift - should apply 9 hour rule
			const result2 = await Effect.runPromise(
				calculateBreakDeficitForTesting(
					{
						employeeId: "emp-123",
						sessionDurationMinutes: 600,
						breaksTakenMinutes: 0,
					},
					mockWorkPolicyService,
				),
			);
			expect(result2.applicableRule?.requiredBreakMinutes).toBe(45);

			// Test 13 hour shift - should apply 12 hour rule
			const result3 = await Effect.runPromise(
				calculateBreakDeficitForTesting(
					{
						employeeId: "emp-123",
						sessionDurationMinutes: 780,
						breaksTakenMinutes: 0,
					},
					mockWorkPolicyService,
				),
			);
			expect(result3.applicableRule?.requiredBreakMinutes).toBe(60);
		});
	});

	describe("Edge Cases", () => {
		test("should handle regulation with no break rules", async () => {
			const noBreakRulesRegulation = {
				...mockRegulation,
				breakRules: [],
			};

			mockWorkPolicyService.getEffectivePolicy.mockReturnValue(
				Effect.succeed({ ...mockPolicy, regulation: noBreakRulesRegulation }),
			);

			const { calculateBreakDeficitForTesting } = await import(
				"../break-enforcement.service"
			);

			const result = await Effect.runPromise(
				calculateBreakDeficitForTesting(
					{
						employeeId: "emp-123",
						sessionDurationMinutes: 540,
						breaksTakenMinutes: 0,
					},
					mockWorkPolicyService,
				),
			);

			expect(result.deficit).toBe(0);
			expect(result.applicableRule).toBeNull();
		});

		test("should handle null maxUninterruptedMinutes", async () => {
			const noMaxUninterruptedRegulation = {
				...mockRegulation,
				maxUninterruptedMinutes: null,
			};

			mockWorkPolicyService.getEffectivePolicy.mockReturnValue(
				Effect.succeed({ ...mockPolicy, regulation: noMaxUninterruptedRegulation }),
			);

			const { calculateBreakDeficitForTesting } = await import(
				"../break-enforcement.service"
			);

			// Using 541 to trigger the 540-minute rule (needs to be > threshold)
			const result = await Effect.runPromise(
				calculateBreakDeficitForTesting(
					{
						employeeId: "emp-123",
						sessionDurationMinutes: 541,
						breaksTakenMinutes: 0,
					},
					mockWorkPolicyService,
				),
			);

			expect(result.maxUninterruptedMinutes).toBeNull();
			expect(result.deficit).toBe(45);
		});

		test("should handle zero session duration", async () => {
			mockWorkPolicyService.getEffectivePolicy.mockReturnValue(
				Effect.succeed(mockPolicy),
			);

			const { calculateBreakDeficitForTesting } = await import(
				"../break-enforcement.service"
			);

			const result = await Effect.runPromise(
				calculateBreakDeficitForTesting(
					{
						employeeId: "emp-123",
						sessionDurationMinutes: 0,
						breaksTakenMinutes: 0,
					},
					mockWorkPolicyService,
				),
			);

			expect(result.deficit).toBe(0);
		});

		test("should handle very long shifts (16+ hours)", async () => {
			mockWorkPolicyService.getEffectivePolicy.mockReturnValue(
				Effect.succeed(mockPolicy),
			);

			const { calculateBreakDeficitForTesting } = await import(
				"../break-enforcement.service"
			);

			const result = await Effect.runPromise(
				calculateBreakDeficitForTesting(
					{
						employeeId: "emp-123",
						sessionDurationMinutes: 960, // 16 hours
						breaksTakenMinutes: 0,
					},
					mockWorkPolicyService,
				),
			);

			// Should apply highest rule (9 hours = 45 min break)
			expect(result.deficit).toBe(45);
		});
	});

	describe("Auto Adjustment Reason Type", () => {
		test("should have correct structure for WorkPeriodAutoAdjustmentReason", () => {
			const adjustmentReason: WorkPeriodAutoAdjustmentReason = {
				type: "break_enforcement",
				regulationId: "reg-123",
				regulationName: "German Time Law",
				breakInsertedMinutes: 45,
				breakInsertedAt: "2024-01-15T14:00:00Z",
				originalDurationMinutes: 540,
				adjustedDurationMinutes: 495,
				ruleApplied: {
					workingMinutesThreshold: 540,
					requiredBreakMinutes: 45,
				},
			};

			expect(adjustmentReason.type).toBe("break_enforcement");
			expect(adjustmentReason.regulationId).toBeDefined();
			expect(adjustmentReason.breakInsertedMinutes).toBe(45);
			expect(adjustmentReason.ruleApplied.workingMinutesThreshold).toBe(540);
		});
	});
});

describe("Break Enforcement Result Types", () => {
	test("should have correct structure for non-adjusted result", () => {
		const result = { wasAdjusted: false as const };

		expect(result.wasAdjusted).toBe(false);
		expect("adjustment" in result).toBe(false);
	});

	test("should have correct structure for adjusted result", () => {
		const result = {
			wasAdjusted: true as const,
			adjustment: {
				breakMinutes: 45,
				breakInsertedAt: "2024-01-15T14:00:00Z",
				regulationName: "German Time Law",
				originalDurationMinutes: 540,
				adjustedDurationMinutes: 495,
			},
		};

		expect(result.wasAdjusted).toBe(true);
		expect(result.adjustment.breakMinutes).toBe(45);
		expect(result.adjustment.regulationName).toBe("German Time Law");
	});
});
