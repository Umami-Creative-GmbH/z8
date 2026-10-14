// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { withdrawAbsenceChangeAction } from "@/app/[locale]/(app)/absences/change-actions";
import type { AbsenceChangeSummary } from "@/lib/absences/change-request-types";
import { AbsenceChangeHistory } from "./absence-change-history";

vi.mock("@tolgee/react", () => ({
	useTolgee: () => ({ getLanguage: () => "en" }),
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/absences/change-actions", () => ({
	withdrawAbsenceChangeAction: vi.fn(),
}));
const request: AbsenceChangeSummary = {
	id: "request",
	absenceId: "absence",
	kind: "cancel",
	status: "pending",
	original: {
		startDate: "2026-10-05",
		endDate: "2026-10-09",
		startPeriod: "full_day",
		endPeriod: "full_day",
		categoryId: "category",
		canonicalRecordId: null,
		canonical: null,
		updatedAt: "2026-10-01T00:00:00Z",
	},
	proposed: null,
	reason: "Entered in error",
	decisionReason: null,
	createdAt: "2026-10-14T00:00:00Z",
	decidedAt: null,
	deciderName: null,
};
beforeEach(() => vi.mocked(withdrawAbsenceChangeAction).mockReset());
it("shows pending request details and lets the employee withdraw", async () => {
	vi.mocked(withdrawAbsenceChangeAction).mockResolvedValue({
		success: true,
		data: { id: "request", workflowId: "workflow" },
	});
	const onChanged = vi.fn();
	render(<AbsenceChangeHistory requests={[request]} onChanged={onChanged} />);
	expect(screen.getByText("Pending approval")).toBeTruthy();
	expect(screen.getByText("Entered in error")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Withdraw request" }));
	await waitFor(() => expect(withdrawAbsenceChangeAction).toHaveBeenCalledWith("request"));
	expect(onChanged).toHaveBeenCalledOnce();
});
it("retains a rejected request and its explanation without a withdrawal action", () => {
	render(
		<AbsenceChangeHistory
			requests={[
				{
					...request,
					status: "rejected",
					decisionReason: "Recorded dates are correct",
				},
			]}
			onChanged={vi.fn()}
		/>,
	);
	expect(screen.getByText("Recorded dates are correct")).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Withdraw request" })).toBeNull();
});
