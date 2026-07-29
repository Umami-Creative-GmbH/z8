/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiKeyCreateDialog } from "./api-key-create-dialog";

const mocks = vi.hoisted(() => ({
	createApiKey: vi.fn(),
	onKeyCreated: vi.fn(),
	toastError: vi.fn(),
	toastSuccess: vi.fn(),
	translate: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: mocks.translate,
	}),
}));

vi.mock("sonner", () => ({
	toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

vi.mock("@/app/[locale]/(app)/settings/enterprise/api-keys/actions", () => ({
	createApiKey: mocks.createApiKey,
}));

vi.mock("@/components/ui/action-panel", () => ({
	ActionPanel: ({
		children,
		onOpenChange,
		open,
	}: {
		children: ReactNode;
		onOpenChange: (open: boolean) => void;
		open: boolean;
	}) =>
		open ? (
			<section>
				<button type="button" onClick={() => onOpenChange(false)}>
					Dismiss panel
				</button>
				{children}
			</section>
		) : null,
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

function Harness() {
	const [open, setOpen] = useState(true);
	const handleKeyCreated = (key: Parameters<typeof mocks.onKeyCreated>[0]) => {
		mocks.onKeyCreated(key);
		setOpen(false);
	};

	return (
		<>
			{!open && (
				<button type="button" onClick={() => setOpen(true)}>
					Open create dialog
				</button>
			)}
			<ApiKeyCreateDialog
				organizationId="org-1"
				open={open}
				onOpenChange={setOpen}
				onKeyCreated={handleKeyCreated}
			/>
		</>
	);
}

function renderDialog() {
	const queryClient = new QueryClient({
		defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
	});
	const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

	render(
		<QueryClientProvider client={queryClient}>
			<Harness />
		</QueryClientProvider>,
	);

	return { invalidateQueries };
}

function checked(label: string) {
	return (
		screen
			.getByRole("checkbox", { name: label })
			.getAttribute("aria-checked") === "true"
	);
}

describe("ApiKeyCreateDialog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.translate.mockImplementation(
			(_key: string, fallback: string) => fallback,
		);
	});

	it("renders the existing defaults and accessible name validation", async () => {
		renderDialog();
		const user = userEvent.setup();
		const createButton = screen.getByRole("button", {
			name: "Create Key",
		}) as HTMLButtonElement;

		expect((screen.getByLabelText("Name *") as HTMLInputElement).value).toBe(
			"",
		);
		expect(checked("Read time entries")).toBe(true);
		expect(checked("Enable rate limiting")).toBe(true);
		expect(
			(screen.getByLabelText("Max requests per minute") as HTMLInputElement)
				.value,
		).toBe("100");
		expect(createButton.disabled).toBe(true);

		await user.type(screen.getByLabelText("Name *"), "ab");
		expect(createButton.disabled).toBe(true);
		const nameInput = screen.getByLabelText("Name *");
		const nameError = screen.getByRole("alert");
		expect(nameError.textContent).toBe("Name must be at least 3 characters");
		expect(nameInput.getAttribute("aria-invalid")).toBe("true");
		expect(nameInput.getAttribute("aria-describedby")?.split(" ")).toContain(
			nameError.id,
		);
		expect(screen.getByText("Name *").getAttribute("data-error")).toBe("true");
		expect(mocks.translate).toHaveBeenCalledWith(
			"settings.apiKeys.form.nameMinLength",
			"Name must be at least 3 characters",
		);
		await user.type(screen.getByLabelText("Name *"), "c");
		expect(screen.queryByText("Name must be at least 3 characters")).toBeNull();
		expect(createButton.disabled).toBe(false);
	});

	it("rejects a whitespace-only name with an associated error", async () => {
		renderDialog();
		const user = userEvent.setup();
		const nameInput = screen.getByLabelText("Name *");
		await user.type(nameInput, "   ");

		const nameError = screen.getByRole("alert");
		expect(nameError.textContent).toBe("Name must be at least 3 characters");
		expect(nameInput.getAttribute("aria-invalid")).toBe("true");
		expect(nameInput.getAttribute("aria-describedby")?.split(" ")).toContain(
			nameError.id,
		);
		expect(
			(screen.getByRole("button", { name: "Create Key" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		expect(mocks.createApiKey).not.toHaveBeenCalled();
	});

	it("requires a permission and supports selecting a different permission", async () => {
		renderDialog();
		const user = userEvent.setup();
		const permissionGroup = screen.getByRole("group", {
			name: "Permissions *",
		});
		expect(
			within(permissionGroup).getByRole("checkbox", {
				name: "Read time entries",
			}),
		).toBeTruthy();
		await user.type(screen.getByLabelText("Name *"), "Payroll integration");
		await user.click(
			screen.getByRole("checkbox", { name: "Read time entries" }),
		);

		const permissionError = screen.getByRole("alert");
		expect(permissionError.textContent).toBe("Select at least one permission");
		expect(permissionGroup.getAttribute("aria-describedby")).toBe(
			permissionError.id,
		);
		expect(
			(screen.getByRole("button", { name: "Create Key" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);

		await user.click(screen.getByRole("checkbox", { name: "Read employees" }));
		expect(screen.queryByText("Select at least one permission")).toBeNull();
		expect(
			(screen.getByRole("button", { name: "Create Key" }) as HTMLButtonElement)
				.disabled,
		).toBe(false);
	});

	it.each([
		"",
		"10.5",
		"9",
		"10001",
	])("rejects invalid rate limit %j before calling the action", async (rateLimitMax) => {
		renderDialog();
		const user = userEvent.setup();
		await user.type(screen.getByLabelText("Name *"), "Payroll integration");
		const rateLimitInput = screen.getByLabelText("Max requests per minute");
		await user.clear(rateLimitInput);
		if (rateLimitMax) await user.type(rateLimitInput, rateLimitMax);

		const createButton = screen.getByRole("button", {
			name: "Create Key",
		}) as HTMLButtonElement;
		expect(createButton.disabled).toBe(true);
		expect(screen.getByRole("alert").textContent).toBe(
			"Enter a whole number from 10 to 10,000",
		);
		expect(mocks.translate).toHaveBeenCalledWith(
			"settings.apiKeys.form.rateLimitMaxInvalid",
			"Enter a whole number from 10 to 10,000",
		);
		await user.click(createButton);
		expect(mocks.createApiKey).not.toHaveBeenCalled();
	});

	it("ignores an invalid hidden rate limit after rate limiting is disabled", async () => {
		mocks.createApiKey.mockResolvedValue({
			success: true,
			data: {
				id: "key-1",
				key: "secret",
				name: "Payroll integration",
				prefix: "z8_",
				expiresAt: null,
			},
		});
		renderDialog();
		const user = userEvent.setup();
		await user.type(screen.getByLabelText("Name *"), "Payroll integration");
		await user.clear(screen.getByLabelText("Max requests per minute"));
		expect(
			(screen.getByRole("button", { name: "Create Key" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);

		await user.click(
			screen.getByRole("checkbox", { name: "Enable rate limiting" }),
		);
		expect(screen.queryByLabelText("Max requests per minute")).toBeNull();
		const createButton = screen.getByRole("button", {
			name: "Create Key",
		}) as HTMLButtonElement;
		expect(createButton.disabled).toBe(false);
		await user.click(createButton);

		await waitFor(() => expect(mocks.createApiKey).toHaveBeenCalledOnce());
		expect(mocks.createApiKey).toHaveBeenCalledWith("org-1", {
			name: "Payroll integration",
			expiresInDays: 30,
			scopes: ["time-entries:read"],
			rateLimitEnabled: false,
			rateLimitMax: 100,
			rateLimitTimeWindow: 60000,
		});
	});

	it("submits the exact API payload and reports success", async () => {
		const createdKey = {
			id: "key-1",
			key: "secret",
			name: "Payroll integration",
			prefix: "z8_",
			expiresAt: null,
		};
		mocks.createApiKey.mockResolvedValue({ success: true, data: createdKey });
		const { invalidateQueries } = renderDialog();
		const user = userEvent.setup();
		await user.type(screen.getByLabelText("Name *"), "  Payroll integration  ");
		await user.click(
			screen.getByRole("checkbox", { name: "Read time entries" }),
		);
		await user.click(screen.getByRole("checkbox", { name: "Read employees" }));
		await user.click(
			screen.getByRole("checkbox", { name: "Enable rate limiting" }),
		);
		await user.click(screen.getByRole("button", { name: "Create Key" }));

		await waitFor(() => expect(mocks.createApiKey).toHaveBeenCalledOnce());
		expect(mocks.createApiKey).toHaveBeenCalledWith("org-1", {
			name: "Payroll integration",
			expiresInDays: 30,
			scopes: ["employees:read"],
			rateLimitEnabled: false,
			rateLimitMax: 100,
			rateLimitTimeWindow: 60000,
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: ["apiKeys", "org-1"],
		});
		expect(mocks.toastSuccess).toHaveBeenCalledWith(
			"API key created successfully",
		);
		expect(mocks.onKeyCreated).toHaveBeenCalledWith(createdKey);
	});

	it("restores defaults after canceling and reopening", async () => {
		renderDialog();
		const user = userEvent.setup();
		await user.type(screen.getByLabelText("Name *"), "Temporary key");
		await user.click(
			screen.getByRole("checkbox", { name: "Read time entries" }),
		);
		await user.click(
			screen.getByRole("checkbox", { name: "Enable rate limiting" }),
		);
		await user.click(screen.getByRole("button", { name: "Cancel" }));
		await user.click(
			screen.getByRole("button", { name: "Open create dialog" }),
		);

		expect((screen.getByLabelText("Name *") as HTMLInputElement).value).toBe(
			"",
		);
		expect(checked("Read time entries")).toBe(true);
		expect(checked("Enable rate limiting")).toBe(true);
		expect(
			(screen.getByLabelText("Max requests per minute") as HTMLInputElement)
				.value,
		).toBe("100");
	});

	it("restores every default after successful creation and reopening", async () => {
		mocks.createApiKey.mockResolvedValue({
			success: true,
			data: {
				id: "key-1",
				key: "secret",
				name: "Temporary key",
				prefix: "z8_",
				expiresAt: null,
			},
		});
		renderDialog();
		const user = userEvent.setup();
		await user.type(screen.getByLabelText("Name *"), "Temporary key");
		await user.click(screen.getByRole("combobox", { name: "Expiration" }));
		await user.click(await screen.findByRole("option", { name: "90 days" }));
		await user.click(
			screen.getByRole("checkbox", { name: "Read time entries" }),
		);
		await user.click(screen.getByRole("checkbox", { name: "Read employees" }));
		const rateLimitInput = screen.getByLabelText("Max requests per minute");
		await user.clear(rateLimitInput);
		await user.type(rateLimitInput, "500");
		await user.click(screen.getByRole("button", { name: "Create Key" }));

		await user.click(
			await screen.findByRole("button", { name: "Open create dialog" }),
		);
		expect((screen.getByLabelText("Name *") as HTMLInputElement).value).toBe(
			"",
		);
		expect(
			screen.getByRole("combobox", { name: "Expiration" }).textContent,
		).toContain("30 days");
		expect(checked("Read time entries")).toBe(true);
		for (const permission of [
			"Write time entries",
			"Read employees",
			"Read reports",
			"Read projects",
			"Write projects",
		]) {
			expect(checked(permission)).toBe(false);
		}
		expect(checked("Enable rate limiting")).toBe(true);
		expect(
			(screen.getByLabelText("Max requests per minute") as HTMLInputElement)
				.value,
		).toBe("100");
	});

	it("disables submission while pending and shows resolved errors", async () => {
		let resolveRequest: (value: { success: false; error: string }) => void =
			() => undefined;
		mocks.createApiKey.mockReturnValue(
			new Promise((resolve) => {
				resolveRequest = resolve;
			}),
		);
		renderDialog();
		const user = userEvent.setup();
		await user.type(screen.getByLabelText("Name *"), "Failing key");
		const createButton = screen.getByRole("button", {
			name: "Create Key",
		}) as HTMLButtonElement;
		await user.click(createButton);

		await waitFor(() => expect(createButton.disabled).toBe(true));
		expect(document.querySelector(".animate-spin")).toBeTruthy();
		resolveRequest({ success: false, error: "Creation failed" });

		await waitFor(() =>
			expect(mocks.toastError).toHaveBeenCalledWith("Creation failed"),
		);
		expect(createButton.disabled).toBe(false);
		expect(mocks.onKeyCreated).not.toHaveBeenCalled();
	});

	it("ignores cancel and panel dismissal while creation is pending", async () => {
		let resolveRequest: (value: {
			success: true;
			data: {
				id: string;
				key: string;
				name: string;
				prefix: string;
				expiresAt: null;
			};
		}) => void = () => undefined;
		mocks.createApiKey.mockReturnValue(
			new Promise((resolve) => {
				resolveRequest = resolve;
			}),
		);
		renderDialog();
		const user = userEvent.setup();
		await user.type(screen.getByLabelText("Name *"), "Pending key");
		await user.click(screen.getByRole("button", { name: "Create Key" }));
		await waitFor(() => expect(mocks.createApiKey).toHaveBeenCalledOnce());

		const cancelButton = screen.getByRole("button", {
			name: "Cancel",
		}) as HTMLButtonElement;
		expect(cancelButton.disabled).toBe(true);
		await user.click(cancelButton);
		await user.click(screen.getByRole("button", { name: "Dismiss panel" }));
		expect(
			screen.queryByRole("button", { name: "Open create dialog" }),
		).toBeNull();
		expect((screen.getByLabelText("Name *") as HTMLInputElement).value).toBe(
			"Pending key",
		);
		expect(mocks.createApiKey).toHaveBeenCalledOnce();

		resolveRequest({
			success: true,
			data: {
				id: "key-1",
				key: "secret",
				name: "Pending key",
				prefix: "z8_",
				expiresAt: null,
			},
		});
		await user.click(
			await screen.findByRole("button", { name: "Open create dialog" }),
		);
		expect((screen.getByLabelText("Name *") as HTMLInputElement).value).toBe(
			"",
		);
	});
});
