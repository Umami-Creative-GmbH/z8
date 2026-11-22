/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	createCoverageRule: vi.fn(),
	updateCoverageRule: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (key: string, fallback?: string) => fallback ?? key,
	}),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/app/[locale]/(app)/settings/shifts/coverage-rule-actions", () => ({
	createCoverageRule: mocks.createCoverageRule,
	updateCoverageRule: mocks.updateCoverageRule,
}));

vi.mock("@/components/ui/action-panel", () => {
	const Pass = ({ children }: { children: ReactNode }) => <div>{children}</div>;
	return {
		ActionPanel: ({ children, open }: { children: ReactNode; open: boolean }) =>
			open ? <div>{children}</div> : null,
		ActionPanelBody: Pass,
		ActionPanelContent: Pass,
		ActionPanelDescription: Pass,
		ActionPanelFooter: Pass,
		ActionPanelHeader: Pass,
		ActionPanelTitle: Pass,
	};
});

vi.mock("@/components/ui/select", () => ({
	Select: ({
		children,
		value,
		onValueChange,
	}: {
		children: ReactNode;
		value: string;
		onValueChange: (value: string) => void;
	}) => (
		<select
			aria-label="select"
			value={value}
			onChange={(event) => onValueChange(event.target.value)}
		>
			<option value="">-</option>
			{children}
		</select>
	),
	SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
	SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
		<option value={value}>{children}</option>
	),
	SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
	SelectValue: () => null,
}));

vi.mock("@/components/ui/time-input", () => ({
	TimeInput: (props: ComponentProps<"input">) => <input type="time" {...props} />,
}));

import { CoverageRuleDialog } from "./coverage-rule-dialog";

const SUBAREA_ID = "8c8a3c35-3b5d-4f0a-9d76-6a8f3c3f2d11";

function renderDialog(requireScopedSubareaSelection = false) {
	const queryClient = new QueryClient({
		defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<CoverageRuleDialog
				open
				onOpenChange={vi.fn()}
				onSuccess={vi.fn()}
				editingRule={null}
				requireScopedSubareaSelection={requireScopedSubareaSelection}
				locations={[
					{
						id: "location-1",
						name: "Berlin",
						subareas: [{ id: SUBAREA_ID, name: "Front desk", isActive: true }],
					},
				]}
			/>
		</QueryClientProvider>,
	);
}

const createButton = () => screen.getByRole("button", { name: "Create" }) as HTMLButtonElement;

describe("CoverageRuleDialog validation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.createCoverageRule.mockResolvedValue({ success: true, data: { id: "rule-1" } });
	});

	it("shows the missing subarea inline and does not submit", async () => {
		renderDialog();

		fireEvent.click(createButton());

		expect(await screen.findByText("Select a subarea.")).toBeTruthy();
		expect(createButton().disabled).toBe(true);
		expect(mocks.createCoverageRule).not.toHaveBeenCalled();
	});

	it("requires the end time to follow the start time, as the server does", async () => {
		renderDialog(true);

		fireEvent.change(screen.getByLabelText("End Time"), { target: { value: "08:00" } });

		expect(
			await screen.findByText("End time must be after the start time on the same day."),
		).toBeTruthy();
		expect(screen.getByLabelText("End Time").getAttribute("aria-invalid")).toBe("true");
		expect(createButton().disabled).toBe(true);

		// Moving the start re-checks the end.
		fireEvent.change(screen.getByLabelText("Start Time"), { target: { value: "06:00" } });
		await waitFor(() => {
			expect(
				screen.queryByText("End time must be after the start time on the same day."),
			).toBeNull();
		});
		expect(createButton().disabled).toBe(false);
	});

	it("keeps the staff count within the server's 1 to 100 whole numbers", async () => {
		renderDialog(true);

		const staffCount = screen.getByLabelText("Minimum Staff Count");
		fireEvent.change(staffCount, { target: { value: "101" } });
		expect(await screen.findByText("Enter a whole number from 1 to 100.")).toBeTruthy();

		fireEvent.change(staffCount, { target: { value: "" } });
		expect((staffCount as HTMLInputElement).value).toBe("");
		expect(screen.getByText("Enter a whole number from 1 to 100.")).toBeTruthy();
		expect(createButton().disabled).toBe(true);

		fireEvent.change(staffCount, { target: { value: "3" } });
		await waitFor(() => {
			expect(screen.queryByText("Enter a whole number from 1 to 100.")).toBeNull();
		});
		fireEvent.click(createButton());

		await waitFor(() => {
			expect(mocks.createCoverageRule).toHaveBeenCalledWith({
				subareaId: SUBAREA_ID,
				dayOfWeek: "monday",
				startTime: "09:00",
				endTime: "17:00",
				minimumStaffCount: 3,
			});
		});
	});
});
