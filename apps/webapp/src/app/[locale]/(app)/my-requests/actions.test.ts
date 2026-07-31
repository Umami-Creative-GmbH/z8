import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actionState = vi.hoisted(() => ({
	authContext: null as unknown,
	cancelTimeCorrection: vi.fn(),
	revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: vi.fn(async () => actionState.authContext),
}));
vi.mock("@/lib/approvals/server/time-correction-cancellation", () => ({
	cancelPendingTimeCorrection: actionState.cancelTimeCorrection,
}));
vi.mock("next/cache", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/cache")>()),
	revalidatePath: actionState.revalidatePath,
}));

const { cancelMyTimeCorrectionRequest } = await import("./actions");

describe("my requests action boundaries", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		actionState.authContext = {
			user: { id: "user-requester" },
			session: {
				activeOrganizationId: "10000000-0000-4000-8000-000000000001",
			},
			employee: {
				id: "10000000-0000-4000-8000-000000000002",
				organizationId: "10000000-0000-4000-8000-000000000001",
			},
		};
		actionState.cancelTimeCorrection.mockResolvedValue({ replayed: false });
	});

	it("uses the server-only authenticated cancellation service", () => {
		const source = readFileSync(
			new URL("./actions.ts", import.meta.url),
			"utf8",
		);

		expect(source).toContain(
			'from "@/app/[locale]/(app)/absences/cancel-absence-service"',
		);
		expect(source).toContain("cancelAbsenceRequestForExpectedEmployee");
		expect(source).not.toContain(
			'from "@/app/[locale]/(app)/absences/actions"',
		);
	});

	it("derives requester authority from the authenticated active organization", async () => {
		const workPeriodId = "10000000-0000-4000-8000-000000000003";

		await expect(cancelMyTimeCorrectionRequest(workPeriodId)).resolves.toEqual({
			success: true,
		});
		expect(actionState.cancelTimeCorrection).toHaveBeenCalledWith({
			organizationId: "10000000-0000-4000-8000-000000000001",
			requesterEmployeeId: "10000000-0000-4000-8000-000000000002",
			requesterUserId: "user-requester",
			workPeriodId,
		});
		expect(actionState.revalidatePath).toHaveBeenCalledWith("/my-requests");
		expect(actionState.revalidatePath).toHaveBeenCalledWith("/time-tracking");
	});

	it("rejects malformed IDs and mismatched session organizations without invoking the domain", async () => {
		await expect(cancelMyTimeCorrectionRequest("not-a-uuid")).resolves.toEqual({
			success: false,
			error: "Request could not be cancelled.",
		});
		expect(actionState.cancelTimeCorrection).not.toHaveBeenCalled();

		actionState.authContext = {
			...(actionState.authContext as object),
			session: { activeOrganizationId: "other-organization" },
		};
		await expect(
			cancelMyTimeCorrectionRequest("10000000-0000-4000-8000-000000000003"),
		).resolves.toEqual({
			success: false,
			error: "Request could not be cancelled.",
		});
		expect(actionState.cancelTimeCorrection).not.toHaveBeenCalled();
	});

	it("returns a stable generic error without exposing domain details", async () => {
		actionState.cancelTimeCorrection.mockRejectedValue(
			new Error("private correction 10000000-0000-4000-8000-000000000007"),
		);

		await expect(
			cancelMyTimeCorrectionRequest("10000000-0000-4000-8000-000000000003"),
		).resolves.toEqual({
			success: false,
			error: "Request could not be cancelled.",
		});
	});
});
