import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	type DepartureFact,
	deriveOffboardingCapabilities,
	deriveOffboardingState,
	publicReviewMetadata,
} from "./queries";

const NOW = parseInstant("2026-09-20T10:00:00Z");

function departure(overrides: Partial<DepartureFact>): DepartureFact {
	return {
		id: "departure-1",
		employmentPeriodId: "period-1",
		mode: "scheduled",
		status: "pending",
		revision: 1,
		lastWorkingDay: "2026-09-30",
		cutoffAt: parseInstant("2026-09-30T22:00:00Z"),
		timezone: "Europe/Berlin",
		replacementEmployeeId: null,
		blockedReason: null,
		effectiveAt: null,
		createdAt: parseInstant("2026-09-01T00:00:00Z"),
		...overrides,
	};
}

describe("deriveOffboardingState", () => {
	it("is active with an open period and no departure", () => {
		expect(
			deriveOffboardingState({
				employeeActive: true,
				openPeriodId: "period-1",
				departures: [],
				now: NOW,
			}),
		).toEqual({ state: "active", departure: null, previousEmploymentPeriodId: null });
	});

	it("is scheduled while a pending cutoff is ahead, offboarded once it passed", () => {
		const pending = departure({});
		expect(
			deriveOffboardingState({
				employeeActive: true,
				openPeriodId: "period-1",
				departures: [pending],
				now: NOW,
			}),
		).toMatchObject({ state: "scheduled", departure: pending });
		expect(
			deriveOffboardingState({
				employeeActive: true,
				openPeriodId: "period-1",
				departures: [pending],
				now: parseInstant("2026-10-01T00:00:00Z"),
			}),
		).toMatchObject({ state: "offboarded", previousEmploymentPeriodId: "period-1" });
	});

	it("is blocked only for a blocked departure of the open period", () => {
		const blocked = departure({ status: "blocked", blockedReason: "final_accessible_owner" });
		expect(
			deriveOffboardingState({
				employeeActive: true,
				openPeriodId: "period-1",
				departures: [blocked],
				now: NOW,
			}),
		).toMatchObject({ state: "blocked", departure: blocked });
	});

	it("is offboarded after an effective departure and active again after rehire", () => {
		const effective = departure({
			status: "effective",
			effectiveAt: parseInstant("2026-09-10T00:00:00Z"),
		});
		expect(
			deriveOffboardingState({
				employeeActive: false,
				openPeriodId: null,
				departures: [effective],
				now: NOW,
			}),
		).toEqual({
			state: "offboarded",
			departure: effective,
			previousEmploymentPeriodId: "period-1",
		});
		expect(
			deriveOffboardingState({
				employeeActive: true,
				openPeriodId: "period-2",
				departures: [effective],
				now: NOW,
			}),
		).toEqual({ state: "active", departure: null, previousEmploymentPeriodId: null });
	});

	it("keeps unknown legacy history without inventing a cutoff", () => {
		expect(
			deriveOffboardingState({
				employeeActive: false,
				openPeriodId: null,
				departures: [],
				now: NOW,
			}),
		).toEqual({ state: "legacy_inactive", departure: null, previousEmploymentPeriodId: null });
	});
});

describe("deriveOffboardingCapabilities", () => {
	const base = {
		viewer: "admin" as const,
		selfTarget: false,
		authority: null,
		hasPreviousPeriod: false,
		followUp: { failed: 0, openReviews: 0 },
	};

	it("offers schedule and immediate departure for an active employee", () => {
		expect(deriveOffboardingCapabilities({ ...base, state: "active" })).toEqual({
			schedule: true,
			cancel: false,
			offboardNow: true,
			rehire: false,
			resolve: false,
		});
	});

	it("offers edit, cancel and immediate departure while scheduled", () => {
		expect(deriveOffboardingCapabilities({ ...base, state: "scheduled" })).toMatchObject({
			schedule: true,
			cancel: true,
			offboardNow: true,
		});
	});

	it("blocks new departures of the final owner but still allows cancelling", () => {
		expect(
			deriveOffboardingCapabilities({
				...base,
				state: "blocked",
				authority: "final_accessible_owner",
			}),
		).toMatchObject({ schedule: false, offboardNow: false, cancel: true });
	});

	it("offers rehire only after an effective departure", () => {
		expect(
			deriveOffboardingCapabilities({ ...base, state: "offboarded", hasPreviousPeriod: true }),
		).toMatchObject({ rehire: true, schedule: false, offboardNow: false });
		expect(deriveOffboardingCapabilities({ ...base, state: "legacy_inactive" }).rehire).toBe(false);
	});

	it("gives managers, self targets and non-owners of an owner a read-only view", () => {
		const none = { schedule: false, cancel: false, offboardNow: false, rehire: false };
		expect(
			deriveOffboardingCapabilities({
				...base,
				viewer: "manager",
				state: "scheduled",
				followUp: { failed: 1, openReviews: 2 },
			}),
		).toEqual({ ...none, resolve: false });
		expect(
			deriveOffboardingCapabilities({ ...base, selfTarget: true, state: "active" }),
		).toMatchObject(none);
		expect(
			deriveOffboardingCapabilities({
				...base,
				authority: "owner_authorization_required",
				state: "active",
			}),
		).toMatchObject(none);
	});

	it("offers resolution to admins while reviews or failed work remain", () => {
		expect(
			deriveOffboardingCapabilities({
				...base,
				state: "offboarded",
				followUp: { failed: 0, openReviews: 1 },
			}).resolve,
		).toBe(true);
	});
});

describe("publicReviewMetadata", () => {
	it("exposes only allow-listed reasons and task references", () => {
		expect(
			publicReviewMetadata({
				reason: "no_replacement",
				handoverTaskId: "10000000-0000-4000-8000-000000000001",
				tokens: ["secret"],
				lastError: "stack trace",
			}),
		).toEqual({
			reason: "no_replacement",
			handoverTaskId: "10000000-0000-4000-8000-000000000001",
		});
		expect(publicReviewMetadata({ reason: "Error: connection refused at 10.0.0.1" })).toEqual({
			reason: null,
			handoverTaskId: null,
		});
		expect(publicReviewMetadata(null)).toEqual({ reason: null, handoverTaskId: null });
	});
});
