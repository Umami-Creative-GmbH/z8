import { describe, expect, it } from "vitest";
import { AuditTrail } from "@/lib/audit-trail";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { LifecycleClient } from "../types";
import { createEmploymentEnding } from "./employment-ending";
import type {
	EmploymentEndingCause,
	EmploymentEndingContext,
	EmploymentEndingParticipant,
} from "./types";

/**
 * The Employment ending module (#1624, spec #1590) with fake participants:
 * each holds a set of things the employee holds, plans what is still live and
 * ends exactly what it planned.
 */

const tx = {} as LifecycleClient;

type FakeLog = string[];

function fakeParticipant(
	key: string,
	log: FakeLog,
	holdings: string[],
	options: { afterCommit?: string } = {},
): EmploymentEndingParticipant<{ held: string[] }, { ended: string[] }> & {
	live: Set<string>;
} {
	const live = new Set(holdings);
	return {
		key,
		live,
		plan: async (_reader, ctx) => {
			log.push(`plan:${key}:${ctx.cause.kind}`);
			return { held: [...live] };
		},
		apply: async (_tx, plan, ctx) => {
			log.push(`apply:${key}:${ctx.cause.kind}`);
			const ended = plan.held.filter((id) => live.delete(id));
			const afterCommitStep = options.afterCommit;
			return {
				applied: { ended },
				afterCommit: afterCommitStep
					? [
							async () => {
								log.push(afterCommitStep);
							},
						]
					: [],
			};
		},
		reactivationItems: (applied, subject) =>
			applied.ended.map((id) => ({
				group: "shareLinks" as const,
				kind: "share_links" as const,
				count: 1,
				href: `/${key}/${id}/${subject.employeeId}`,
			})),
	};
}

const departure: EmploymentEndingCause = {
	kind: "departure",
	departureId: "departure-1",
	mode: "scheduled",
};
const deactivation: EmploymentEndingCause = {
	kind: "deactivation",
	deactivationId: "deactivation-1",
	reason: "employee_deactivated",
};

function context(cause: EmploymentEndingCause): EmploymentEndingContext {
	return {
		organizationId: "organization-1",
		employeeId: "employee-1",
		employmentPeriodId: "period-1",
		at: parseInstant("2026-09-03T08:00:00Z"),
		now: parseInstant("2026-09-03T08:00:00Z"),
		timeZone: "Europe/Berlin",
		actorUserId: "admin-1",
		audit: new AuditTrail(),
		cause,
	};
}

describe("Employment ending", () => {
	it("plans and ends each participant's holdings in the registered order", async () => {
		const log: FakeLog = [];
		const ending = createEmploymentEnding([
			fakeParticipant("equipment", log, ["e1"]),
			fakeParticipant("drivingLicence", log, ["d1"]),
			fakeParticipant("deputyAssignments", log, ["a1"]),
		]);

		const { applied } = await ending.endEmployment(tx, context(deactivation));

		expect(log).toEqual([
			"plan:equipment:deactivation",
			"apply:equipment:deactivation",
			"plan:drivingLicence:deactivation",
			"apply:drivingLicence:deactivation",
			"plan:deputyAssignments:deactivation",
			"apply:deputyAssignments:deactivation",
		]);
		expect(applied).toEqual({
			equipment: { ended: ["e1"] },
			drivingLicence: { ended: ["d1"] },
			deputyAssignments: { ended: ["a1"] },
		});
	});

	it("previews every participant's plan in order without ending anything", async () => {
		const log: FakeLog = [];
		const first = fakeParticipant("first", log, ["f1", "f2"]);
		const second = fakeParticipant("second", log, []);
		const ending = createEmploymentEnding([first, second]);

		const plan = await ending.previewEmploymentEnding(tx, {
			organizationId: "organization-1",
			employeeId: "employee-1",
			employmentPeriodId: null,
			at: parseInstant("2026-09-03T08:00:00Z"),
			timeZone: "Europe/Berlin",
			cause: { kind: "deactivation" },
		});

		expect(plan).toEqual({
			first: { held: ["f1", "f2"] },
			second: { held: [] },
		});
		expect(log).toEqual(["plan:first:deactivation", "plan:second:deactivation"]);
		expect([...first.live]).toEqual(["f1", "f2"]);
	});

	it("ends nothing on a second run", async () => {
		const log: FakeLog = [];
		const ending = createEmploymentEnding([
			fakeParticipant("first", log, ["f1"]),
			fakeParticipant("second", log, ["s1", "s2"]),
		]);
		await ending.endEmployment(tx, context(deactivation));

		const replay = await ending.endEmployment(tx, context(deactivation));

		expect(replay.applied).toEqual({
			first: { ended: [] },
			second: { ended: [] },
		});
		expect(ending.reactivationItems(replay.applied, { employeeId: "employee-1" })).toEqual([]);
	});

	it("returns the participants' after-commit steps in order without running them", async () => {
		const log: FakeLog = [];
		const ending = createEmploymentEnding([
			fakeParticipant("first", log, ["f1"], { afterCommit: "notify:first" }),
			fakeParticipant("quiet", log, ["q1"]),
			fakeParticipant("second", log, ["s1"], { afterCommit: "notify:second" }),
		]);

		const { afterCommit } = await ending.endEmployment(tx, context(departure));

		expect(log.filter((entry) => entry.startsWith("notify"))).toEqual([]);
		for (const step of afterCommit) await step();
		expect(log.filter((entry) => entry.startsWith("notify"))).toEqual([
			"notify:first",
			"notify:second",
		]);
	});

	it.each([
		["a departure", departure],
		["an admin's deactivation", deactivation],
		[
			"the deactivation backfill",
			{ ...deactivation, reason: "employee_deactivation_backfill" } as const,
		],
	])("runs every participant for %s", async (_name, cause) => {
		const log: FakeLog = [];
		const keys = ["a", "b", "c", "d"];
		const ending = createEmploymentEnding(keys.map((key) => fakeParticipant(key, log, [key])));

		await ending.endEmployment(tx, context(cause));

		expect(log.filter((entry) => entry.startsWith("apply"))).toEqual(
			keys.map((key) => `apply:${key}:${cause.kind}`),
		);
	});

	it("lists each participant's checklist items from what it ended, skipping ones it never recorded", () => {
		const ending = createEmploymentEnding([
			fakeParticipant("first", [], []),
			fakeParticipant("second", [], []),
		]);

		const items = ending.reactivationItems(
			{ second: { ended: ["s1"] } },
			{ employeeId: "employee-1" },
		);

		expect(items).toEqual([
			{
				group: "shareLinks",
				kind: "share_links",
				count: 1,
				href: "/second/s1/employee-1",
			},
		]);
	});

	it("refuses two participants with the same key", () => {
		expect(() =>
			createEmploymentEnding([fakeParticipant("same", [], []), fakeParticipant("same", [], [])]),
		).toThrow(/same/);
	});
});
