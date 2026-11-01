import { describe, expect, it } from "vitest";
import { goLiveItemStatus, resolveGoLiveReadiness } from "./readiness";
import type { GoLiveCheckResult, GoLiveFailureGroup, GoLiveMember } from "./types";

const ada: GoLiveMember = {
	kind: "employee",
	employeeId: "emp-ada",
	primaryTeamId: null,
	displayName: "Ada",
};
const bea: GoLiveMember = {
	kind: "employee",
	employeeId: "emp-bea",
	primaryTeamId: "team-1",
	displayName: "Bea",
};

function group(...members: GoLiveMember[]): GoLiveFailureGroup {
	return {
		cause: "test",
		reason: { key: "settings.implementationChecklist.test", fallback: "Test" },
		members: members.map((member) => ({ member })),
		fix: null,
	};
}

function passed(overrides: Partial<GoLiveCheckResult> = {}): GoLiveCheckResult {
	return {
		checkId: "work-policy",
		itemId: "work-policies",
		severity: "mandatory",
		checkedMemberCount: 2,
		outcome: "passed",
		configured: true,
		failures: [],
		warnings: [],
		notes: [],
		...overrides,
	} as GoLiveCheckResult;
}

function failed(
	failures: GoLiveFailureGroup[],
	overrides: Partial<GoLiveCheckResult> = {},
): GoLiveCheckResult {
	return passed({ outcome: "failed", failures, ...overrides } as Partial<GoLiveCheckResult>);
}

function unavailable(overrides: Partial<GoLiveCheckResult> = {}): GoLiveCheckResult {
	return {
		checkId: "work-policy",
		itemId: "work-policies",
		severity: "mandatory",
		checkedMemberCount: 0,
		outcome: "unavailable",
		...overrides,
	} as GoLiveCheckResult;
}

describe("go-live item status", () => {
	it("verifies an item only when its check passed for at least one member", () => {
		expect(goLiveItemStatus(passed())).toBe("verified");
	});

	it("shows configured settings with nobody to check as configured, never verified", () => {
		expect(goLiveItemStatus(passed({ checkedMemberCount: 0 }))).toBe("configured");
	});

	it("needs attention when at least one member fails", () => {
		expect(goLiveItemStatus(failed([group(ada)]))).toBe("needs-attention");
	});

	it("is not set up when nothing is configured, even with failures", () => {
		expect(goLiveItemStatus(failed([group(ada)], { configured: false }))).toBe("not-set-up");
		expect(goLiveItemStatus(passed({ configured: false, checkedMemberCount: 0 }))).toBe(
			"not-set-up",
		);
	});

	it("is unavailable when a lookup failed", () => {
		expect(goLiveItemStatus(unavailable())).toBe("unavailable");
	});
});

describe("go-live readiness", () => {
	it("is ready when every mandatory check passes", () => {
		expect(resolveGoLiveReadiness([passed()])).toEqual({ status: "ready", warnings: [] });
	});

	it("is not ready with the number of distinct affected members", () => {
		const readiness = resolveGoLiveReadiness([
			failed([group(ada), group(ada, bea)]),
			failed([group(bea)], { checkId: "other" }),
		]);

		expect(readiness).toEqual({ status: "not-ready", affectedMemberCount: 2, warnings: [] });
	});

	it("is unavailable when any mandatory check is unavailable, even next to failures", () => {
		expect(
			resolveGoLiveReadiness([failed([group(ada)]), unavailable({ checkId: "other" })]),
		).toEqual({ status: "unavailable" });
	});

	it("never blocks on advisory checks and shows their failures as warnings", () => {
		const advisoryFailure = group(bea);
		const readiness = resolveGoLiveReadiness([
			passed(),
			failed([advisoryFailure], { checkId: "payroll", severity: "advisory" }),
			unavailable({ checkId: "advisory-lookup", severity: "advisory" }),
		]);

		expect(readiness).toEqual({ status: "ready", warnings: [advisoryFailure] });
	});

	it("keeps advisory warnings of passing mandatory checks", () => {
		const warning = group(ada);
		expect(resolveGoLiveReadiness([passed({ warnings: [warning] })])).toEqual({
			status: "ready",
			warnings: [warning],
		});
	});
});
