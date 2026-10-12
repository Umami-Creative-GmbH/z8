// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
	CustomFieldSection,
	CustomFieldSectionField,
} from "@/lib/organization/custom-fields/values";
import { CustomFieldValuesSection } from "./custom-field-values-section";

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

function field(overrides: Partial<CustomFieldSectionField> = {}): CustomFieldSectionField {
	return {
		id: "f-1",
		entity: "employee",
		name: "Desk",
		type: "text",
		required: false,
		tracked: false,
		visibility: "manager",
		editLevel: "manager",
		number: null,
		position: 0,
		archived: false,
		options: [],
		editable: true,
		...overrides,
	};
}

function renderSection(section: CustomFieldSection, drafts: Record<string, string> = {}) {
	const onDraftChange = vi.fn();
	render(
		<CustomFieldValuesSection section={section} drafts={drafts} onDraftChange={onDraftChange} />,
	);
	return onDraftChange;
}

describe("CustomFieldValuesSection", () => {
	it("renders nothing when the viewer sees no field", () => {
		const { container } = render(
			<CustomFieldValuesSection
				section={{
					fields: [],
					values: {},
					missingRequiredFieldIds: [],
					history: {},
					today: "2026-10-10",
				}}
				drafts={{}}
				onDraftChange={() => {}}
			/>,
		);
		expect(container.innerHTML).toBe("");
	});

	it("edits the fields the viewer may change and shows the others read-only", async () => {
		const onDraftChange = renderSection({
			fields: [
				field({ id: "desk", name: "Desk", required: true }),
				field({
					id: "tier",
					name: "Tier",
					type: "select",
					editable: false,
					options: [{ id: "gold", label: "Gold", position: 0, archived: true }],
				}),
				field({ id: "badge", name: "Badge", type: "boolean", editable: false }),
			],
			values: {
				desk: { type: "text", value: "4.12" },
				tier: { type: "select", value: "gold" },
				badge: { type: "boolean", value: false },
			},
			missingRequiredFieldIds: [],
			history: {},
			today: "2026-10-10",
		});

		const desk = screen.getByLabelText(/^Desk\s*\*$/);
		expect((desk as HTMLInputElement).value).toBe("4.12");
		await userEvent.type(desk, "a");
		expect(onDraftChange).toHaveBeenLastCalledWith("desk", "4.12a");

		expect(screen.getByText("Tier")).toBeTruthy();
		expect(screen.getByText("Gold (archived)")).toBeTruthy();
		expect(screen.getByText("No")).toBeTruthy();
		expect(screen.queryByLabelText("Tier")).toBeNull();
	});

	it("shows a draft over the stored value, and the missing required values indicator", () => {
		renderSection(
			{
				fields: [field({ id: "desk", name: "Desk", required: true })],
				values: {},
				missingRequiredFieldIds: ["desk"],
				history: {},
				today: "2026-10-10",
			},
			{ desk: "7.01" },
		);
		expect((screen.getByLabelText(/^Desk\s*\*$/) as HTMLInputElement).value).toBe("7.01");
		expect(screen.getByText("Missing required values")).toBeTruthy();
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("marks an empty required field invalid with its message, like the form fields", () => {
		renderSection({
			fields: [field({ id: "desk", name: "Desk", required: true })],
			values: {},
			missingRequiredFieldIds: ["desk"],
			history: {},
			today: "2026-10-10",
		});
		const desk = screen.getByLabelText(/^Desk\s*\*$/);
		const message = screen.getByRole("alert");
		expect(message.textContent).toBe("This field is required.");
		expect(desk.getAttribute("aria-invalid")).toBe("true");
		expect(desk.getAttribute("aria-describedby")).toBe(message.id);
	});

	it("shows tracked fields with their history, editable only at the edit level", () => {
		const history = {
			grade: [{ id: "e-1", validFrom: "2026-03-01", value: { type: "text", value: "E5" } }],
			band: [{ id: "e-2", validFrom: "2026-01-01", value: { type: "text", value: "B1" } }],
		} as const;
		render(
			<CustomFieldValuesSection
				section={{
					fields: [
						field({ id: "grade", name: "Pay grade", tracked: true }),
						field({ id: "band", name: "Band", tracked: true, editable: false }),
					],
					values: {
						grade: { type: "text", value: "E5" },
						band: { type: "text", value: "B1" },
					},
					missingRequiredFieldIds: [],
					history: { grade: [...history.grade], band: [...history.band] },
					today: "2026-10-10",
				}}
				drafts={{}}
				onDraftChange={() => {}}
				onHistoryChange={() => {}}
			/>,
		);
		expect(screen.getByRole("list", { name: "History of Pay grade" })).toBeTruthy();
		expect(screen.getByRole("list", { name: "History of Band" })).toBeTruthy();
		expect(screen.getAllByRole("button", { name: "Add change" })).toHaveLength(1);
		// No plain value input: tracked fields take dated changes.
		expect(screen.queryByRole("textbox")).toBeNull();
	});
});
