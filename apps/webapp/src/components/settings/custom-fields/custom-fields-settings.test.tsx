// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomFieldDefinitionView } from "@/lib/organization/custom-fields/definitions";
import { CustomFieldsSettings } from "./custom-fields-settings";

const { changeMock, toastMock } = vi.hoisted(() => ({
	changeMock: vi.fn(),
	toastMock: { success: vi.fn(), error: vi.fn() },
}));

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
vi.mock("@/app/[locale]/(app)/settings/custom-fields/actions", () => ({
	changeCustomFields: changeMock,
}));
vi.mock("sonner", () => ({ toast: toastMock }));

function definition(overrides: Partial<CustomFieldDefinitionView> = {}): CustomFieldDefinitionView {
	return {
		id: "f-1",
		entity: "employee",
		name: "Personnel number",
		type: "text",
		required: false,
		tracked: false,
		visibility: "manager",
		editLevel: "admin",
		number: null,
		position: 0,
		archived: false,
		options: [],
		...overrides,
	};
}

describe("CustomFieldsSettings", () => {
	beforeEach(() => {
		changeMock.mockReset();
		toastMock.success.mockReset();
		toastMock.error.mockReset();
	});

	it("lists the entity's active fields in order and its archived fields apart", () => {
		render(
			<CustomFieldsSettings
				initialFields={[
					definition({ id: "a", name: "Personnel number", position: 0 }),
					definition({ id: "b", name: "Agreement group", type: "select", position: 1 }),
					definition({ id: "c", name: "Old badge", archived: true, position: 2 }),
					definition({ id: "d", entity: "project", name: "Site ID" }),
				]}
			/>,
		);

		const active = screen.getByRole("list", { name: "Active custom fields" });
		expect(
			within(active)
				.getAllByRole("listitem")
				.map((item) => within(item).getByTestId("custom-field-name").textContent),
		).toEqual(["Personnel number", "Agreement group"]);
		const archived = screen.getByRole("list", { name: "Archived custom fields" });
		expect(within(archived).getByText("Old badge")).toBeTruthy();
		expect(screen.queryByText("Site ID")).toBeNull();
	});

	it("disables adding a field once the entity has 25 active fields", () => {
		render(
			<CustomFieldsSettings
				initialFields={Array.from({ length: 25 }, (_, i) =>
					definition({ id: `f-${i}`, name: `Field ${i}`, position: i }),
				)}
			/>,
		);

		expect(
			(screen.getByRole("button", { name: "Add custom field" }) as HTMLButtonElement).disabled,
		).toBe(true);
		expect(screen.getByText(/at most 25 active custom fields/)).toBeTruthy();
	});

	it("archives a field and shows the refreshed list", async () => {
		const field = definition({ id: "a" });
		changeMock.mockResolvedValue({
			success: true,
			data: { ok: true, fields: [{ ...field, archived: true }] },
		});
		render(<CustomFieldsSettings initialFields={[field]} />);

		await userEvent.click(screen.getByRole("button", { name: "Archive Personnel number" }));

		expect(changeMock).toHaveBeenCalledWith({ kind: "archive", fieldId: "a" });
		await waitFor(() =>
			expect(
				within(screen.getByRole("list", { name: "Archived custom fields" })).getByText(
					"Personnel number",
				),
			).toBeTruthy(),
		);
	});

	it("shows why the server refused a change", async () => {
		changeMock.mockResolvedValue({ success: true, data: { ok: false, reason: "name_taken" } });
		render(<CustomFieldsSettings initialFields={[definition({ id: "a", archived: true })]} />);

		await userEvent.click(screen.getByRole("button", { name: "Restore Personnel number" }));

		await waitFor(() =>
			expect(toastMock.error).toHaveBeenCalledWith(
				"An active custom field on this record type already has this name.",
			),
		);
	});

	it("creates a field from the dialog", async () => {
		changeMock.mockResolvedValue({ success: true, data: { ok: true, fields: [] } });
		render(<CustomFieldsSettings initialFields={[]} />);

		await userEvent.click(screen.getByRole("button", { name: "Add custom field" }));
		await userEvent.type(screen.getByLabelText("Name"), "Cost centre");
		await userEvent.click(screen.getByRole("button", { name: "Create field" }));

		await waitFor(() =>
			expect(changeMock).toHaveBeenCalledWith({
				kind: "create",
				entity: "employee",
				name: "Cost centre",
				type: "text",
				required: false,
				tracked: false,
				visibility: "admin",
				editLevel: "admin",
				number: null,
				options: [],
			}),
		);
	});
});
