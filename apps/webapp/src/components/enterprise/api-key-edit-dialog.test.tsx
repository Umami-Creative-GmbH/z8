/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateApiKey } from "@/app/[locale]/(app)/settings/enterprise/api-keys/actions";
import type { ApiKeyResponse } from "@/lib/validations/api-key";
import { ApiKeyEditDialog } from "./api-key-edit-dialog";

const mocks = vi.hoisted(() => ({
	translate: vi.fn((_key: string, fallback: string) => fallback),
	toastError: vi.fn(),
	toastSuccess: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: mocks.translate }),
}));

vi.mock("sonner", () => ({
	toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

vi.mock("@/app/[locale]/(app)/settings/enterprise/api-keys/actions", () => ({
	updateApiKey: vi.fn(),
}));

const apiKey: ApiKeyResponse = {
	id: "key-1",
	name: "Production API",
	prefix: "z8_org_prod",
	organizationId: "org-1",
	createdBy: "user-1",
	createdAt: "2026-07-01T12:00:00.000Z",
	updatedAt: "2026-07-01T12:00:00.000Z",
	expiresAt: null,
	lastRequest: null,
	enabled: false,
	scopes: ["time-entries:read", "employees:read"],
	rateLimitEnabled: true,
	rateLimitMax: 250,
	rateLimitTimeWindow: 60_000,
	requestCount: 0,
};

const replacementApiKey: ApiKeyResponse = {
	...apiKey,
	id: "key-2",
	name: "Reporting API",
	prefix: "z8_org_reports",
	enabled: true,
	scopes: ["reports:read"],
	rateLimitMax: 900,
};

function renderControlledDialog(selectedApiKey: ApiKeyResponse = apiKey) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const onOpenChange = vi.fn();
	const renderComponent = (nextApiKey: ApiKeyResponse) => (
		<QueryClientProvider client={queryClient}>
			<ApiKeyEditDialog
				organizationId="org-1"
				apiKey={nextApiKey}
				open
				onOpenChange={onOpenChange}
			/>
		</QueryClientProvider>
	);
	const view = render(renderComponent(selectedApiKey));

	return {
		onOpenChange,
		rerenderWithApiKey: (nextApiKey: ApiKeyResponse) =>
			view.rerender(renderComponent(nextApiKey)),
	};
}

function renderDialog() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});

	function Harness() {
		const [open, setOpen] = useState(true);
		return (
			<QueryClientProvider client={queryClient}>
				<button type="button" onClick={() => setOpen(true)}>
					Reopen
				</button>
				<ApiKeyEditDialog
					organizationId="org-1"
					apiKey={apiKey}
					open={open}
					onOpenChange={setOpen}
				/>
			</QueryClientProvider>
		);
	}

	return render(<Harness />);
}

async function renderPendingDialog() {
	const user = userEvent.setup();
	let resolveUpdate: ((result: { success: true }) => void) | undefined;
	vi.mocked(updateApiKey).mockImplementation(
		() => new Promise((resolve) => (resolveUpdate = resolve)),
	);
	const { onOpenChange } = renderControlledDialog();
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() => expect(updateApiKey).toHaveBeenCalledTimes(1));
	return { onOpenChange, resolveUpdate, user };
}

