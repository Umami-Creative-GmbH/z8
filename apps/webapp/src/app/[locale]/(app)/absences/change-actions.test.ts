import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestAbsenceChange, withdrawAbsenceChange } from "@/lib/absences/change-request-service";
import { AbsenceChangeError } from "@/lib/absences/change-request-types";
import { getRequestSession } from "@/lib/auth/request-session";
import { resolveEmployeeOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { submitAbsenceChangeAction, withdrawAbsenceChangeAction } from "./change-actions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/auth/request-session", () => ({ getRequestSession: vi.fn() }));
vi.mock("@/lib/employee-lifecycle/access", () => ({
	resolveEmployeeOrganizationAccess: vi.fn(),
}));
vi.mock("@/lib/billing/guard", () => ({
	requireBillingForMutation: vi.fn(async () => ({ canAccess: true })),
	isBillingMutationAllowed: () => true,
}));
vi.mock("@/lib/time-tracking/closed-months/refusal-message", () => ({
	monthClosedActionResult: vi.fn(async () => null),
}));
vi.mock("@/lib/absences/change-request-service", () => ({
	requestAbsenceChange: vi.fn(),
	withdrawAbsenceChange: vi.fn(),
	listOwnAbsenceChanges: vi.fn(),
}));
const input = {
	absenceId: "d9b3a3c0-729f-4d61-8ed6-1a0a889c42e3",
	kind: "cancel" as const,
	reason: "Entered in error",
};
beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(getRequestSession).mockResolvedValue({
		user: { id: "current-user" },
		session: { activeOrganizationId: "current-org" },
	} as Awaited<ReturnType<typeof getRequestSession>>);
	vi.mocked(resolveEmployeeOrganizationAccess).mockResolvedValue({
		allowed: true,
		employeeId: "current-employee",
	});
	vi.mocked(requestAbsenceChange).mockResolvedValue({
		id: "request",
		workflowId: "workflow",
	});
	vi.mocked(withdrawAbsenceChange).mockResolvedValue({
		id: "request",
		workflowId: "workflow",
	});
});
describe("absence change actions", () => {
	it("takes organization and user only from the authenticated session", async () => {
		expect(await submitAbsenceChangeAction(input)).toMatchObject({
			success: true,
		});
		expect(requestAbsenceChange).toHaveBeenCalledWith({
			...input,
			organizationId: "current-org",
			userId: "current-user",
		});
		expect(
			await submitAbsenceChangeAction({
				...input,
				organizationId: "foreign-org",
			} as typeof input),
		).toMatchObject({ success: false, code: "invalid_input" });
		expect(requestAbsenceChange).toHaveBeenCalledOnce();
	});
	it("refuses inactive or departed employees before submitting or withdrawing", async () => {
		vi.mocked(resolveEmployeeOrganizationAccess).mockResolvedValue({
			allowed: false,
			reason: "offboarded",
		});
		expect(await submitAbsenceChangeAction(input)).toMatchObject({
			success: false,
			code: "unauthorized",
		});
		expect(await withdrawAbsenceChangeAction("request")).toMatchObject({
			success: false,
			code: "unauthorized",
		});
		expect(requestAbsenceChange).not.toHaveBeenCalled();
		expect(withdrawAbsenceChange).not.toHaveBeenCalled();
	});
	it("returns safe domain refusals without exposing database errors", async () => {
		vi.mocked(requestAbsenceChange).mockRejectedValueOnce(
			new AbsenceChangeError("already_pending", "Withdraw the pending request first"),
		);
		expect(await submitAbsenceChangeAction(input)).toMatchObject({
			success: false,
			error: "Withdraw the pending request first",
			code: "already_pending",
		});
		vi.mocked(requestAbsenceChange).mockRejectedValueOnce(
			new Error("SQL and sensitive query parameters"),
		);
		const result = await submitAbsenceChangeAction(input);
		expect(result).toMatchObject({ success: false });
		expect(JSON.stringify(result)).not.toContain("SQL");
	});
});
