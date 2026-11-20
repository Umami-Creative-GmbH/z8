import { describe, expect, it } from "vitest";
import {
	coverageRows,
	formatCoverageInstant,
	type MemberCoverage,
	matchesCoverageFilter,
	matchesCoverageSearch,
	memberCoverageStatus,
	type OrganizationMfaCoverage,
	summarizeCoverage,
} from "./coverage-model";

function person(overrides: Partial<MemberCoverage>): MemberCoverage {
	return {
		userId: overrides.name ?? "user",
		name: "Member",
		email: null,
		isAdministrator: false,
		kioskOnly: false,
		methods: [],
		deadline: null,
		enforced: false,
		lastQualifyingAccessAt: null,
		...overrides,
	};
}

describe("memberCoverageStatus", () => {
	it("keeps kiosk accounts outside scope even when the policy is on", () => {
		expect(memberCoverageStatus(person({ kioskOnly: true, enforced: true }), true)).toBe("outside");
	});

	it("treats an enrolled method as enrolled regardless of enforcement", () => {
		expect(memberCoverageStatus(person({ methods: ["totp"], enforced: true }), true)).toBe(
			"enrolled",
		);
	});

	it("does not report anyone as blocked while the policy is off", () => {
		expect(
			memberCoverageStatus(person({ enforced: false, deadline: "2026-11-01T00:00:00Z" }), false),
		).toBe("unenrolled");
	});

	it("separates members blocked now from members still inside their window", () => {
		expect(memberCoverageStatus(person({ enforced: true }), true)).toBe("blocked");
		expect(memberCoverageStatus(person({ deadline: "2026-12-01T00:00:00Z" }), true)).toBe("due");
		expect(memberCoverageStatus(person({}), true)).toBe("unenrolled");
	});
});

describe("coverageRows and summarizeCoverage", () => {
	const coverage: OrganizationMfaCoverage = {
		enabled: true,
		gracePeriodDays: 14,
		updatedAt: null,
		timezone: "Europe/Berlin",
		members: [
			person({ userId: "a", name: "Ada", methods: ["passkey"], isAdministrator: true }),
			person({ userId: "k", name: "Kiosk", kioskOnly: true }),
			person({ userId: "d2", name: "Dora", deadline: "2026-12-10T00:00:00Z" }),
			person({ userId: "d1", name: "Dan", deadline: "2026-12-01T00:00:00Z" }),
			person({ userId: "b", name: "Bea", enforced: true, isAdministrator: true }),
		],
	};

	it("lists blocked members first, then the earliest deadline", () => {
		expect(coverageRows(coverage).map((row) => row.userId)).toEqual(["b", "d1", "d2", "a", "k"]);
	});

	it("counts only in-scope members towards enrollment progress", () => {
		expect(summarizeCoverage(coverageRows(coverage))).toEqual({
			inScope: 4,
			enrolled: 1,
			blocked: 1,
			due: 2,
			unenrolled: 0,
			outside: 1,
			administrators: 2,
			administratorsEnrolled: 1,
			percentEnrolled: 25,
		});
	});

	it("reports zero progress rather than dividing by zero", () => {
		expect(summarizeCoverage([]).percentEnrolled).toBe(0);
	});
});

describe("filters", () => {
	const rows = coverageRows({
		enabled: true,
		gracePeriodDays: 14,
		updatedAt: null,
		timezone: "UTC",
		members: [
			person({ userId: "a", name: "Ada Lovelace", email: "ada@example.com", methods: ["totp"] }),
			person({ userId: "b", name: "Bea", enforced: true }),
		],
	});

	it("groups members without a method under attention", () => {
		expect(
			rows.filter((row) => matchesCoverageFilter(row, "attention")).map((row) => row.userId),
		).toEqual(["b"]);
	});

	it("searches names and emails case-insensitively", () => {
		expect(
			rows.filter((row) => matchesCoverageSearch(row, " ADA@")).map((row) => row.userId),
		).toEqual(["a"]);
		expect(rows.filter((row) => matchesCoverageSearch(row, "")).length).toBe(2);
	});
});

describe("formatCoverageInstant", () => {
	it("renders in the organization zone, not the viewer's", () => {
		expect(formatCoverageInstant("2026-11-20T23:30:00Z", "Europe/Berlin", "en")).toContain(
			"Nov 21, 2026",
		);
	});

	it("falls back to UTC for an unknown zone", () => {
		expect(formatCoverageInstant("2026-11-20T23:30:00Z", "Not/AZone", "en")).toContain(
			"Nov 20, 2026",
		);
	});
});
