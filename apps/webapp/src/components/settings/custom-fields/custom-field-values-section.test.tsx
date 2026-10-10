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
				section={{ fields: [], values: {}, missingRequiredFieldIds: [] }}
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
		});

		const desk = screen.getByLabelText("Desk *");
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
			},
			{ desk: "7.01" },
		);
		expect((screen.getByLabelText("Desk *") as HTMLInputElement).value).toBe("7.01");
		expect(screen.getByText("Missing required values")).toBeTruthy();
	});
});
