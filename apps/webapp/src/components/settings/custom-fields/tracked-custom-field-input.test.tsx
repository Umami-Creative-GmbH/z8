// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CustomFieldHistoryDraft } from "@/lib/organization/custom-fields/history-rules";
import type { CustomFieldSectionField } from "@/lib/organization/custom-fields/values";
import { TrackedCustomFieldInput } from "./tracked-custom-field-input";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) => {
			let translated = fallback;
			for (const [key, value] of Object.entries(params ?? {})) {
				translated = translated.replace(`{${key}}`, String(value));
			}
			return translated;
		},
	}),
}));
vi.mock("@/components/providers/app-locale-provider", () => ({ useAppLocale: () => "en" }));

const grade: CustomFieldSectionField = {
	id: "grade",
	entity: "employee",
	name: "Pay grade",
	type: "text",
	required: true,
	tracked: true,
	visibility: "manager",
	editLevel: "manager",
	number: null,
	position: 0,
	archived: false,
	options: [],
	editable: true,
};

const entries: CustomFieldHistoryDraft[] = [
	{ key: "e-jul", entryId: "e-jul", validFrom: "2026-07-01", value: { type: "text", value: "E6" } },
	{ key: "e-mar", entryId: "e-mar", validFrom: "2026-03-01", value: { type: "text", value: "E5" } },
];

function renderInput(
	props: Partial<Parameters<typeof TrackedCustomFieldInput>[0]> = {},
): ReturnType<typeof vi.fn> {
	const onChange = vi.fn();
	render(
		<TrackedCustomFieldInput
			field={grade}
			entries={entries}
			today="2026-06-30"
			missing={false}
			onChange={onChange}
			{...props}
		/>,
	);
	return onChange;
}

describe("TrackedCustomFieldInput", () => {
	it("shows the value as of today and the history newest first", () => {
		renderInput();
		expect(screen.getByText("Pay grade *")).toBeTruthy();
		expect(screen.getByTestId("custom-field-today-grade").textContent).toBe("E5");
		const rows = within(screen.getByRole("list", { name: "History of Pay grade" })).getAllByRole(
			"listitem",
		);
		expect(rows.map((row) => row.textContent)).toEqual([
			expect.stringContaining("E6"),
			expect.stringContaining("E5"),
		]);
	});

	it("adds a change valid from today", async () => {
		const onChange = renderInput();
		await userEvent.click(screen.getByRole("button", { name: "Add change" }));
		await userEvent.type(screen.getByLabelText("Value"), "E7");
		await userEvent.click(screen.getByRole("button", { name: "Apply" }));
		expect(onChange).toHaveBeenLastCalledWith([
			expect.objectContaining({ entryId: "e-jul", validFrom: "2026-07-01" }),
			expect.objectContaining({
				entryId: null,
				validFrom: "2026-06-30",
				value: { type: "text", value: "E7" },
			}),
			expect.objectContaining({ entryId: "e-mar", validFrom: "2026-03-01" }),
		]);
	});

	it("refuses a second value on the same valid-from date", async () => {
		const onChange = renderInput({ today: "2026-03-01" });
		await userEvent.click(screen.getByRole("button", { name: "Add change" }));
		await userEvent.type(screen.getByLabelText("Value"), "E7");
		await userEvent.click(screen.getByRole("button", { name: "Apply" }));
		expect(screen.getByRole("alert").textContent).toContain(
			"There is already a value valid from this date.",
		);
		expect(onChange).not.toHaveBeenCalled();
	});

	it("corrects and deletes entries", async () => {
		const onChange = renderInput();
		await userEvent.click(
			screen.getAllByRole("button", { name: /Correct the value valid from/ })[0],
		);
		const value = screen.getByLabelText("Value");
		await userEvent.clear(value);
		await userEvent.type(value, "E6a");
		await userEvent.click(screen.getByRole("button", { name: "Apply" }));
		expect(onChange).toHaveBeenLastCalledWith([
			expect.objectContaining({ entryId: "e-jul", value: { type: "text", value: "E6a" } }),
			expect.objectContaining({ entryId: "e-mar" }),
		]);

		await userEvent.click(
			screen.getAllByRole("button", { name: /Delete the value valid from/ })[1],
		);
		expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ entryId: "e-jul" })]);
	});

	it("is read-only without a change handler", () => {
		renderInput({ onChange: undefined });
		expect(screen.queryByRole("button", { name: "Add change" })).toBeNull();
		expect(screen.queryByRole("button", { name: /Delete the value/ })).toBeNull();
	});
});
