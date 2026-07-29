/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { WebhookFormDialog } from "./webhook-form-dialog";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string) => fallback,
	}),
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/components/ui/action-panel", () => ({
	ActionPanel: ({ open, children }: { open: boolean; children: ReactNode }) =>
		open ? <div>{children}</div> : null,
	ActionPanelBody: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	ActionPanelContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	ActionPanelDescription: ({ children }: { children: ReactNode }) => (
		<p>{children}</p>
	),
	ActionPanelFooter: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	ActionPanelHeader: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	ActionPanelTitle: ({ children }: { children: ReactNode }) => (
		<h2>{children}</h2>
	),
}));

vi.mock("@/components/webhooks/webhook-secret-dialog", () => ({
	WebhookSecretDialog: () => null,
}));

const CATEGORY_EXAMPLES = [
	["Absences", "absence_request_submitted"],
	["Approvals", "approval_request_submitted"],
	["Time Tracking", "time_correction_submitted"],
	["Shifts", "schedule_published"],
	["Projects", "project_budget_warning_70"],
	["Teams", "team_member_added"],
	["Security", "password_changed"],
	["Reminders", "birthday_reminder"],
] as const;

function expectAllCategoriesExpanded() {
	for (const [, event] of CATEGORY_EXAMPLES) {
		expect(screen.getByText(event)).toBeTruthy();
	}
}

function Harness() {
	const [renderVersion, setRenderVersion] = useState(0);
	const [formKey, setFormKey] = useState(0);

	return (
		<>
			<button
				type="button"
				onClick={() => setRenderVersion((version) => version + 1)}
			>
				Rerender parent
			</button>
			<button type="button" onClick={() => setFormKey((key) => key + 1)}>
				Replace form
			</button>
			<WebhookFormDialog
				key={formKey}
				organizationId={`org-${renderVersion}`}
				open
				onOpenChange={vi.fn()}
				onSuccess={vi.fn()}
			/>
		</>
	);
}

describe("WebhookFormDialog", () => {
	it("restores all expanded categories and form defaults after keyed replacement", async () => {
		const user = userEvent.setup();

		render(<Harness />);

		expectAllCategoriesExpanded();
		await user.type(screen.getByLabelText("Name"), "Changed name");

		await user.click(screen.getByRole("button", { name: "Rerender parent" }));
		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
			"Changed name",
		);

		for (const [category] of CATEGORY_EXAMPLES) {
			await user.click(screen.getByRole("button", { name: category }));
		}
		await waitFor(() => {
			for (const [, event] of CATEGORY_EXAMPLES) {
				expect(screen.queryByText(event)).toBeNull();
			}
		});

		await user.click(screen.getByRole("button", { name: "Replace form" }));
		await waitFor(expectAllCategoriesExpanded);
		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
	});
});
