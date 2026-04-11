import { Cause, Effect, Exit, Option } from "effect";
import { describe, expect, it, vi } from "vitest";
import { ConflictError, DatabaseError } from "@/lib/effect/errors";

vi.mock("drizzle-orm", async (importOriginal) => {
	const actual = await importOriginal<typeof import("drizzle-orm")>();
	return {
		...actual,
		and: vi.fn((...args: unknown[]) => ({ and: args })),
		eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	};
});

vi.mock("@/db/schema", () => ({
	travelExpenseClaim: {
		id: "id",
		organizationId: "organizationId",
		status: "status",
	},
	travelExpenseDecisionLog: {},
	employee: {
		id: "id",
	},
}));

import { and, eq } from "drizzle-orm";
import { persistTravelExpenseDecision } from "@/lib/approvals/server/travel-expense-approvals";
import type { ApprovalDbService, CurrentApprover } from "@/lib/approvals/server/types";

describe("persistTravelExpenseDecision", () => {
	it("keeps the submitted-status guard on the write path", async () => {
		const returning = vi.fn().mockResolvedValue([{ id: "claim-1" }]);
		const where = vi.fn().mockReturnValue({ returning });
		const set = vi.fn().mockReturnValue({ where });
		const values = vi.fn().mockResolvedValue(undefined);

		const dbService = {
			db: {
				update: vi.fn().mockReturnValue({ set }),
				insert: vi.fn().mockReturnValue({ values }),
			},
			query: (_name: string, fn: () => Promise<unknown>) => Effect.promise(fn),
		} satisfies ApprovalDbService;

		const currentEmployee: CurrentApprover = {
			id: "employee-1",
			userId: "user-1",
			organizationId: "org-1",
			user: {
				id: "user-1",
				name: "Morgan Reviewer",
				email: "morgan@example.com",
				image: null,
			},
		};

		await Effect.runPromise(
			persistTravelExpenseDecision(dbService, "claim-1", currentEmployee, "approve", "looks good"),
		);

		expect(eq).toHaveBeenCalledWith("status", "submitted");
		expect(and).toHaveBeenCalledWith(
			expect.objectContaining({ eq: ["id", "claim-1"] }),
			expect.objectContaining({ eq: ["organizationId", "org-1"] }),
			expect.objectContaining({ eq: ["status", "submitted"] }),
		);
	});

	it("fails stale writes before inserting a decision log", async () => {
		const where = vi.fn().mockResolvedValue([]);
		const set = vi.fn().mockReturnValue({ where });
		const values = vi.fn().mockResolvedValue(undefined);

		const dbService = {
			db: {
				update: vi.fn().mockReturnValue({ set }),
				insert: vi.fn().mockReturnValue({ values }),
			},
			query: (_name: string, fn: () => Promise<unknown>) => Effect.promise(fn),
		} satisfies ApprovalDbService;

		const currentEmployee: CurrentApprover = {
			id: "employee-1",
			userId: "user-1",
			organizationId: "org-1",
			user: {
				id: "user-1",
				name: "Morgan Reviewer",
				email: "morgan@example.com",
				image: null,
			},
		};

		const exit = await Effect.runPromiseExit(
			persistTravelExpenseDecision(
				dbService,
				"claim-1",
				currentEmployee,
				"approve",
				"looks good",
			),
		);

		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			const error =
				Option.getOrNull(Cause.failureOption(exit.cause)) ??
				([...(Cause.defects(exit.cause) as Iterable<unknown>)] [0] as unknown);
			expect(error).toBeInstanceOf(ConflictError);
			expect(error).toMatchObject({
				message: "Only submitted claims can be decided",
				conflictType: "travel_expense_claim_status",
			});
		}

		expect(values).not.toHaveBeenCalled();
	});

	it("preserves ConflictError semantics when the database wrapper catches query callback throws", async () => {
		const where = vi.fn().mockReturnValue({
			returning: vi.fn().mockResolvedValue([]),
		});
		const set = vi.fn().mockReturnValue({ where });
		const values = vi.fn().mockResolvedValue(undefined);

		const dbService = {
			db: {
				update: vi.fn().mockReturnValue({ set }),
				insert: vi.fn().mockReturnValue({ values }),
			},
			query: (name: string, fn: () => Promise<unknown>) =>
				Effect.tryPromise({
					try: fn,
					catch: (error) =>
						new DatabaseError({
							message: `Database query failed: ${name}`,
							operation: name,
							cause: error,
						}),
				}),
		} satisfies ApprovalDbService;

		const currentEmployee: CurrentApprover = {
			id: "employee-1",
			userId: "user-1",
			organizationId: "org-1",
			user: {
				id: "user-1",
				name: "Morgan Reviewer",
				email: "morgan@example.com",
				image: null,
			},
		};

		const exit = await Effect.runPromiseExit(
			persistTravelExpenseDecision(
				dbService,
				"claim-1",
				currentEmployee,
				"approve",
				"looks good",
			),
		);

		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			const error = Option.getOrNull(Cause.failureOption(exit.cause));
			expect(error).toBeInstanceOf(ConflictError);
			expect(error).not.toBeInstanceOf(DatabaseError);
			expect(error).toMatchObject({
				message: "Only submitted claims can be decided",
				conflictType: "travel_expense_claim_status",
			});
		}

		expect(values).not.toHaveBeenCalled();
	});
});
