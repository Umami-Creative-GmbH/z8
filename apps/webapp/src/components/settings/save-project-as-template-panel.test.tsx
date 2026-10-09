/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SaveProjectAsTemplatePanel } from "./save-project-as-template-panel";

const fromTemplateActions = vi.hoisted(() => ({ saveProjectAsTemplate: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));

vi.mock("@/app/[locale]/(app)/settings/projects/from-template-actions", () => fromTemplateActions);
vi.mock("sonner", () => ({ toast }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			params
				? fallback.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match))
				: fallback,
	}),
}));

function renderPanel() {
	const onOpenChange = vi.fn();
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<SaveProjectAsTemplatePanel
				organizationId="org-1"
				project={{ id: "project-1", name: "Acme relaunch" }}
				open
				onOpenChange={onOpenChange}
			/>
		</QueryClientProvider>,
	);
	return { onOpenChange };
}

describe("SaveProjectAsTemplatePanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fromTemplateActions.saveProjectAsTemplate.mockResolvedValue({
			success: true,
			data: { id: "template-1", name: "Acme relaunch", skipped: [] },
		});
	});

	it("saves the project as a template named after it", async () => {
		const user = userEvent.setup();
		const { onOpenChange } = renderPanel();

		const form = await screen.findByRole("form", { name: "Save Acme relaunch as a template" });
		expect(within(form).getByLabelText(/^Template name/)).toHaveProperty("value", "Acme relaunch");
		await user.click(within(form).getByRole("button", { name: "Save as template" }));

		expect(fromTemplateActions.saveProjectAsTemplate).toHaveBeenCalledWith("project-1", {
			name: "Acme relaunch",
		});
		expect(toast.success).toHaveBeenCalledWith("Template Acme relaunch saved");
		expect(toast.warning).not.toHaveBeenCalled();
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("takes another name, and reports the members it left out", async () => {
		const user = userEvent.setup();
		fromTemplateActions.saveProjectAsTemplate.mockResolvedValue({
			success: true,
			data: {
				id: "template-1",
				name: "Relaunch blueprint",
				skipped: [{ role: "manager", name: "Lee Left", reason: "departed" }],
			},
		});
		renderPanel();

		const form = await screen.findByRole("form", { name: "Save Acme relaunch as a template" });
		const name = within(form).getByLabelText(/^Template name/);
		await user.clear(name);
		await user.type(name, "Relaunch blueprint");
		await user.click(within(form).getByRole("button", { name: "Save as template" }));

		expect(fromTemplateActions.saveProjectAsTemplate).toHaveBeenCalledWith("project-1", {
			name: "Relaunch blueprint",
		});
		expect(toast.warning).toHaveBeenCalledWith("Not copied: Lee Left (left the organization)");
	});

	it("does not save without a name, and reports a refused save", async () => {
		const user = userEvent.setup();
		fromTemplateActions.saveProjectAsTemplate.mockResolvedValue({
			success: false,
			error: "A project template with this name already exists",
		});
		const { onOpenChange } = renderPanel();

		const form = await screen.findByRole("form", { name: "Save Acme relaunch as a template" });
		await user.clear(within(form).getByLabelText(/^Template name/));
		await user.click(within(form).getByRole("button", { name: "Save as template" }));
		expect(fromTemplateActions.saveProjectAsTemplate).not.toHaveBeenCalled();
		expect(within(form).getByText("Enter a template name")).toBeTruthy();

		await user.type(within(form).getByLabelText(/^Template name/), "Website relaunch");
		await user.click(within(form).getByRole("button", { name: "Save as template" }));

		expect(toast.error).toHaveBeenCalledWith("A project template with this name already exists");
		expect(onOpenChange).not.toHaveBeenCalledWith(false);
	});
});
