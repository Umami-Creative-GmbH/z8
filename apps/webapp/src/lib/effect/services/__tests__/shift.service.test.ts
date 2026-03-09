import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { AuthorizationError, NotFoundError } from "@/lib/effect/errors";
import { DatabaseService } from "../database.service";
import { ShiftService, ShiftServiceLive } from "../shift.service";

function createDeleteShiftTestContext({
	shiftRecord,
	actorEmployee,
}: {
	shiftRecord: {
		id: string;
		organizationId: string;
		status: "draft" | "published";
	} | null;
	actorEmployee: {
		id: string;
		userId: string;
		organizationId: string;
		role: "admin" | "manager" | "employee";
	} | null;
}) {
	const deleteWhere = vi.fn(async () => undefined);
	const mockDb = {
		query: {
			shift: {
				findFirst: vi.fn(async () => shiftRecord),
			},
			employee: {
				findFirst: vi.fn(async () => actorEmployee),
			},
		},
		delete: vi.fn(() => ({
			where: deleteWhere,
		})),
	};

	const dbLayer = Layer.succeed(
		DatabaseService,
		DatabaseService.of({
			db: mockDb as never,
			query: (_name, query) => Effect.promise(query) as never,
		}),
	);

	const layer = ShiftServiceLive.pipe(Layer.provide(dbLayer));

	return {
		deleteWhere,
		mockDb,
		runDeleteShift: (shiftId: string, userId: string) =>
			Effect.runPromise(
				Effect.either(
					Effect.gen(function* (_) {
						const service = yield* _(ShiftService);
						return yield* _(service.deleteShift(shiftId, userId));
					}).pipe(Effect.provide(layer)),
				),
			),
	};
}

describe("ShiftService.deleteShift", () => {
	it("rejects draft shift deletion for non-manager employees", async () => {
		const { deleteWhere, runDeleteShift } = createDeleteShiftTestContext({
			shiftRecord: { id: "shift-1", organizationId: "org-1", status: "draft" },
			actorEmployee: { id: "emp-1", userId: "user-1", organizationId: "org-1", role: "employee" },
		});

		expect(await runDeleteShift("shift-1", "user-1")).toMatchObject({
			_tag: "Left",
			left: expect.any(AuthorizationError),
		});
		expect(deleteWhere).not.toHaveBeenCalled();
	});

	it("treats cross-organization shifts as not found", async () => {
		const { deleteWhere, runDeleteShift } = createDeleteShiftTestContext({
			shiftRecord: null,
			actorEmployee: { id: "emp-2", userId: "user-2", organizationId: "org-2", role: "manager" },
		});

		expect(await runDeleteShift("shift-1", "user-2")).toMatchObject({
			_tag: "Left",
			left: expect.any(NotFoundError),
		});
		expect(deleteWhere).not.toHaveBeenCalled();
	});

	it("allows draft shift deletion for in-org managers", async () => {
		const { deleteWhere, runDeleteShift } = createDeleteShiftTestContext({
			shiftRecord: { id: "shift-1", organizationId: "org-1", status: "draft" },
			actorEmployee: { id: "emp-3", userId: "user-3", organizationId: "org-1", role: "manager" },
		});

		expect(await runDeleteShift("shift-1", "user-3")).toMatchObject({
			_tag: "Right",
			right: undefined,
		});
		expect(deleteWhere).toHaveBeenCalledTimes(1);
	});

	it("rejects published shift deletion for managers", async () => {
		const { deleteWhere, runDeleteShift } = createDeleteShiftTestContext({
			shiftRecord: { id: "shift-1", organizationId: "org-1", status: "published" },
			actorEmployee: { id: "emp-4", userId: "user-4", organizationId: "org-1", role: "manager" },
		});

		expect(await runDeleteShift("shift-1", "user-4")).toMatchObject({
			_tag: "Left",
			left: expect.any(AuthorizationError),
		});
		expect(deleteWhere).not.toHaveBeenCalled();
	});

	it("resolves the acting employee from userId before authorizing deletion", async () => {
		const { deleteWhere, mockDb, runDeleteShift } = createDeleteShiftTestContext({
			shiftRecord: { id: "shift-1", organizationId: "org-1", status: "draft" },
			actorEmployee: { id: "emp-5", userId: "user-5", organizationId: "org-1", role: "employee" },
		});

		expect(await runDeleteShift("shift-1", "user-5")).toMatchObject({
			_tag: "Left",
			left: expect.any(AuthorizationError),
		});
		expect(mockDb.query.employee.findFirst).toHaveBeenCalledTimes(1);
		expect(deleteWhere).not.toHaveBeenCalled();
	});
});
