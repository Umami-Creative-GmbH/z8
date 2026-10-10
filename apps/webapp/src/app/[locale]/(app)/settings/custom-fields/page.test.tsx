import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	findOrganization: vi.fn(),
	listCustomFieldDefinitions: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
	requireOrgAdminSettingsAccess: async () => ({ organizationId: "org-1" }),
}));
vi.mock("@/db", () => ({
	db: { query: { organization: { findFirst: mockState.findOrganization } } },
}));
vi.mock("@/db/auth-schema", () => ({ organization: { id: "organization.id" } }));
vi.mock("@/lib/organization/custom-fields/definitions", () => ({
	listCustomFieldDefinitions: mockState.listCustomFieldDefinitions,
}));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("@/components/settings/custom-fields/custom-fields-settings", () => ({
	CustomFieldsSettings: "CustomFieldsSettings",
}));

const { default: CustomFieldsSettingsPage } = await import("./page");

type Element = ReactElement<{ children?: ReactNode; [prop: string]: unknown }>;

function findSettings(node: ReactNode): Element | null {
	if (Array.isArray(node)) {
		for (const child of node) {
			const found = findSettings(child);
			if (found) return found;
		}
		return null;
	}
	if (!node || typeof node !== "object" || !("props" in node)) return null;
	const element = node as Element;
	if (element.type === "CustomFieldsSettings") return element;
	return findSettings(element.props.children);
}

/** Renders the page's async content and returns the settings element it passes data to. */
async function renderSettings() {
	const page = CustomFieldsSettingsPage() as Element;
	const content = page.props.children as ReactElement<object, () => Promise<ReactNode>>;
	const settings = findSettings(await content.type());
	if (!settings) throw new Error("CustomFieldsSettings not rendered");
	return settings.props;
}

describe("CustomFieldsSettingsPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.listCustomFieldDefinitions.mockResolvedValue([]);
	});

	it("shows only employee custom fields when the projects module is off", async () => {
		mockState.findOrganization.mockResolvedValue({ projectsEnabled: false });

		const props = await renderSettings();

		expect(props.entities).toEqual(["employee"]);
		expect(mockState.listCustomFieldDefinitions).toHaveBeenCalledWith(expect.anything(), "org-1", [
			"employee",
		]);
	});

	it("shows employee, project and customer custom fields when the projects module is on", async () => {
		mockState.findOrganization.mockResolvedValue({ projectsEnabled: true });

		const props = await renderSettings();

		expect(props.entities).toEqual(["employee", "project", "customer"]);
		expect(mockState.listCustomFieldDefinitions).toHaveBeenCalledWith(expect.anything(), "org-1", [
			"employee",
			"project",
			"customer",
		]);
	});
});
