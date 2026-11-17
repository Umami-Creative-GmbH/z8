// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { deleteWebhook } from "@/app/[locale]/(app)/settings/webhooks/actions";
import type { PublicWebhookEndpoint } from "@/lib/webhooks/types";
import { render } from "@/test/render-with-translations";
import { WebhookEndpointCard } from "./webhook-endpoint-card";

vi.mock("@/app/[locale]/(app)/settings/webhooks/actions", () => ({
	deleteWebhook: vi.fn(),
	updateWebhook: vi.fn(),
	testWebhook: vi.fn(),
	regenerateSecret: vi.fn(),
	getWebhookDeliveries: vi.fn(),
	retryDelivery: vi.fn(),
	createWebhook: vi.fn(),
}));
vi.mock("@/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);
const endpoint: PublicWebhookEndpoint = {
	id: "public-endpoint",
	organizationId: "example-org",
	createdBy: "example-owner",
	name: "Payroll webhook",
	url: "https://example.com/fixture",
	description: null,
	subscribedEvents: ["absence_request_approved"],
	isActive: true,
	lastDeliveredAt: null,
	lastFailedAt: null,
	consecutiveFailures: 0,
	totalDeliveries: 0,
	totalSuccesses: 0,
	createdAt: new Date("2026-11-01T00:00:00Z"),
	updatedAt: new Date("2026-11-01T00:00:00Z"),
};

it("keeps the actual delete confirmation pending and retains it after an owner refusal", async () => {
	let finish!: (value: Awaited<ReturnType<typeof deleteWebhook>>) => void;
	vi.mocked(deleteWebhook).mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	render(<WebhookEndpointCard webhook={endpoint} onUpdated={vi.fn()} onDeleted={vi.fn()} />);
	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: "Actions" }));
	await user.click(screen.getByRole("menuitem", { name: "Delete" }));
	const confirm = screen.getByRole("button", { name: "Delete" });
	act(() => {
		fireEvent.click(confirm);
		fireEvent.click(confirm);
	});
	await waitFor(() => expect(deleteWebhook).toHaveBeenCalledTimes(1));
	await user.keyboard("{Escape}");
	expect(screen.getByRole("alertdialog")).toBeTruthy();
	await act(async () => finish({ success: false, error: "Refused", code: "AuthorizationError" }));
	expect(screen.getByRole("alertdialog")).toBeTruthy();
});
