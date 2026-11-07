/**
 * #1594, Organization ADR 0010: an employee's primary team is always one of their team
 * memberships. A move changes the primary team; adding and removing memberships keep it
 * among the memberships.
 */
import { describe, expect, it } from "vitest";
import { planTeamChange } from "./plan";

const A = "a0000000-0000-4000-8000-000000000001";
const B = "b0000000-0000-4000-8000-000000000002";
const C = "c0000000-0000-4000-8000-000000000003";

const move = (teamId: string | null) => ({ kind: "move", teamId }) as const;
const add = (teamId: string) => ({ kind: "addMembership", teamId }) as const;
const remove = (teamId: string) =>
	({ kind: "removeMembership", teamId }) as const;

describe("a move", () => {
	it("from A to B: B becomes a membership and primary, A ends, others stay", () => {
		expect(
			planTeamChange({ primaryTeamId: A, membershipTeamIds: [A, C] }, move(B)),
		).toEqual({
			addTeamId: B,
			endTeamId: A,
			primaryTeamId: B,
		});
	});

	it("into a team the employee is already a member of does not add it again", () => {
		expect(
			planTeamChange({ primaryTeamId: A, membershipTeamIds: [A, B] }, move(B)),
		).toEqual({
			addTeamId: null,
			endTeamId: A,
			primaryTeamId: B,
		});
	});

	it("gives an employee without a team their first team", () => {
		expect(
			planTeamChange({ primaryTeamId: null, membershipTeamIds: [] }, move(B)),
		).toEqual({
			addTeamId: B,
			endTeamId: null,
			primaryTeamId: B,
		});
	});

	it("to the unchanged team only adds its missing membership", () => {
		expect(
			planTeamChange({ primaryTeamId: A, membershipTeamIds: [] }, move(A)),
		).toEqual({
			addTeamId: A,
			endTeamId: null,
			primaryTeamId: A,
		});
		expect(
			planTeamChange({ primaryTeamId: A, membershipTeamIds: [A] }, move(A)),
		).toEqual({
			addTeamId: null,
			endTeamId: null,
			primaryTeamId: A,
		});
	});

	it("to no team ends the primary membership and makes the next remaining one primary", () => {
		expect(
			planTeamChange(
				{ primaryTeamId: A, membershipTeamIds: [C, A, B] },
				move(null),
			),
		).toEqual({ addTeamId: null, endTeamId: A, primaryTeamId: B });
	});

	it("to no team from the last membership leaves no primary team", () => {
		expect(
			planTeamChange({ primaryTeamId: A, membershipTeamIds: [A] }, move(null)),
		).toEqual({
			addTeamId: null,
			endTeamId: A,
			primaryTeamId: null,
		});
	});

	it("to no team without a primary team still gives remaining memberships one", () => {
		expect(
			planTeamChange(
				{ primaryTeamId: null, membershipTeamIds: [C, B] },
				move(null),
			),
		).toEqual({ addTeamId: null, endTeamId: null, primaryTeamId: B });
		expect(
			planTeamChange(
				{ primaryTeamId: null, membershipTeamIds: [] },
				move(null),
			),
		).toEqual({
			addTeamId: null,
			endTeamId: null,
			primaryTeamId: null,
		});
	});
});

describe("adding a membership", () => {
	it("makes the team primary for an employee without a primary team", () => {
		expect(
			planTeamChange({ primaryTeamId: null, membershipTeamIds: [] }, add(B)),
		).toEqual({
			addTeamId: B,
			endTeamId: null,
			primaryTeamId: B,
		});
	});

	it("keeps an existing primary team", () => {
		expect(
			planTeamChange({ primaryTeamId: A, membershipTeamIds: [A] }, add(B)),
		).toEqual({
			addTeamId: B,
			endTeamId: null,
			primaryTeamId: A,
		});
	});

	it("of a team the employee already belongs to changes nothing", () => {
		expect(
			planTeamChange({ primaryTeamId: A, membershipTeamIds: [A, B] }, add(B)),
		).toEqual({
			addTeamId: null,
			endTeamId: null,
			primaryTeamId: A,
		});
	});
});

describe("removing a membership", () => {
	it("of the primary team makes the first remaining membership primary", () => {
		expect(
			planTeamChange(
				{ primaryTeamId: B, membershipTeamIds: [C, B, A] },
				remove(B),
			),
		).toEqual({ addTeamId: null, endTeamId: B, primaryTeamId: A });
	});

	it("of the last membership leaves no primary team", () => {
		expect(
			planTeamChange({ primaryTeamId: A, membershipTeamIds: [A] }, remove(A)),
		).toEqual({
			addTeamId: null,
			endTeamId: A,
			primaryTeamId: null,
		});
	});

	it("of another team keeps the primary team", () => {
		expect(
			planTeamChange(
				{ primaryTeamId: A, membershipTeamIds: [A, C] },
				remove(C),
			),
		).toEqual({
			addTeamId: null,
			endTeamId: C,
			primaryTeamId: A,
		});
	});

	it("of a team the employee does not belong to changes nothing", () => {
		expect(
			planTeamChange({ primaryTeamId: A, membershipTeamIds: [A] }, remove(C)),
		).toEqual({
			addTeamId: null,
			endTeamId: null,
			primaryTeamId: A,
		});
	});
});
