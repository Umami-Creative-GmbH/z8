import { describe, expect, it, vi } from "vitest";
import { fakeWorkTransaction } from "@/lib/time-tracking/work-transaction/testing";
import { approvalWriteGateGuard, Rank } from "@/lib/time-tracking/work-transaction/ranks";

vi.mock("@/lib/time-tracking/completed-work-transaction", () => ({
	routeCompletedWork: async (_db: unknown, input: { employeeId: string; actorUserId: string }) => ({
		users: [input.actorUserId, "owner-user"],
		employees: [input.employeeId, "actor-employee"],
		writeTargets: [input.employeeId],
	}),
}));

const { workPeriodDecisionPlan, workPeriodDecisionTarget } = await import(
	"./work-period-decision-transaction"
);

const period = { id: "period-1", employee_id: "employee-1", pending_changes: null };
const legacyRequest = (kind: string) => ({
	id: "request-1",
	requested_by: "employee-1",
	metadata: { timeRequest: { kind } },
	reason: null,
});
const workflow = (kind: string) => [
	"workflow-1",
	"pending",
	1,
	1,
	[["stage-1", "pending"]],
	[["assignment-1", "pending"]],
	kind,
	"employee-1",
];

describe("workPeriodDecisionTarget", () => {
	it("classifies a legacy request of the period and routes its requester", () => {
		const observation = JSON.stringify([period, [legacyRequest("policy_clock_out")], null]);
		expect(workPeriodDecisionTarget(observation, "request-1")).toEqual({
			kind: "policy_clock_out",
			ownerEmployeeId: "employee-1",
		});
	});

	it("routes the canonical workflow that owns the assignment", () => {
		const observation = JSON.stringify([period, null, [workflow("manual_time_submission")]]);
		expect(workPeriodDecisionTarget(observation, "assignment-1")).toEqual({
			kind: "manual_time_submission",
			ownerEmployeeId: "employee-1",
		});
	});

	it("names no target for a missing period, an unknown id or another kind", () => {
		expect(
			workPeriodDecisionTarget(
				JSON.stringify([null, [legacyRequest("manual_time_submission")], null]),
				"request-1",
			),
		).toBeNull();
		expect(
			workPeriodDecisionTarget(
				JSON.stringify([period, null, [workflow("manual_time_submission")]]),
				"other",
			),
		).toBeNull();
		expect(
			workPeriodDecisionTarget(
				JSON.stringify([period, null, [workflow("time_correction")]]),
				"assignment-1",
			),
		).toBeNull();
	});

	it("names no target for an observation that is not an array", () => {
		expect(workPeriodDecisionTarget("null", "request-1")).toBeNull();
		expect(workPeriodDecisionTarget(JSON.stringify({ id: "request-1" }), "request-1")).toBeNull();
	});
});

describe("workPeriodDecisionPlan", () => {
	function harness(observation: () => string) {
		const client = {
			execute: async () => ({ rows: [{ observation: observation() }] }),
		};
		const runtime = () => ({
			repository: {
				withTransaction: <T>(body: (context: never) => Promise<T>) =>
					body({
						writeGate: { acquire: async () => ({ authority: "legacy" }) },
						compatibilityWriter: { withWriteGate: () => ({}) },
					} as never),
			},
		});
		return { fake: fakeWorkTransaction({ client, recordApprovalGate: true }), runtime };
	}
	const input = {
		organizationId: "org-1",
		workPeriodId: "period-1",
		approvalRequestId: "request-1",
		actorUserId: "actor-user",
	};

	it("takes the decided kind's gate at rank 2 and routes the owner", async () => {
		const observation = JSON.stringify([period, [legacyRequest("policy_clock_out")], null]);
		const { fake, runtime } = harness(() => observation);

		const route = await fake.run(
			workPeriodDecisionPlan(input, runtime as never),
			async (scope) => scope.route,
		);

		expect(route.approvalGate).toBe("policy_clock_out");
		expect(route.writeTargets).toEqual(["employee-1"]);
		expect(route.snapshot).toEqual({
			observation,
			target: { kind: "policy_clock_out", ownerEmployeeId: "employee-1" },
		});
		expect(fake.guards.filter((guard) => guard.rank === Rank.approvalWriteGate)).toEqual([
			{ ...approvalWriteGateGuard("org-1", "policy_clock_out"), attempt: 1 },
		]);
	});

	it("restarts when a decision commits before the guards are held", async () => {
		let reads = 0;
		const observations = [
			JSON.stringify([period, [legacyRequest("manual_time_submission")], null]),
			JSON.stringify([
				{ ...period, approval_status: "approved" },
				[legacyRequest("manual_time_submission")],
				null,
			]),
		];
		const { fake, runtime } = harness(() => observations[Math.min(reads++, 1)] ?? "");

		await fake.run(workPeriodDecisionPlan(input, runtime as never), async () => undefined);

		expect(fake.attempts).toBe(2);
	});

	it("routes no work and takes no gate when the observation names no target", async () => {
		const { fake, runtime } = harness(() => JSON.stringify([null, null, null]));

		const route = await fake.run(
			workPeriodDecisionPlan(input, runtime as never),
			async (scope) => scope.route,
		);

		expect(route).toMatchObject({ employees: [], writeTargets: [], snapshot: { target: null } });
		expect(route.approvalGate).toBeUndefined();
		expect(fake.guards.some((guard) => guard.rank === Rank.approvalWriteGate)).toBe(false);
	});
});
