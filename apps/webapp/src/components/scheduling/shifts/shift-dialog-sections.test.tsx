/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppLocaleProvider } from "@/components/providers/app-locale-provider";
import { ShiftDialogSections } from "./shift-dialog-sections";
import { useShiftDialogForm } from "./use-shift-dialog-form";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

function Sections({ defaultDate, isManager = true }: { defaultDate: string; isManager?: boolean }) {
	const { form, formValues } = useShiftDialogForm({
		open: true,
		shift: null,
		templates: [],
		defaultDate,
		organizationTimezone: "Europe/Berlin",
		onSubmit: vi.fn(),
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
			/>
			<output data-testid="date-value">{formValues.date}</output>
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
