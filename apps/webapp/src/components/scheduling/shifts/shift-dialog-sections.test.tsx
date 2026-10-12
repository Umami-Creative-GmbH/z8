/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { AppLocaleProvider } from "@/components/providers/app-locale-provider";
import type { StaffingSuggestion } from "@/lib/scheduling/staffing/types";
import { ShiftDialogSections } from "./shift-dialog-sections";
import { useShiftDialogForm } from "./use-shift-dialog-form";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));

const suggestion: StaffingSuggestion = {
	employeeId: "employee-7",
	displayName: "Anna Berg",
	warnings: [],
	notes: [],
	reasons: [{ type: "noContractedTarget" }],
	requestedThisShift: false,
	remainingContractedMinutes: null,
};

function Sections({
	defaultDate,
	isManager = true,
	staffing = null,
	onSubmit = vi.fn(),
}: {
	defaultDate: string;
	isManager?: boolean;
	staffing?: ComponentProps<typeof ShiftDialogSections>["staffing"];
	onSubmit?: () => void;
}) {
	const { form, formValues } = useShiftDialogForm({
		open: true,
		shift: null,
		templates: [],
		defaultDate,
		organizationTimezone: "Europe/Berlin",
		onSubmit,
	});

	return (
		<>
			<ShiftDialogSections
				form={form}
				formValues={formValues}
				isManager={isManager}
				templates={[]}
				locations={[]}
				employees={[]}
				skillValidation={null}
				isValidatingSkills={false}
				isEditing={false}
				shift={null}
				organizationTimezone="Europe/Berlin"
				staffing={staffing}
			/>
			<output data-testid="date-value">{formValues.date}</output>
			<output data-testid="employee-value">{formValues.employeeId ?? "open"}</output>
		</>
	);
}

describe("ShiftDialogSections date", () => {
	it("shows the shift date in the app language", () => {
		render(
			<AppLocaleProvider locale="de">
				<Sections defaultDate="2026-10-23" />
			</AppLocaleProvider>,
		);

		const trigger = screen.getByLabelText("Date");
		expect(trigger.textContent).toBe("23. Okt. 2026");
		fireEvent.click(trigger);

		expect(screen.getByText("Oktober 2026")).toBeTruthy();
	});

	it("stores the picked civil date as YYYY-MM-DD", () => {
		render(<Sections defaultDate="2026-10-23" />);

		fireEvent.click(screen.getByLabelText("Date"));
		fireEvent.click(screen.getByRole("button", { name: /October 5th, 2026/ }));

		expect(screen.getByTestId("date-value").textContent).toBe("2026-10-05");
	});

	it("disables the date for non-managers", () => {
		render(<Sections defaultDate="2026-10-23" isManager={false} />);

		expect(screen.getByLabelText("Date")).toHaveProperty("disabled", true);
	});
});

describe("ShiftDialogSections staffing suggestions", () => {
	it("fills Assign To with the picked candidate without saving", () => {
		const onSubmit = vi.fn();
		render(
			<Sections
				defaultDate="2026-10-23"
				onSubmit={onSubmit}
				staffing={{ suggestions: [suggestion], isLoading: false, isError: false }}
			/>,
		);

		expect(screen.getByTestId("employee-value").textContent).toBe("open");
		fireEvent.click(screen.getByRole("button", { name: "Assign {name}" }));

		expect(screen.getByTestId("employee-value").textContent).toBe("employee-7");
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("shows no suggestions without an open shift to staff", () => {
		render(<Sections defaultDate="2026-10-23" />);

		expect(screen.queryByText("Suggested employees")).toBeNull();
	});

	it("shows no suggestions to non-managers", () => {
		render(
			<Sections
				defaultDate="2026-10-23"
				isManager={false}
				staffing={{ suggestions: [suggestion], isLoading: false, isError: false }}
			/>,
		);

		expect(screen.queryByText("Suggested employees")).toBeNull();
	});
});
