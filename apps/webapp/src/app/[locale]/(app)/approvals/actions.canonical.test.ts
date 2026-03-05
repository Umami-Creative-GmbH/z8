import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
	env: {},
}));

vi.mock("../absences/actions", () => ({
	getCurrentEmployee: vi.fn(),
}));

const mockState = vi.hoisted(() => ({
	dbUpdate: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		update: mockState.dbUpdate,
		query: {
			approvalRequest: { findFirst: vi.fn(), findMany: vi.fn() },
			absenceEntry: { findFirst: vi.fn() },
			workPeriod: { findFirst: vi.fn() },
			employee: { findMany: vi.fn() },
		},
	},
}));

const actions = await import("./actions");

describe("approvals canonical sync", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("updates canonical work record timestamps after correction approval", async () => {
		const whereUpdate = vi.fn().mockResolvedValue(undefined);
		const setUpdate = vi.fn().mockReturnValue({ where: whereUpdate });
		mockState.dbUpdate.mockReturnValue({ set: setUpdate });

		const startAt = new Date("2026-01-01T08:15:00.000Z");
		const endAt = new Date("2026-01-01T17:00:00.000Z");

		await actions.syncCanonicalWorkCorrection({
			canonicalRecordId: "record-1",
			organizationId: "org-1",
			startAt,
			endAt,
			durationMinutes: 525,
			updatedBy: "user-1",
		});

		expect(mockState.dbUpdate).toHaveBeenCalledTimes(1);
		expect(setUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				startAt,
				endAt,
				durationMinutes: 525,
				updatedBy: "user-1",
			}),
		);
		expect(whereUpdate).toHaveBeenCalledTimes(1);
	});

	it("skips canonical work correction sync when linkage is missing", async () => {
		await actions.syncCanonicalWorkCorrection({
			canonicalRecordId: null,
			organizationId: "org-1",
			startAt: new Date("2026-01-01T08:15:00.000Z"),
			endAt: new Date("2026-01-01T17:00:00.000Z"),
			durationMinutes: 525,
			updatedBy: "user-1",
		});

		expect(mockState.dbUpdate).not.toHaveBeenCalled();
	});
});
