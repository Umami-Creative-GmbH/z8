/**
 * Manual work's check against the locked scope stays injected through the activation resolver
 * (#1602): an approver decided outside the routed scope restarts the attempt widened.
 */
import { describe, expect, it, vi } from "vitest";
import type { StageActivationInput } from "@/lib/approvals/workflow/ports";

const state = vi.hoisted(() => ({
	/** The approver each attempt's activation decides, by attempt (from 1). */
	decided: [] as string[],
	widenings: [] as boolean[],
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/approvals/server/work-period-resource-routing", () => ({
	routeWorkPeriodApprovalParticipants: async () => ({
		employeeIds: ["manager"],
		userIds: ["manager-user"],
	}),
}));

// The coordinator restarts on request and routes each attempt as the plan says, widened once
// asked to; locking is not under test here.
vi.mock("./work-transaction", () => {
	class Restart extends Error {
		constructor(readonly widen: boolean) {
			super("restart");
		}
	}
	const rows = () => {
		const chain = {
			from: () => chain,
			where: () => chain,
			// biome-ignore lint/suspicious/noThenProperty: a thenable query stand-in.
			then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
		};
		return chain;
	};
	return {
		async runWorkTransaction(
			plan: {
				route: (db: unknown, attempt: { widened: boolean }) => Promise<unknown>;
			},
			operation: (scope: unknown) => Promise<unknown>,
		) {
			const db = { select: rows, execute: async () => undefined };
			let widened = false;
			for (let attempt = 1; attempt <= 3; attempt += 1) {
				state.widenings.push(widened);
				const route = await plan.route(db, { widened });
				try {
					return await operation({
						db,
						route,
						admission: "legacy",
						assertEmployee: () => undefined,
						restart: ({ widen = false } = {}) => {
							throw new Restart(widen);
						},
						savepoint: async () => undefined,
						approval: {
							activationResolver: {
								resolve: async (activation: StageActivationInput) => ({
									organizationId: activation.organizationId,
									assignments: [{ approverEmployeeId: state.decided[attempt - 1] }],
								}),
							},
						},
					});
				} catch (error) {
					if (!(error instanceof Restart)) throw error;
					widened ||= error.widen;
				}
			}
			throw new Error("Scope changed too often");
		},
	};
});

const { withManualWorkTransaction } = await import("./manual-work-transaction");

const input = {
	organizationId: "org-1",
	actorUserId: "employee-user",
	targetEmployeeId: "employee",
	targetUserId: "employee-user",
	submissionId: "submission-1",
};

const activation = {
	organizationId: "org-1",
	workflow: { policySnapshot: {} },
} as unknown as StageActivationInput;

function decideApproval(decided: string[]) {
	state.decided = decided;
	state.widenings = [];
	return withManualWorkTransaction(
		input,
		() => ({}) as never,
		async (context) => {
			const result = await context.approval.activationResolver.resolve(activation);
			return result.assignments.map((assignment) => assignment.approverEmployeeId);
		},
	);
}

describe("manual work's locked scope", () => {
	it("restarts the attempt widened when the decided approver is outside the locked scope", async () => {
		await expect(decideApproval(["manager", "manager"])).resolves.toEqual(["manager"]);
		expect(state.widenings).toEqual([false, true]);
	});

	it("keeps an attempt whose decided approver the scope already routes", async () => {
		await expect(decideApproval(["employee"])).resolves.toEqual(["employee"]);
		expect(state.widenings).toEqual([false]);
	});

	it("never settles on an approver outside even the widened scope", async () => {
		await expect(decideApproval(["stranger", "stranger", "stranger"])).rejects.toThrow(
			"Scope changed too often",
		);
		expect(state.widenings).toEqual([false, true, true]);
	});
});
