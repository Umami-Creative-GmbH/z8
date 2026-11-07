import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { type ChangePolicyCandidate, resolveChangePolicy } from "./resolution";

const AT = parseInstant("2026-06-15T10:00:00Z");
const subject = {
	organizationId: "org-1",
	employeeId: "emp-1",
	teamId: "team-1",
};

function candidate(
	level: ChangePolicyCandidate["level"],
	overrides: Partial<ChangePolicyCandidate> = {},
): ChangePolicyCandidate {
	return {
		assignmentId: `${level}-assignment`,
		level,
		organizationId: "org-1",
		employeeId: level === "employee" ? "emp-1" : null,
		teamId: level === "team" ? "team-1" : null,
		assignmentActive: true,
		effectiveFrom: null,
		effectiveUntil: null,
		policyOrganizationId: "org-1",
		policyActive: true,
		...overrides,
	};
}

const resolvedId = (candidates: ChangePolicyCandidate[], who = subject) =>
	resolveChangePolicy(candidates, who, AT)?.assignmentId ?? null;

describe("resolveChangePolicy", () => {
	it("prefers the employee's assignment, then their team's, then the organization's", () => {
		const all = [candidate("organization"), candidate("team"), candidate("employee")];

		expect(resolvedId(all)).toBe("employee-assignment");
		expect(resolvedId(all.filter((row) => row.level !== "employee"))).toBe("team-assignment");
		expect(resolvedId([candidate("organization")])).toBe("organization-assignment");
	});

	it("applies an assignment from its start until its end date, a future end date included", () => {
		const team = (window: Partial<ChangePolicyCandidate>) => [
			candidate("organization"),
			candidate("team", window),
		];

		expect(resolvedId(team({ effectiveFrom: parseInstant("2026-06-15T10:00:00Z") }))).toBe(
			"team-assignment",
		);
		expect(resolvedId(team({ effectiveFrom: parseInstant("2026-06-15T10:00:01Z") }))).toBe(
			"organization-assignment",
		);
		expect(resolvedId(team({ effectiveUntil: parseInstant("2026-12-31T23:00:00Z") }))).toBe(
			"team-assignment",
		);
		expect(resolvedId(team({ effectiveUntil: parseInstant("2026-06-15T10:00:00Z") }))).toBe(
			"organization-assignment",
		);
	});

	it.each([
		["its policy is inactive", { policyActive: false }],
		["the assignment is inactive", { assignmentActive: false }],
		["the assignment belongs to another organization", { organizationId: "org-2" }],
		["its policy belongs to another organization", { policyOrganizationId: "org-2" }],
	] as const)("skips an employee assignment when %s", (_label, overrides) => {
		expect(resolvedId([candidate("team"), candidate("employee", overrides)])).toBe(
			"team-assignment",
		);
	});

	it("matches no employee or team assignment for someone without an employee or team", () => {
		const rows = [
			candidate("organization"),
			candidate("team", { teamId: null }),
			candidate("employee", { employeeId: null }),
		];

		expect(
			resolvedId(rows, {
				organizationId: "org-1",
				employeeId: null,
				teamId: null,
			}),
		).toBe("organization-assignment");
	});

	it("throws when two assignments apply at one level, which the database forbids", () => {
		const rows = [candidate("team"), candidate("team", { assignmentId: "second-team-assignment" })];

		expect(() => resolveChangePolicy(rows, subject, AT)).toThrow(/team/);
	});

	it("does not mind a second assignment that is not in effect", () => {
		const rows = [
			candidate("team"),
			candidate("team", {
				assignmentId: "ended",
				effectiveUntil: parseInstant("2026-01-01T00:00:00Z"),
			}),
		];

		expect(resolvedId(rows)).toBe("team-assignment");
	});

	it("never applies another organization's default", () => {
		expect(
			resolvedId([
				candidate("organization", {
					organizationId: "org-2",
					policyOrganizationId: "org-2",
				}),
			]),
		).toBeNull();
	});
});
