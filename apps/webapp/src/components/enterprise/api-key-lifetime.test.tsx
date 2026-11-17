// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Activity, useState } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	createApiKey,
	updateApiKey,
} from "@/app/[locale]/(app)/settings/enterprise/api-keys/actions";
import type { ApiKeyResponse } from "@/lib/validations/api-key";
import { render } from "@/test/render-with-translations";
import { ApiKeyCreateDialog } from "./api-key-create-dialog";
import { ApiKeyEditDialog } from "./api-key-edit-dialog";

vi.mock("@/app/[locale]/(app)/settings/enterprise/api-keys/actions", () => ({
	createApiKey: vi.fn(),
	updateApiKey: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const received = vi.fn();
afterEach(cleanup);
beforeEach(() => {
	vi.clearAllMocks();
});

function Harness({ visible = true }: { visible?: boolean }) {
	const [open, setOpen] = useState(true);
	return (
		<Activity mode={visible ? "visible" : "hidden"}>
			<ApiKeyCreateDialog
				organizationId="example-org"
				open={open}
				onOpenChange={setOpen}
				onKeyCreated={received}
			/>
		</Activity>
	);
}
function mount() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const tree = (visible: boolean) => (
		<QueryClientProvider client={client}>
			<Harness visible={visible} />
		</QueryClientProvider>
	);
	const view = render(tree(true));
	return { view, tree };
}
async function fill() {
	await userEvent.setup().type(screen.getByRole("textbox", { name: /Name/ }), "Payroll fixture");
	return screen.getByRole("button", { name: "Create Key" }).closest("form")!;
}

it("owns queued activation before TanStack validation and ignores a duplicate submit and Cancel", async () => {
	vi.mocked(createApiKey).mockImplementation(() => new Promise(() => {}));
	mount();
	const form = await fill();
	act(() => {
		fireEvent.submit(form);
		fireEvent.submit(form);
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
	});
	await waitFor(() => expect(createApiKey).toHaveBeenCalledTimes(1));
	expect(screen.getByRole("dialog", { name: "Create API Key" })).toBeTruthy();
});

it.each(["success", "refusal", "rejection"] as const)(
	"retires a pending %s after Activity hides and shows the same form",
	async (outcome) => {
		let finish!: (value: Awaited<ReturnType<typeof createApiKey>>) => void;
		let reject!: (reason: Error) => void;
		vi.mocked(createApiKey).mockImplementation(
			() =>
				new Promise((resolve, decline) => {
					finish = resolve;
					reject = decline;
				}),
		);
		const { view, tree } = mount();
		fireEvent.submit(await fill());
		await waitFor(() => expect(createApiKey).toHaveBeenCalledTimes(1));
		view.rerender(tree(false));
		view.rerender(tree(true));
		await act(async () => {
			if (outcome === "rejection") {
				reject(new Error("Public fixture rejection"));
				return;
			}
			if (outcome === "refusal") {
				finish({ success: false, error: "Public refusal", code: "AuthorizationError" });
				return;
			}
			finish({
				success: true,
				data: {
					id: "public-fixture-id",
					name: "Payroll fixture",
					key: "public-test-dummy",
					prefix: "public-prefix",
					expiresAt: null,
				},
			});
		});
		expect(received).not.toHaveBeenCalled();
		expect(toast.success).not.toHaveBeenCalled();
		expect(toast.error).not.toHaveBeenCalled();
	},
);

it("owns edit activation before validation and keeps the panel through queued Cancel and duplicate submit", async () => {
	vi.mocked(updateApiKey).mockImplementation(() => new Promise(() => {}));
	const key: ApiKeyResponse = {
		id: "example-key",
		organizationId: "example-org",
		name: "Payroll fixture",
		prefix: "public-prefix",
		createdBy: null,
		creator: null,
		createdAt: "2026-11-01T00:00:00Z",
		updatedAt: "2026-11-01T00:00:00Z",
		expiresAt: null,
		lastRequest: null,
		enabled: true,
		scopes: ["employees:read"],
		rateLimitEnabled: true,
		rateLimitMax: 100,
		rateLimitTimeWindow: 60000,
		requestCount: 0,
	};
	const close = vi.fn();
	render(
		<QueryClientProvider client={new QueryClient()}>
			<ApiKeyEditDialog organizationId="example-org" apiKey={key} open onOpenChange={close} />
		</QueryClientProvider>,
	);
	const form = screen.getByRole("button", { name: "Save" }).closest("form")!;
	act(() => {
		expect(fireEvent.submit(form)).toBe(false);
		fireEvent.submit(form);
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
	});
	await waitFor(() => expect(updateApiKey).toHaveBeenCalledTimes(1));
	expect(close).not.toHaveBeenCalled();
});
