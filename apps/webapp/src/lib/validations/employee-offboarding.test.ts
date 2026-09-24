import { describe, expect, it } from "vitest";
import {
	assignDepartureReplacementSchema,
	cancelDepartureSchema,
	employeeOffboardingViewSchema,
	offboardNowSchema,
	previewDepartureSchema,
	rehireEmployeeSchema,
	resolveDepartureReviewSchema,
	retryDepartureTaskSchema,
	scheduleDepartureSchema,
} from "./employee-offboarding";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("scheduleDepartureSchema", () => {
	const valid = {
		employeeId: uuid,
		requestId: uuid,
		expectedRevision: null,
		lastWorkingDay: "2026-09-30",
		replacementEmployeeId: null,
		acknowledgeUnassignedDuties: false,
	};

	it("accepts a calendar date without any client cutoff or timezone", () => {
		expect(scheduleDepartureSchema.parse({ ...valid, cutoff: "x", timezone: "y" })).toEqual(valid);
	});

	it.each([
		["a malformed employee id", { employeeId: "nope" }],
		["a non-date last working day", { lastWorkingDay: "30.09.2026" }],
		["an impossible date", { lastWorkingDay: "2026-02-30" }],
		["a zero revision", { expectedRevision: 0 }],
	])("rejects %s", (_label, override) => {
		expect(scheduleDepartureSchema.safeParse({ ...valid, ...override }).success).toBe(false);
	});
});

describe("rehireEmployeeSchema", () => {
	const valid = {
		employeeId: uuid,
		requestId: uuid,
		previousEmploymentPeriodId: uuid,
		role: "employee",
		teamId: null,
		primaryManagerId: null,
		workPolicyId: uuid,
		weeklyContractMinutes: 2400,
		contractType: "fixed",
		workModel: "onsite",
		hourlyRate: null,
		currency: "EUR",
		probationStartsOn: null,
		probationEndsOn: null,
		changeReason: null,
	} as const;

	it("requires an hourly rate for hourly contracts", () => {
		expect(rehireEmployeeSchema.safeParse({ ...valid, contractType: "hourly" }).success).toBe(
			false,
		);
		expect(
			rehireEmployeeSchema.safeParse({ ...valid, contractType: "hourly", hourlyRate: "25.00" })
				.success,
		).toBe(true);
	});

	it("rejects a probation end before its start", () => {
		expect(
			rehireEmployeeSchema.safeParse({
				...valid,
				probationStartsOn: "2026-11-02",
				probationEndsOn: "2026-11-01",
			}).success,
		).toBe(false);
	});

	it("does not accept an owner role or a client-chosen period start", () => {
		expect(rehireEmployeeSchema.safeParse({ ...valid, role: "owner" }).success).toBe(false);
		expect(rehireEmployeeSchema.parse({ ...valid, validFrom: "2026-01-01" })).not.toHaveProperty(
			"validFrom",
		);
	});
});

describe("departure command schemas", () => {
	it("requires a positive expected revision and request ids to cancel", () => {
		const valid = { employeeId: uuid, departureId: uuid, expectedRevision: 2, requestId: uuid };
		expect(cancelDepartureSchema.safeParse(valid).success).toBe(true);
		expect(cancelDepartureSchema.safeParse({ ...valid, expectedRevision: null }).success).toBe(
			false,
		);
		expect(cancelDepartureSchema.safeParse({ ...valid, requestId: "retry-1" }).success).toBe(false);
	});

	it("takes no cutoff for an immediate departure", () => {
		expect(
			offboardNowSchema.parse({
				employeeId: uuid,
				requestId: uuid,
				replacementEmployeeId: null,
				acknowledgeUnassignedDuties: true,
				cutoff: "2026-01-01T00:00:00Z",
			}),
		).toEqual({
			employeeId: uuid,
			requestId: uuid,
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		});
	});
});

describe("follow-up schemas", () => {
	it("scopes the view and preview to one employee and a calendar date", () => {
		expect(employeeOffboardingViewSchema.safeParse({ employeeId: uuid }).success).toBe(true);
		expect(employeeOffboardingViewSchema.safeParse({ employeeId: "1" }).success).toBe(false);
		expect(
			previewDepartureSchema.safeParse({ employeeId: uuid, lastWorkingDay: null }).success,
		).toBe(true);
		expect(
			previewDepartureSchema.safeParse({ employeeId: uuid, lastWorkingDay: "2026-13-01" }).success,
		).toBe(false);
	});

	it("requires a written resolution and trims it", () => {
		expect(
			resolveDepartureReviewSchema.parse({ reviewId: uuid, resolution: "  Checked  " }),
		).toEqual({ reviewId: uuid, resolution: "Checked" });
		expect(
			resolveDepartureReviewSchema.safeParse({ reviewId: uuid, resolution: "   " }).success,
		).toBe(false);
	});

	it("validates retry and replacement identifiers", () => {
		expect(retryDepartureTaskSchema.safeParse({ taskId: uuid }).success).toBe(true);
		expect(retryDepartureTaskSchema.safeParse({ taskId: "x" }).success).toBe(false);
		const replacement = {
			departureId: uuid,
			handoverTaskId: uuid,
			replacementEmployeeId: uuid,
			requestId: uuid,
		};
		expect(assignDepartureReplacementSchema.safeParse(replacement).success).toBe(true);
		expect(
			assignDepartureReplacementSchema.safeParse({ ...replacement, replacementEmployeeId: null })
				.success,
		).toBe(false);
	});
});
