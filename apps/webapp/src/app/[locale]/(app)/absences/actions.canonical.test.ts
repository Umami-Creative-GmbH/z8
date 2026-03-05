import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
	env: {},
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: vi.fn(),
		},
	},
}));

const actions = await import("./actions");

describe("absence canonical action routing", () => {
	it("syncs absence requests to canonical records with org scoping", async () => {
		const createSpy = vi
			.spyOn(actions.canonicalAbsenceRecordClient, "create")
			.mockResolvedValue({ id: "rec-1" } as never);

		await actions.syncAbsenceRequestToCanonicalRecord({
			organizationId: "org-1",
			employeeId: "emp-1",
			startDate: "2026-02-10",
			startPeriod: "full_day",
			endDate: "2026-02-12",
			endPeriod: "full_day",
			requiresApproval: true,
			createdBy: "user-1",
			absenceId: "abs-1",
		});

		expect(createSpy).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeId: "emp-1",
			startDate: "2026-02-10",
			startPeriod: "full_day",
			endDate: "2026-02-12",
			endPeriod: "full_day",
			requiresApproval: true,
			createdBy: "user-1",
		});
	});

	it("maps same-day half-day requests to partial canonical timestamps", () => {
		const mapped = actions.mapAbsenceRangeToCanonicalTimestamps({
			startDate: "2026-02-10",
			startPeriod: "pm",
			endDate: "2026-02-10",
			endPeriod: "pm",
		});

		expect(mapped.startAt.toISOString()).toBe("2026-02-10T12:00:00.000Z");
		expect(mapped.endAt.toISOString()).toBe("2026-02-10T23:59:59.999Z");
	});

	it("does not fail the action when canonical sync fails", async () => {
		vi.spyOn(actions.canonicalAbsenceRecordClient, "create").mockRejectedValue(
			new Error("canonical write failed"),
		);

		await expect(
			actions.syncAbsenceRequestToCanonicalRecord({
			organizationId: "org-1",
			employeeId: "emp-1",
			startDate: "2026-02-10",
			startPeriod: "full_day",
			endDate: "2026-02-12",
			endPeriod: "full_day",
			requiresApproval: false,
			createdBy: "user-1",
			absenceId: "abs-1",
			}),
		).resolves.toBeUndefined();
	});
});
