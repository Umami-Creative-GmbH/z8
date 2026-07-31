/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useLayoutEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebhookFormDialog } from "./webhook-form-dialog";

const mocks = vi.hoisted(() => ({
	createWebhook: vi.fn(),
	onSuccess: vi.fn(),
	refresh: vi.fn(),
	toastError: vi.fn(),
	toastSuccess: vi.fn(),
	updateWebhook: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, values?: { count?: number }) =>
			values?.count === undefined
				? fallback
				: fallback.replace("{{count}}", String(values.count)),
	}),
}));

vi.mock("sonner", () => ({
	toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/app/[locale]/(app)/settings/webhooks/actions", () => ({
	createWebhook: mocks.createWebhook,
	updateWebhook: mocks.updateWebhook,
}));

vi.mock("@/components/ui/action-panel", () => ({
	ActionPanel: ({ children, open }: { children: ReactNode; open: boolean }) =>
		open ? <section>{children}</section> : null,
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

const createdEndpoint = {
	id: "webhook-1",
	organizationId: "org-1",
	name: "Payroll",
	url: "https://example.com/payroll",
	description: null,
	subscribedEvents: ["absence_request_approved"],
	isActive: true,
};

const editableWebhook = {
	...createdEndpoint,
	description: "Payroll notifications",
	createdAt: new Date("2026-01-01T00:00:00Z"),
	updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const replacementWebhook = {
	...editableWebhook,
	id: "webhook-2",
	name: "Absence updates",
	url: "https://example.com/absences",
	description: "Absence notifications",
	subscribedEvents: ["absence_request_rejected"],
};

function Harness() {
	const [open, setOpen] = useState(true);

	return (
		<>
			{!open && (
				<button type="button" onClick={() => setOpen(true)}>
					Open webhook dialog
				</button>
			)}
			<WebhookFormDialog
				organizationId="org-1"
				open={open}
				onOpenChange={setOpen}
				onSuccess={mocks.onSuccess}
			/>
		</>
	);
}

function EditHarness() {
	const [open, setOpen] = useState(true);

	return (
		<>
			{!open && (
				<button type="button" onClick={() => setOpen(true)}>
					Open edit dialog
				</button>
			)}
			<WebhookFormDialog
				organizationId="org-1"
				webhook={editableWebhook}
				open={open}
				onOpenChange={setOpen}
				onSuccess={mocks.onSuccess}
			/>
		</>
	);
}

function ReplacementHarness({
	initialWebhook,
}: {
	initialWebhook?: typeof editableWebhook;
}) {
	const [open, setOpen] = useState(true);
	const [webhook, setWebhook] = useState(initialWebhook);

	return (
		<>
			<button type="button" onClick={() => setWebhook(replacementWebhook)}>
				Replace webhook
			</button>
			{!open && (
				<button type="button" onClick={() => setOpen(true)}>
					Open replacement dialog
				</button>
			)}
			<WebhookFormDialog
				organizationId="org-1"
				webhook={webhook}
				open={open}
				onOpenChange={setOpen}
				onSuccess={mocks.onSuccess}
			/>
		</>
	);
}

function renderCreateDialog() {
	return render(<Harness />);
}

function renderEditDialog() {
	return render(
		<WebhookFormDialog
			organizationId="org-1"
			webhook={editableWebhook}
			open
			onOpenChange={vi.fn()}
			onSuccess={mocks.onSuccess}
		/>,
	);
}

function formFor(buttonName: string) {
	const form = screen.getByRole("button", { name: buttonName }).closest("form");
	if (!form) throw new Error(`Form for ${buttonName} not found`);
	return form;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

async function fillCreateForm(user: ReturnType<typeof userEvent.setup>) {
	await user.type(screen.getByLabelText("Name"), "  Payroll  ");
	await user.type(
		screen.getByLabelText("Endpoint URL"),
		"  https://example.com/payroll  ",
	);
	await user.type(
		screen.getByLabelText("Description (optional)"),
		"  Payroll notifications  ",
	);
	await user.click(
		screen.getByRole("checkbox", { name: "absence_request_approved" }),
	);
}

describe("WebhookFormDialog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: vi.fn().mockResolvedValue(undefined) },
		});
	});

	it("renders explicit create defaults", () => {
		renderCreateDialog();

		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
		expect(
			(screen.getByLabelText("Endpoint URL") as HTMLInputElement).value,
		).toBe("");
		expect(
			(screen.getByLabelText("Description (optional)") as HTMLTextAreaElement)
				.value,
		).toBe("");
		expect(screen.getByText("Selected events: 0")).toBeTruthy();
	});

	it("loads edit defaults and submits the trimmed update payload", async () => {
		mocks.updateWebhook.mockResolvedValue({
			success: true,
			data: { endpoint: createdEndpoint },
		});
		const user = userEvent.setup();
		renderEditDialog();

		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
			"Payroll",
		);
		expect(
			(screen.getByLabelText("Endpoint URL") as HTMLInputElement).value,
		).toBe("https://example.com/payroll");
		expect(
			(screen.getByLabelText("Description (optional)") as HTMLTextAreaElement)
				.value,
		).toBe("Payroll notifications");
		expect(screen.getByText("Selected events: 1")).toBeTruthy();

		await user.clear(screen.getByLabelText("Name"));
		await user.type(screen.getByLabelText("Name"), "  Updated payroll  ");
		await user.clear(screen.getByLabelText("Description (optional)"));
		await user.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() => expect(mocks.updateWebhook).toHaveBeenCalledOnce());
		expect(mocks.updateWebhook).toHaveBeenCalledWith("webhook-1", {
			name: "Updated payroll",
			url: "https://example.com/payroll",
			description: undefined,
			subscribedEvents: ["absence_request_approved"],
		});
	});

	it("resets create values after canceling and reopening", async () => {
		const user = userEvent.setup();
		renderCreateDialog();
		await fillCreateForm(user);

		await user.click(screen.getByRole("button", { name: "Cancel" }));
		await user.click(
			screen.getByRole("button", { name: "Open webhook dialog" }),
		);

		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
		expect(
			(screen.getByLabelText("Endpoint URL") as HTMLInputElement).value,
		).toBe("");
		expect(screen.getByText("Selected events: 0")).toBeTruthy();
	});

	it("resets edit values after canceling and reopening", async () => {
		const user = userEvent.setup();
		render(<EditHarness />);
		await user.clear(screen.getByLabelText("Name"));
		await user.type(screen.getByLabelText("Name"), "Temporary name");
		await user.click(
			screen.getByRole("checkbox", { name: "absence_request_approved" }),
		);

		await user.click(screen.getByRole("button", { name: "Cancel" }));
		await user.click(screen.getByRole("button", { name: "Open edit dialog" }));

		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
			"Payroll",
		);
		expect(screen.getByText("Selected events: 1")).toBeTruthy();
		expect(
			screen
				.getByRole("checkbox", { name: "absence_request_approved" })
				.getAttribute("aria-checked"),
		).toBe("true");
	});

	it("synchronizes values when the edited webhook changes", async () => {
		const user = userEvent.setup();
		const { rerender } = renderEditDialog();
		await user.clear(screen.getByLabelText("Name"));
		await user.type(screen.getByLabelText("Name"), "Unsaved local edit");
		const nextWebhook = {
			...editableWebhook,
			id: "webhook-2",
			name: "Absence updates",
			url: "https://example.com/absences",
			description: "Absence notifications",
			subscribedEvents: ["absence_request_rejected"],
		};

		rerender(
			<WebhookFormDialog
				organizationId="org-1"
				webhook={nextWebhook}
				open
				onOpenChange={vi.fn()}
				onSuccess={mocks.onSuccess}
			/>,
		);

		await waitFor(() =>
			expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
				"Absence updates",
			),
		);
		expect(
			(screen.getByLabelText("Endpoint URL") as HTMLInputElement).value,
		).toBe("https://example.com/absences");
		expect(
			screen
				.getByRole("checkbox", { name: "absence_request_rejected" })
				.getAttribute("aria-checked"),
		).toBe("true");
		expect(
			screen
				.getByRole("checkbox", { name: "absence_request_approved" })
				.getAttribute("aria-checked"),
		).toBe("false");
	});

	it("names category checkboxes and exposes mixed selection", async () => {
		const user = userEvent.setup();
		renderCreateDialog();
		const categoryCheckbox = screen.getByRole("checkbox", { name: "Absences" });

		expect(categoryCheckbox.getAttribute("aria-checked")).toBe("false");
		await user.click(
			screen.getByRole("checkbox", { name: "absence_request_approved" }),
		);

		expect(categoryCheckbox.getAttribute("aria-checked")).toBe("mixed");
		expect(categoryCheckbox.hasAttribute("data-indeterminate")).toBe(true);
	});

	it("re-expands every event category when the webhook changes", async () => {
		const user = userEvent.setup();
		render(<ReplacementHarness initialWebhook={editableWebhook} />);
		const categories = [
			["Absences", "absence_request_submitted"],
			["Approvals", "approval_request_submitted"],
			["Time Tracking", "time_correction_submitted"],
			["Shifts", "schedule_published"],
			["Projects", "project_budget_warning_70"],
			["Teams", "team_member_added"],
			["Security", "password_changed"],
			["Reminders", "birthday_reminder"],
		] as const;

		for (const [category, event] of categories) {
			expect(screen.getByRole("checkbox", { name: event })).toBeTruthy();
			await user.click(screen.getByText(category));
			expect(screen.queryByRole("checkbox", { name: event })).toBeNull();
		}

		await user.click(screen.getByRole("button", { name: "Replace webhook" }));

		for (const [, event] of categories) {
			expect(await screen.findByRole("checkbox", { name: event })).toBeTruthy();
		}
	});

	it("preserves local state on parent rerender and resets on keyed replacement", async () => {
		function KeyedHarness() {
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
						onSuccess={mocks.onSuccess}
					/>
				</>
			);
		}

		const user = userEvent.setup();
		render(<KeyedHarness />);
		await user.type(screen.getByLabelText("Name"), "Changed name");
		await user.click(screen.getByText("Absences"));
		expect(
			screen.queryByRole("checkbox", { name: "absence_request_submitted" }),
		).toBeNull();

		await user.click(screen.getByRole("button", { name: "Rerender parent" }));
		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
			"Changed name",
		);
		expect(
			screen.queryByRole("checkbox", { name: "absence_request_submitted" }),
		).toBeNull();

		await user.click(screen.getByRole("button", { name: "Replace form" }));
		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
		expect(
			screen.getByRole("checkbox", { name: "absence_request_submitted" }),
		).toBeTruthy();
	}, 10_000);

	it("wires required validation to accessible TanStack field errors", async () => {
		renderCreateDialog();
		const form = formFor("Create Webhook");

		fireEvent.submit(form);
		expect(await screen.findByText("Name is required")).toBeTruthy();
		expect(screen.getByLabelText("Name").getAttribute("aria-invalid")).toBe(
			"true",
		);
		expect(
			screen.getByLabelText("Endpoint URL").getAttribute("aria-invalid"),
		).toBe("true");
		expect(
			screen
				.getByRole("group", { name: "Events to receive" })
				.getAttribute("aria-invalid"),
		).toBe("true");
		expect(mocks.toastError).toHaveBeenLastCalledWith("Name is required");

		fireEvent.change(screen.getByLabelText("Name"), {
			target: { value: "Payroll" },
		});
		fireEvent.submit(form);
		await waitFor(() =>
			expect(mocks.toastError).toHaveBeenLastCalledWith("URL is required"),
		);

		fireEvent.change(screen.getByLabelText("Endpoint URL"), {
			target: { value: "https://example.com/payroll" },
		});
		fireEvent.submit(form);
		await waitFor(() =>
			expect(mocks.toastError).toHaveBeenLastCalledWith(
				"At least one event must be selected",
			),
		);
		expect(
			screen.getByText("At least one event must be selected"),
		).toBeTruthy();
		expect(mocks.createWebhook).not.toHaveBeenCalled();
	});

	it("submits the create payload, resets on reopen, and clears the one-time secret", async () => {
		mocks.createWebhook.mockResolvedValue({
			success: true,
			data: { endpoint: createdEndpoint, secret: "whsec_once" },
		});
		const user = userEvent.setup();
		const writeText = vi
			.spyOn(navigator.clipboard, "writeText")
			.mockResolvedValue(undefined);
		renderCreateDialog();
		await fillCreateForm(user);
		await user.click(screen.getByRole("button", { name: "Create Webhook" }));

		await waitFor(() => expect(mocks.createWebhook).toHaveBeenCalledOnce());
		expect(mocks.createWebhook).toHaveBeenCalledWith({
			organizationId: "org-1",
			name: "Payroll",
			url: "https://example.com/payroll",
			description: "Payroll notifications",
			subscribedEvents: ["absence_request_approved"],
		});
		expect(mocks.onSuccess).toHaveBeenCalledWith(createdEndpoint);
		expect(
			(screen.getByLabelText("Signing Secret") as HTMLInputElement).value,
		).toBe("whsec_once");

		await user.click(
			screen.getByRole("button", { name: "Copy secret to clipboard" }),
		);
		expect(writeText).toHaveBeenCalledWith("whsec_once");
		await user.click(
			screen.getByRole("button", { name: "I've saved the secret" }),
		);
		expect(screen.queryByLabelText("Signing Secret")).toBeNull();

		await user.click(
			screen.getByRole("button", { name: "Open webhook dialog" }),
		);
		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
		expect(
			(screen.getByLabelText("Endpoint URL") as HTMLInputElement).value,
		).toBe("");
		expect(screen.getByText("Selected events: 0")).toBeTruthy();
		expect(screen.queryByLabelText("Signing Secret")).toBeNull();
	});

	it("disables submission while loading and recovers after a server error", async () => {
		let resolveRequest: (value: { success: false; error: string }) => void =
			() => undefined;
		mocks.createWebhook.mockReturnValue(
			new Promise((resolve) => {
				resolveRequest = resolve;
			}),
		);
		const user = userEvent.setup();
		renderCreateDialog();
		await fillCreateForm(user);
		const submitButton = screen.getByRole("button", {
			name: "Create Webhook",
		}) as HTMLButtonElement;
		await user.click(submitButton);

		await waitFor(() => expect(submitButton.disabled).toBe(true));
		expect(document.querySelector(".animate-spin")).toBeTruthy();
		resolveRequest({ success: false, error: "Creation failed" });

		await waitFor(() =>
			expect(mocks.toastError).toHaveBeenCalledWith("Creation failed"),
		);
		expect(submitButton.disabled).toBe(false);
		expect(mocks.onSuccess).not.toHaveBeenCalled();
	});

	it("shows a controlled create error and recovers when the action rejects", async () => {
		mocks.createWebhook.mockRejectedValueOnce(new Error("database internals"));
		const user = userEvent.setup();
		renderCreateDialog();
		await fillCreateForm(user);
		const submitButton = screen.getByRole("button", {
			name: "Create Webhook",
		}) as HTMLButtonElement;

		await user.click(submitButton);

		await waitFor(() =>
			expect(mocks.toastError).toHaveBeenCalledWith("Failed to create webhook"),
		);
		expect(submitButton.disabled).toBe(false);
		expect(mocks.onSuccess).not.toHaveBeenCalled();
	});

	it("shows a controlled update error and recovers when the action rejects", async () => {
		mocks.updateWebhook.mockRejectedValueOnce(new Error("database internals"));
		renderEditDialog();
		const submitButton = screen.getByRole("button", {
			name: "Save",
		}) as HTMLButtonElement;

		fireEvent.submit(formFor("Save"));

		await waitFor(() =>
			expect(mocks.toastError).toHaveBeenCalledWith("Failed to update webhook"),
		);
		expect(submitButton.disabled).toBe(false);
		expect(mocks.onSuccess).not.toHaveBeenCalled();
	});

	it("prevents duplicate submissions while the request is pending", async () => {
		mocks.createWebhook.mockReturnValue(new Promise(() => undefined));
		const user = userEvent.setup();
		renderCreateDialog();
		await fillCreateForm(user);
		const form = formFor("Create Webhook");

		fireEvent.submit(form);
		fireEvent.submit(form);

		await waitFor(() => expect(mocks.createWebhook).toHaveBeenCalledOnce());
	});

	it("does not close or restart an in-flight create request", async () => {
		const request = deferred<{
			success: true;
			data: { endpoint: typeof createdEndpoint; secret: string };
		}>();
		mocks.createWebhook.mockReturnValue(request.promise);
		const user = userEvent.setup();
		renderCreateDialog();
		await fillCreateForm(user);
		fireEvent.submit(formFor("Create Webhook"));
		await waitFor(() => expect(mocks.createWebhook).toHaveBeenCalledOnce());

		await user.click(screen.getByRole("button", { name: "Cancel" }));
		const reopenButton = screen.queryByRole("button", {
			name: "Open webhook dialog",
		});
		if (reopenButton) await user.click(reopenButton);
		fireEvent.submit(formFor("Create Webhook"));

		expect(mocks.createWebhook).toHaveBeenCalledOnce();
		expect(
			screen.queryByRole("button", { name: "Open webhook dialog" }),
		).toBeNull();
		request.resolve({
			success: true,
			data: { endpoint: createdEndpoint, secret: "whsec_pending" },
		});

		expect(
			((await screen.findByLabelText("Signing Secret")) as HTMLInputElement)
				.value,
		).toBe("whsec_pending");
		expect(mocks.onSuccess).toHaveBeenCalledOnce();
	});

	it("does not close or restart an in-flight update request", async () => {
		const request = deferred<{
			success: true;
			data: { endpoint: typeof createdEndpoint };
		}>();
		mocks.updateWebhook.mockReturnValue(request.promise);
		const user = userEvent.setup();
		render(<EditHarness />);
		fireEvent.submit(formFor("Save"));
		await waitFor(() => expect(mocks.updateWebhook).toHaveBeenCalledOnce());

		await user.click(screen.getByRole("button", { name: "Cancel" }));
		const reopenButton = screen.queryByRole("button", {
			name: "Open edit dialog",
		});
		if (reopenButton) await user.click(reopenButton);
		fireEvent.submit(formFor("Save"));

		expect(mocks.updateWebhook).toHaveBeenCalledOnce();
		expect(
			screen.queryByRole("button", { name: "Open edit dialog" }),
		).toBeNull();
		request.resolve({ success: true, data: { endpoint: createdEndpoint } });

		await waitFor(() => expect(mocks.onSuccess).toHaveBeenCalledOnce());
		expect(screen.queryByLabelText("Signing Secret")).toBeNull();
	});

	it("discards a pending create result after the webhook prop is replaced", async () => {
		const request = deferred<{
			success: true;
			data: { endpoint: typeof createdEndpoint; secret: string };
		}>();
		mocks.createWebhook.mockReturnValue(request.promise);
		mocks.updateWebhook.mockResolvedValue({
			success: true,
			data: { endpoint: replacementWebhook },
		});
		const user = userEvent.setup();
		render(<ReplacementHarness />);
		await fillCreateForm(user);
		fireEvent.submit(formFor("Create Webhook"));
		await waitFor(() => expect(mocks.createWebhook).toHaveBeenCalledOnce());

		await user.click(screen.getByRole("button", { name: "Replace webhook" }));
		await waitFor(() =>
			expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
				"Absence updates",
			),
		);
		fireEvent.submit(formFor("Save"));

		await waitFor(() => expect(mocks.updateWebhook).toHaveBeenCalledOnce());
		expect(mocks.updateWebhook).toHaveBeenCalledWith(
			"webhook-2",
			expect.objectContaining({ name: "Absence updates" }),
		);
		expect(mocks.onSuccess).toHaveBeenCalledWith(replacementWebhook);
		expect(
			screen.getByRole("button", { name: "Open replacement dialog" }),
		).toBeTruthy();

		request.resolve({
			success: true,
			data: { endpoint: createdEndpoint, secret: "whsec_stale" },
		});
		await waitFor(() => expect(mocks.createWebhook).toHaveBeenCalledOnce());
		expect(mocks.onSuccess).toHaveBeenCalledOnce();
		expect(screen.queryByLabelText("Signing Secret")).toBeNull();
		expect(mocks.refresh).toHaveBeenCalledOnce();
	});

	it("discards a pending update result after the webhook prop is replaced", async () => {
		const request = deferred<{
			success: true;
			data: { endpoint: typeof createdEndpoint };
		}>();
		mocks.updateWebhook
			.mockReturnValueOnce(request.promise)
			.mockResolvedValueOnce({
				success: true,
				data: { endpoint: replacementWebhook },
			});
		const user = userEvent.setup();
		render(<ReplacementHarness initialWebhook={editableWebhook} />);
		fireEvent.submit(formFor("Save"));
		await waitFor(() => expect(mocks.updateWebhook).toHaveBeenCalledOnce());

		await user.click(screen.getByRole("button", { name: "Replace webhook" }));
		await waitFor(() =>
			expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
				"Absence updates",
			),
		);
		fireEvent.submit(formFor("Save"));

		await waitFor(() => expect(mocks.updateWebhook).toHaveBeenCalledTimes(2));
		expect(mocks.updateWebhook).toHaveBeenLastCalledWith(
			"webhook-2",
			expect.objectContaining({ name: "Absence updates" }),
		);
		expect(mocks.onSuccess).toHaveBeenCalledWith(replacementWebhook);
		expect(
			screen.getByRole("button", { name: "Open replacement dialog" }),
		).toBeTruthy();

		request.resolve({ success: true, data: { endpoint: createdEndpoint } });
		await waitFor(() => expect(mocks.updateWebhook).toHaveBeenCalledTimes(2));
		expect(mocks.onSuccess).toHaveBeenCalledOnce();
		expect(mocks.refresh).toHaveBeenCalledOnce();
	});

	it("rejects an old completion that resolves during replacement commit", async () => {
		const request = deferred<{
			success: true;
			data: { endpoint: typeof createdEndpoint };
		}>();
		mocks.updateWebhook.mockReturnValue(request.promise);
		function CommitRaceHarness() {
			const [webhook, setWebhook] = useState(editableWebhook);
			useLayoutEffect(() => {
				if (webhook.id === replacementWebhook.id) {
					request.resolve({
						success: true,
						data: { endpoint: createdEndpoint },
					});
				}
			}, [webhook.id]);

			return (
				<>
					<button type="button" onClick={() => setWebhook(replacementWebhook)}>
						Replace webhook during commit
					</button>
					<WebhookFormDialog
						organizationId="org-1"
						webhook={webhook}
						open
						onOpenChange={vi.fn()}
						onSuccess={mocks.onSuccess}
					/>
				</>
			);
		}

		render(<CommitRaceHarness />);
		fireEvent.submit(formFor("Save"));
		await waitFor(() => expect(mocks.updateWebhook).toHaveBeenCalledOnce());
		fireEvent.click(
			screen.getByRole("button", { name: "Replace webhook during commit" }),
		);

		await waitFor(() =>
			expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
				"Absence updates",
			),
		);
		expect(mocks.onSuccess).not.toHaveBeenCalled();
		expect(screen.queryByLabelText("Signing Secret")).toBeNull();
	});
});
