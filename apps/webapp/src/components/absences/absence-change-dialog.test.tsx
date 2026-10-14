// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { submitAbsenceChangeAction } from "@/app/[locale]/(app)/absences/change-actions";
import { AbsenceChangeDialog } from "./absence-change-dialog";

vi.mock("@tolgee/react", () => ({
	useTolgee: () => ({ getLanguage: () => "en" }),
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/absences/change-actions", () => ({
	submitAbsenceChangeAction: vi.fn(),
}));
vi.mock("@/components/ui/action-panel", () => {
	const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
	return {
		ActionPanel: Pass,
		ActionPanelBody: Pass,
		ActionPanelContent: Pass,
		ActionPanelDescription: Pass,
		ActionPanelFooter: Pass,
		ActionPanelHeader: Pass,
		ActionPanelTitle: Pass,
	};
});
const absence = {
	id: "d9b3a3c0-729f-4d61-8ed6-1a0a889c42e3",
	startDate: "2026-10-05",
	endDate: "2026-10-09",
	startPeriod: "full_day" as const,
	endPeriod: "full_day" as const,
	category: { name: "Sick Leave", type: "sick" },
};
beforeEach(() => vi.mocked(submitAbsenceChangeAction).mockReset());
describe("AbsenceChangeDialog", () => {
	it("submits a shorter range with a reason while keeping recorded coverage by default", async () => {
		vi.mocked(submitAbsenceChangeAction).mockResolvedValue({
			success: true,
			data: { id: "request", workflowId: "workflow" },
		});
		const onChanged = vi.fn();
		render(
			<AbsenceChangeDialog
				absence={absence}
				kind="change"
				open
				onOpenChange={vi.fn()}
				onChanged={onChanged}
			/>,
		);
		fireEvent.change(screen.getByLabelText(/End date/), {
			target: { value: "2026-10-07" },
		});
		fireEvent.change(screen.getByLabelText(/Reason/), {
			target: { value: "Recovered earlier" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
		await waitFor(() =>
			expect(submitAbsenceChangeAction).toHaveBeenCalledWith({
				absenceId: absence.id,
				kind: "change",
				proposed: {
					startDate: "2026-10-05",
					endDate: "2026-10-07",
					startPeriod: "full_day",
					endPeriod: "full_day",
				},
				coverage: "keep",
				reason: "Recovered earlier",
			}),
		);
		expect(onChanged).toHaveBeenCalledOnce();
	});
	it("requires a reason and submits cancellation without dates", async () => {
		vi.mocked(submitAbsenceChangeAction).mockResolvedValue({
			success: true,
			data: { id: "request", workflowId: "workflow" },
		});
		render(<AbsenceChangeDialog absence={absence} kind="cancel" open onOpenChange={vi.fn()} />);
		fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
		await screen.findByText("A reason is required");
		expect(submitAbsenceChangeAction).not.toHaveBeenCalled();
		fireEvent.change(screen.getByLabelText(/Reason/), {
			target: { value: "Entered in error" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
		await waitFor(() =>
			expect(submitAbsenceChangeAction).toHaveBeenCalledWith({
				absenceId: absence.id,
				kind: "cancel",
				reason: "Entered in error",
			}),
		);
	});
	it("keeps the dialog open and shows a safe server refusal", async () => {
		vi.mocked(submitAbsenceChangeAction).mockResolvedValue({
			success: false,
			error: "October is closed",
			code: "MonthClosedError",
		});
		const onOpenChange = vi.fn();
		render(
			<AbsenceChangeDialog absence={absence} kind="cancel" open onOpenChange={onOpenChange} />,
		);
		fireEvent.change(screen.getByLabelText(/Reason/), {
			target: { value: "Entered in error" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
		await screen.findByText("October is closed");
		expect(onOpenChange).not.toHaveBeenCalled();
	});
});