describe("ApiKeyEditDialog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.translate.mockImplementation(
			(_key: string, fallback: string) => fallback,
		);
		vi.mocked(updateApiKey).mockResolvedValue({ success: true });
	});

	it("uses the selected API key values as its initial values", () => {
		renderDialog();

		expect(screen.getByRole("textbox", { name: /Name/ })).toHaveProperty(
			"value",
			"Production API",
		);
		expect(
			screen
				.getByRole("switch", { name: "Key Enabled" })
				.getAttribute("aria-checked"),
		).toBe("false");
		expect(
			screen
				.getByRole("checkbox", { name: "Read time entries" })
				.getAttribute("aria-checked"),
		).toBe("true");
		expect(
			screen
				.getByRole("checkbox", { name: "Read employees" })
				.getAttribute("aria-checked"),
		).toBe("true");
		expect(screen.getByLabelText("Max requests per minute")).toHaveProperty(
			"value",
			"250",
		);
	});

	it("restores the selected API key values after closing and reopening", async () => {
		const user = userEvent.setup();
		renderDialog();

		const name = screen.getByRole("textbox", { name: /Name/ });
		await user.clear(name);
		await user.type(name, "Temporary name");
		await user.click(screen.getByRole("checkbox", { name: "Read employees" }));
		await user.click(screen.getByRole("button", { name: "Close" }));
		await user.click(await screen.findByRole("button", { name: "Reopen" }));

		expect(screen.getByRole("textbox", { name: /Name/ })).toHaveProperty(
			"value",
			"Production API",
		);
		expect(
			screen
				.getByRole("checkbox", { name: "Read employees" })
				.getAttribute("aria-checked"),
		).toBe("true");
	});

	it("restores selected key defaults when Cancel closes a retained key", async () => {
		const user = userEvent.setup();
		renderDialog();

		const name = screen.getByRole("textbox", { name: /Name/ });
		await user.clear(name);
		await user.type(name, "Temporary name");
		await user.click(screen.getByRole("checkbox", { name: "Read employees" }));
		await user.click(screen.getByRole("button", { name: "Cancel" }));
		await user.click(await screen.findByRole("button", { name: "Reopen" }));

		expect(screen.getByRole("textbox", { name: /Name/ })).toHaveProperty(
			"value",
			"Production API",
		);
		expect(
			screen
				.getByRole("checkbox", { name: "Read employees" })
				.getAttribute("aria-checked"),
		).toBe("true");
	});

	it("synchronizes every form value when the parent replaces the selected key", async () => {
		const user = userEvent.setup();
		const { rerenderWithApiKey } = renderControlledDialog();

		const name = screen.getByRole("textbox", { name: /Name/ });
		await user.clear(name);
		await user.type(name, "Unsaved name");
		await user.click(screen.getByRole("switch", { name: "Key Enabled" }));
		await user.click(screen.getByRole("checkbox", { name: "Read reports" }));
		await user.clear(screen.getByLabelText("Max requests per minute"));
		await user.type(screen.getByLabelText("Max requests per minute"), "400");

		rerenderWithApiKey(replacementApiKey);

		expect(screen.getByRole("textbox", { name: /Name/ })).toHaveProperty(
			"value",
			"Reporting API",
		);
		expect(screen.getByText("z8_org_reports")).toBeTruthy();
		expect(
			screen
				.getByRole("switch", { name: "Key Enabled" })
				.getAttribute("aria-checked"),
		).toBe("true");
		expect(
			screen
				.getByRole("checkbox", { name: "Read time entries" })
				.getAttribute("aria-checked"),
		).toBe("false");
		expect(
			screen
				.getByRole("checkbox", { name: "Read reports" })
				.getAttribute("aria-checked"),
		).toBe("true");
		expect(screen.getByLabelText("Max requests per minute")).toHaveProperty(
			"value",
			"900",
		);
	});

	it("requires a three-character name and at least one permission", async () => {
		const user = userEvent.setup();
		renderDialog();

		const name = screen.getByRole("textbox", { name: /Name/ });
		await user.clear(name);
		await user.type(name, "ab");
		expect(screen.getByRole("button", { name: "Save" })).toHaveProperty(
			"disabled",
			true,
		);

		await user.type(name, "c");
		await user.click(
			screen.getByRole("checkbox", { name: "Read time entries" }),
		);
		await user.click(screen.getByRole("checkbox", { name: "Read employees" }));

		expect(screen.getByText("Select at least one permission")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Save" })).toHaveProperty(
			"disabled",
			true,
		);
	});

	it("rejects a whitespace-only name", async () => {
		const user = userEvent.setup();
		renderDialog();
		const name = screen.getByRole("textbox", { name: /Name/ });

		await user.clear(name);
		await user.type(name, "   ");

		expect(screen.getByRole("button", { name: "Save" })).toHaveProperty(
			"disabled",
			true,
		);
		expect(screen.getByRole("alert").textContent).toBe(
			"Name must be at least 3 characters",
		);
		expect(updateApiKey).not.toHaveBeenCalled();
	});

	it("does not submit invalid values received from the selected key", async () => {
		renderControlledDialog({
			...apiKey,
			name: "ab",
			scopes: [],
			rateLimitMax: 9,
		});

		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Save" })).toHaveProperty(
				"disabled",
				true,
			),
		);
		expect(updateApiKey).not.toHaveBeenCalled();
	});

	it("associates permission validation with its checkbox group", async () => {
		const user = userEvent.setup();
		renderDialog();

		await user.click(
			screen.getByRole("checkbox", { name: "Read time entries" }),
		);
		await user.click(screen.getByRole("checkbox", { name: "Read employees" }));

		const group = screen.getByRole("group", { name: /Permissions/ });
		const error = screen.getByRole("alert");
		expect(group.getAttribute("aria-invalid")).toBe("true");
		expect(group.getAttribute("aria-describedby")).toBe(error.id);
		expect(error.textContent).toBe("Select at least one permission");
	});

	it("uses the translated scopes-required validation message", async () => {
		const user = userEvent.setup();
		mocks.translate.mockImplementation((key: string, fallback: string) =>
			key === "settings.apiKeys.form.scopesRequired"
				? "Mindestens eine Berechtigung auswählen"
				: fallback,
		);
		renderDialog();

		await user.click(
			screen.getByRole("checkbox", { name: "Read time entries" }),
		);
		await user.click(screen.getByRole("checkbox", { name: "Read employees" }));

		expect(screen.getByRole("alert").textContent).toBe(
			"Mindestens eine Berechtigung auswählen",
		);
		expect(mocks.translate).toHaveBeenCalledWith(
			"settings.apiKeys.form.scopesRequired",
			"Select at least one permission",
		);
	});

	it("uses translated and accessible name and rate validation errors", async () => {
		const user = userEvent.setup();
		mocks.translate.mockImplementation((key: string, fallback: string) => {
			if (key === "settings.apiKeys.form.nameMin") return "Name ist zu kurz";
			if (key === "settings.apiKeys.form.rateLimitRequired")
				return "Anfragelimit ist erforderlich";
			return fallback;
		});
		renderDialog();

		const name = screen.getByRole("textbox", { name: /Name/ });
		await user.clear(name);
		await user.type(name, "ab");
		let error = screen.getByRole("alert");
		expect(error.textContent).toBe("Name ist zu kurz");
		expect(name.getAttribute("aria-invalid")).toBe("true");
		expect(name.getAttribute("aria-describedby")).toContain(error.id);

		await user.type(name, "c");
		const rateLimit = screen.getByLabelText("Max requests per minute");
		await user.clear(rateLimit);
		error = screen.getByRole("alert");
		expect(error.textContent).toBe("Anfragelimit ist erforderlich");
		expect(rateLimit.getAttribute("aria-invalid")).toBe("true");
		expect(rateLimit.getAttribute("aria-describedby")).toContain(error.id);
		expect(mocks.translate).toHaveBeenCalledWith(
			"settings.apiKeys.form.nameMin",
			"Name must be at least 3 characters",
		);
		expect(mocks.translate).toHaveBeenCalledWith(
			"settings.apiKeys.form.rateLimitRequired",
			"Rate limit is required",
		);
	});

	it.each([
		["empty", "", "Rate limit is required"],
		["fractional", "10.5", "Rate limit must be a whole number"],
		["below the minimum", "9", "Rate limit must be at least 10 requests"],
		[
			"above the maximum",
			"10001",
			"Rate limit must be at most 10,000 requests",
		],
	])("rejects a %s rate limit", async (_case, value, message) => {
		const user = userEvent.setup();
		renderDialog();
		const rateLimit = screen.getByLabelText("Max requests per minute");

		await user.clear(rateLimit);
		if (value) await user.type(rateLimit, value);

		expect(screen.getByRole("alert").textContent).toBe(message);
		expect(rateLimit.getAttribute("aria-invalid")).toBe("true");
		expect(screen.getByRole("button", { name: "Save" })).toHaveProperty(
			"disabled",
			true,
		);
		expect(updateApiKey).not.toHaveBeenCalled();
	});

	it("restores a valid rate value when disabling rate limiting", async () => {
		const user = userEvent.setup();
		renderDialog();
		const rateLimit = screen.getByLabelText("Max requests per minute");

		await user.clear(rateLimit);
		expect(screen.getByRole("button", { name: "Save" })).toHaveProperty(
			"disabled",
			true,
		);
		await user.click(
			screen.getByRole("checkbox", { name: "Enable rate limiting" }),
		);
		await user.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() =>
			expect(updateApiKey).toHaveBeenCalledWith("org-1", "key-1", {
				name: "Production API",
				enabled: false,
				scopes: ["time-entries:read", "employees:read"],
				rateLimitEnabled: false,
				rateLimitMax: 250,
			}),
		);
	});

	it("submits the edited values and permission selection", async () => {
		const user = userEvent.setup();
		renderDialog();

		const name = screen.getByRole("textbox", { name: /Name/ });
		await user.clear(name);
		await user.type(name, "  Payroll export  ");
		await user.click(screen.getByRole("switch", { name: "Key Enabled" }));
		await user.click(screen.getByRole("checkbox", { name: "Read employees" }));
		await user.click(screen.getByRole("checkbox", { name: "Read reports" }));
		await user.click(
			screen.getByRole("checkbox", { name: "Enable rate limiting" }),
		);
		await user.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() =>
			expect(updateApiKey).toHaveBeenCalledWith("org-1", "key-1", {
				name: "Payroll export",
				enabled: true,
				scopes: ["time-entries:read", "reports:read"],
				rateLimitEnabled: false,
				rateLimitMax: 250,
			}),
		);
		expect(mocks.toastSuccess).toHaveBeenCalledWith("API key updated");
	});

	it("disables save and shows a loader while updating", async () => {
		const user = userEvent.setup();
		let resolveUpdate: ((result: { success: true }) => void) | undefined;
		vi.mocked(updateApiKey).mockImplementation(
			() => new Promise((resolve) => (resolveUpdate = resolve)),
		);
		renderDialog();

		await user.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Save" })).toHaveProperty(
				"disabled",
				true,
			),
		);
		expect(document.querySelector(".animate-spin")).toBeTruthy();

		resolveUpdate?.({ success: true });
	});

	it("disables Cancel and hides the close control while updating", async () => {
		const { resolveUpdate } = await renderPendingDialog();

		expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty(
			"disabled",
			true,
		);
		expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
		expect(screen.getByRole("dialog")).toBeTruthy();

		resolveUpdate?.({ success: true });
	});

	it("ignores Escape while updating", async () => {
		const { onOpenChange, resolveUpdate, user } = await renderPendingDialog();

		await user.keyboard("{Escape}");

		expect(screen.getByRole("dialog")).toBeTruthy();
		expect(onOpenChange).not.toHaveBeenCalled();
		resolveUpdate?.({ success: true });
	});

	it("ignores outside interaction while updating", async () => {
		const { onOpenChange, resolveUpdate, user } = await renderPendingDialog();
		const overlay = document.querySelector<HTMLElement>(
			'[data-slot="sheet-overlay"]',
		);
		expect(overlay).toBeTruthy();

		await user.click(overlay as HTMLElement);

		expect(screen.getByRole("dialog")).toBeTruthy();
		expect(onOpenChange).not.toHaveBeenCalled();
		resolveUpdate?.({ success: true });
	});

	it("does not let an old update completion close a newly selected key", async () => {
		const user = userEvent.setup();
		let resolveUpdate: ((result: { success: true }) => void) | undefined;
		vi.mocked(updateApiKey).mockImplementation(
			() => new Promise((resolve) => (resolveUpdate = resolve)),
		);
		const { onOpenChange, rerenderWithApiKey } = renderControlledDialog();

		await user.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(updateApiKey).toHaveBeenCalledTimes(1));
		rerenderWithApiKey(replacementApiKey);
		resolveUpdate?.({ success: true });

		await waitFor(() =>
			expect(mocks.toastSuccess).toHaveBeenCalledWith("API key updated"),
		);
		expect(onOpenChange).not.toHaveBeenCalled();
		expect(screen.getByRole("textbox", { name: /Name/ })).toHaveProperty(
			"value",
			"Reporting API",
		);
	});

	it("isolates an old completion when replacement commits before passive effects", async () => {
		const user = userEvent.setup();
		const queryClient = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		});
		const onOpenChange = vi.fn();
		let replaceSelectedKey: (() => void) | undefined;
		let resolveUpdate: ((result: { success: true }) => void) | undefined;
		vi.mocked(updateApiKey).mockImplementation(
			() => new Promise((resolve) => (resolveUpdate = resolve)),
		);

		function CommitRaceHarness() {
			const [selectedKey, setSelectedKey] = useState(apiKey);
			replaceSelectedKey = () => setSelectedKey(replacementApiKey);
			useLayoutEffect(() => {
				if (selectedKey.id === replacementApiKey.id) {
					resolveUpdate?.({ success: true });
				}
			}, [selectedKey.id]);
			return (
				<QueryClientProvider client={queryClient}>
					<ApiKeyEditDialog
						organizationId="org-1"
						apiKey={selectedKey}
						open
						onOpenChange={onOpenChange}
					/>
				</QueryClientProvider>
			);
		}

		render(<CommitRaceHarness />);
		await user.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(updateApiKey).toHaveBeenCalledTimes(1));
		act(() => replaceSelectedKey?.());

		await waitFor(() =>
			expect(mocks.toastSuccess).toHaveBeenCalledWith("API key updated"),
		);
		expect(onOpenChange).not.toHaveBeenCalled();
		expect(screen.getByRole("textbox", { name: /Name/ })).toHaveProperty(
			"value",
			"Reporting API",
		);
	});

	it("shows the update error and re-enables save", async () => {
		const user = userEvent.setup();
		vi.mocked(updateApiKey).mockResolvedValue({
			success: false,
			error: "Update denied",
		});
		renderDialog();

		await user.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() =>
			expect(mocks.toastError).toHaveBeenCalledWith("Update denied"),
		);
		expect(screen.getByRole("button", { name: "Save" })).toHaveProperty(
			"disabled",
			false,
		);
		expect(screen.getByRole("dialog")).toBeTruthy();
	});
});
