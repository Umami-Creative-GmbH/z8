/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { changeAbsenceDeputy } from "@/app/[locale]/(app)/absences/deputy-actions";
import type { AbsenceWithCategory } from "@/lib/absences/types";
import { ChangeDeputyDialog } from "./change-deputy-dialog";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string>) =>
			fallback.replace(/\{(\w+)\}/g, (_match, name: string) => params?.[name] ?? `{${name}}`),
	}),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/components/ui/action-panel", () => {
	const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
	return {
		ActionPanel: ({ children, open }: { children?: ReactNode; open: boolean }) =>
			open ? <div>{children}</div> : null,
		ActionPanelBody: Pass,
		ActionPanelContent: Pass,
		ActionPanelDescription: Pass,
		ActionPanelFooter: Pass,
		ActionPanelHeader: Pass,
		ActionPanelTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
	};
});

vi.mock("./deputy-picker", async (original) => ({
	...(await original<typeof import("./deputy-picker")>()),
	DeputyPicker: ({
		value,
		onChange,
		required,
	}: {
		value: string;
		onChange: (value: string) => void;
		required: boolean;
	}) => (
		<select aria-label="Deputy" value={value} onChange={(event) => onChange(event.target.value)}>
			{!required && <option value="">No deputy</option>}
			<option value="employee-2">Ben Example</option>
			<option value="employee-3">Carla Example</option>
		</select>
	),
}));

vi.mock("@/app/[locale]/(app)/absences/deputy-actions", () => ({
	changeAbsenceDeputy: vi.fn(),
}));

const absence: AbsenceWithCategory = {
	id: "absence-1",
	employeeId: "employee-1",
	startDate: "2026-05-18",
	startPeriod: "full_day",
	endDate: "2026-05-22",
	endPeriod: "full_day",
	status: "approved",
	notes: null,
	sickDetail: null,
	category: {
		id: "category-on-call",
		name: "On-call leave",
		type: "custom",
		color: null,
		countsAgainstVacation: false,
		deputyRequired: true,
	},
	deputy: { id: "employee-2", name: "Ben Example" },
	approvedBy: null,
	approvedAt: null,
	rejectionReason: null,
	createdAt: new Date("2026-05-01T00:00:00Z"),
};

function renderDialog(onChanged = vi.fn()) {
	render(
		<QueryClientProvider client={new QueryClient()}>
			<ChangeDeputyDialog absence={absence} open onOpenChange={vi.fn()} onChanged={onChanged} />
		</QueryClientProvider>,
	);
	return onChanged;
}

beforeEach(() => {
	vi.mocked(changeAbsenceDeputy).mockReset();
});

describe("ChangeDeputyDialog", () => {
	it("starts from the current deputy and saves the new one without a new approval", async () => {
		vi.mocked(changeAbsenceDeputy).mockResolvedValue({
			success: true,
			data: { deputyEmployeeId: "employee-3" },
		});
		const onChanged = renderDialog();

		const picker = screen.getByLabelText("Deputy") as HTMLSelectElement;
		expect(picker.value).toBe("employee-2");
		expect(screen.queryByRole("option", { name: "No deputy" })).toBeNull();
		fireEvent.change(picker, { target: { value: "employee-3" } });
		fireEvent.click(screen.getByRole("button", { name: "Save deputy" }));

		await waitFor(() =>
			expect(changeAbsenceDeputy).toHaveBeenCalledWith({
				absenceId: "absence-1",
				deputyEmployeeId: "employee-3",
			}),
		);
		await waitFor(() => expect(onChanged).toHaveBeenCalled());
	});

	it("shows a refused deputy on the deputy field", async () => {
		vi.mocked(changeAbsenceDeputy).mockResolvedValue({
			success: false,
			error: "Server wording",
			code: "ValidationError",
			refusal: "deputy_unavailable",
		});
		const onChanged = renderDialog();

		fireEvent.change(screen.getByLabelText("Deputy"), { target: { value: "employee-3" } });
		fireEvent.click(screen.getByRole("button", { name: "Save deputy" }));

		expect(
			await screen.findByText("The deputy must be an active employee of this organization."),
		).toBeTruthy();
		expect(onChanged).not.toHaveBeenCalled();
	});
});
