// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
// Next.js syncs `useSearchParams` with `history.replaceState`; the mock does the same.
vi.mock("next/navigation", async () => {
	const { useSyncExternalStore } = await import("react");
	const listeners = new Set<() => void>();
	const replaceState = window.history.replaceState.bind(window.history);
	window.history.replaceState = (...args: Parameters<History["replaceState"]>) => {
		replaceState(...args);
		for (const listener of listeners) listener();
	};
	const subscribe = (listener: () => void) => {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	};
	return {
		useSearchParams: () =>
			new URLSearchParams(useSyncExternalStore(subscribe, () => window.location.search)),
	};
});

const ALL_ENTITIES = ["employee", "project", "customer"] as const;

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
		window.history.replaceState(null, "", "/settings/custom-fields");
	});

	afterEach(cleanup);

	it("shows only the Employees tab when the projects module is off, even for ?tab=projects", () => {
		window.history.replaceState(null, "", "/settings/custom-fields?tab=projects");
		render(
			<CustomFieldsSettings
				entities={["employee"]}
				initialFields={[
					definition({ id: "a", name: "Personnel number" }),
					definition({ id: "d", entity: "project", name: "Site ID" }),
				]}
			/>,
		);

		expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Employees"]);
		expect(screen.getByRole("tab", { name: "Employees" }).getAttribute("aria-selected")).toBe(
			"true",
		);
		expect(screen.getByText("Personnel number")).toBeTruthy();
		expect(screen.queryByText("Site ID")).toBeNull();
	});

	it("falls back to Employees for ?tab=customers when the projects module is off", () => {
		window.history.replaceState(null, "", "/settings/custom-fields?tab=customers");
		render(
			<CustomFieldsSettings
				entities={["employee"]}
				initialFields={[definition({ id: "a", name: "Personnel number" })]}
			/>,
		);

		expect(screen.getByRole("tab", { name: "Employees" }).getAttribute("aria-selected")).toBe(
			"true",
		);
		expect(screen.getByText("Personnel number")).toBeTruthy();
	});

	it("opens the tab named by ?tab= when the projects module is on", () => {
		window.history.replaceState(null, "", "/settings/custom-fields?tab=projects");
		render(
			<CustomFieldsSettings
				entities={ALL_ENTITIES}
				initialFields={[
					definition({ id: "a", name: "Personnel number" }),
					definition({ id: "d", entity: "project", name: "Site ID" }),
				]}
			/>,
		);

		expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
			"Employees",
			"Projects",
			"Customers",
		]);
		expect(screen.getByRole("tab", { name: "Projects" }).getAttribute("aria-selected")).toBe(
			"true",
		);
		expect(screen.getByText("Site ID")).toBeTruthy();
		expect(screen.queryByText("Personnel number")).toBeNull();
	});

	it("keeps the selected tab in ?tab=", async () => {
		render(<CustomFieldsSettings entities={ALL_ENTITIES} initialFields={[]} />);

		await userEvent.click(screen.getByRole("tab", { name: "Customers" }));

		expect(new URLSearchParams(window.location.search).get("tab")).toBe("customers");
		expect(screen.getByRole("tab", { name: "Customers" }).getAttribute("aria-selected")).toBe(
			"true",
		);
	});

	it("lists the entity's active fields in order and its archived fields apart", () => {
		render(
			<CustomFieldsSettings
				entities={ALL_ENTITIES}
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
				entities={ALL_ENTITIES}
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
		render(<CustomFieldsSettings entities={ALL_ENTITIES} initialFields={[field]} />);

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
		render(
			<CustomFieldsSettings
				entities={ALL_ENTITIES}
				initialFields={[definition({ id: "a", archived: true })]}
			/>,
		);

		await userEvent.click(screen.getByRole("button", { name: "Restore Personnel number" }));

		await waitFor(() =>
			expect(toastMock.error).toHaveBeenCalledWith(
				"An active custom field on this record type already has this name.",
			),
		);
	});

	it("creates a field from the dialog", async () => {
		changeMock.mockResolvedValue({ success: true, data: { ok: true, fields: [] } });
		render(<CustomFieldsSettings entities={ALL_ENTITIES} initialFields={[]} />);

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
