/**
 * #1575, Organization ADR 0010: an employee's primary team is always one of their team
 * memberships. Changing the Team field moves the employee; clearing it ends that membership.
 */
import { describe, expect, it } from "vitest";
import { planPrimaryTeamChange } from "./primary-team";

const A = "a0000000-0000-4000-8000-000000000001";
const B = "b0000000-0000-4000-8000-000000000002";
const C = "c0000000-0000-4000-8000-000000000003";

describe("planPrimaryTeamChange", () => {
	it("moves from A to B: B becomes a membership and primary, A ends, others stay", () => {
		expect(
			planPrimaryTeamChange({ primaryTeamId: A, membershipTeamIds: [A, C], nextTeamId: B }),
		).toEqual({ addTeamId: B, endTeamId: A, primaryTeamId: B });
	});

	it("moves into a team the employee is already a member of without adding it again", () => {
		expect(
			planPrimaryTeamChange({ primaryTeamId: A, membershipTeamIds: [A, B], nextTeamId: B }),
		).toEqual({ addTeamId: null, endTeamId: A, primaryTeamId: B });
	});

	it("gives an employee without a team their first team", () => {
		expect(
			planPrimaryTeamChange({ primaryTeamId: null, membershipTeamIds: [], nextTeamId: B }),
		).toEqual({ addTeamId: B, endTeamId: null, primaryTeamId: B });
	});

	it("keeps an unchanged team and adds its missing membership", () => {
		expect(
			planPrimaryTeamChange({ primaryTeamId: A, membershipTeamIds: [], nextTeamId: A }),
		).toEqual({ addTeamId: A, endTeamId: null, primaryTeamId: A });
		expect(
			planPrimaryTeamChange({ primaryTeamId: A, membershipTeamIds: [A], nextTeamId: A }),
		).toEqual({ addTeamId: null, endTeamId: null, primaryTeamId: A });
	});

	it("clearing ends the primary membership and makes the next remaining membership primary", () => {
		expect(
			planPrimaryTeamChange({ primaryTeamId: A, membershipTeamIds: [C, A, B], nextTeamId: null }),
		).toEqual({ addTeamId: null, endTeamId: A, primaryTeamId: B });
	});

	it("clearing the last membership leaves no primary team", () => {
		expect(
			planPrimaryTeamChange({ primaryTeamId: A, membershipTeamIds: [A], nextTeamId: null }),
		).toEqual({ addTeamId: null, endTeamId: A, primaryTeamId: null });
	});

	it("clearing without a primary team still gives remaining memberships a primary team", () => {
		expect(
			planPrimaryTeamChange({ primaryTeamId: null, membershipTeamIds: [C, B], nextTeamId: null }),
		).toEqual({ addTeamId: null, endTeamId: null, primaryTeamId: B });
		expect(
			planPrimaryTeamChange({ primaryTeamId: null, membershipTeamIds: [], nextTeamId: null }),
		).toEqual({ addTeamId: null, endTeamId: null, primaryTeamId: null });
	});
});
