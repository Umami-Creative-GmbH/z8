import { describe, expect, it, vi } from "vitest";

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
			endDate: "2026-02-12",
			requiresApproval: true,
			createdBy: "user-1",
			absenceId: "abs-1",
		});

		expect(createSpy).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeId: "emp-1",
			startDate: "2026-02-10",
			endDate: "2026-02-12",
			requiresApproval: true,
			createdBy: "user-1",
		});
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
				endDate: "2026-02-12",
				requiresApproval: false,
				createdBy: "user-1",
				absenceId: "abs-1",
			}),
		).resolves.toBeUndefined();
	});
});
