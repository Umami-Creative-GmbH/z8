// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Activity } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
	deleteWebhook,
	regenerateSecret,
	updateWebhook,
} from "@/app/[locale]/(app)/settings/enterprise/api-keys/webhook-actions";
import type { PublicWebhookEndpoint } from "@/lib/webhooks/types";
import { render } from "@/test/render-with-translations";
import { WebhookEndpointCard } from "./webhook-endpoint-card";
import { webhookEndpointLabel } from "./webhook-endpoint-label";

vi.mock("@/app/[locale]/(app)/settings/enterprise/api-keys/webhook-actions", () => ({
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

it("names the active switch and actions menu after the endpoint they control", () => {
	render(<WebhookEndpointCard webhook={endpoint} onUpdated={vi.fn()} onDeleted={vi.fn()} />);
	expect(screen.getByRole("switch", { name: "Active: Payroll webhook" })).toBeTruthy();
	expect(screen.getByRole("button", { name: "Actions for Payroll webhook" })).toBeTruthy();
});

it("falls back to a shortened endpoint URL when the endpoint has no name", () => {
	expect(webhookEndpointLabel({ name: "  ", url: "https://example.com/fixture" })).toBe(
		"example.com/fixture",
	);
	const label = webhookEndpointLabel({
		name: "",
		url: `https://example.com/${"segment/".repeat(10)}`,
	});
	expect(label.length).toBe(48);
	expect(label.endsWith("…")).toBe(true);
});

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
	await user.click(screen.getByRole("button", { name: "Actions for Payroll webhook" }));
	await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
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

it("coalesces toggle activation while pending and retains the canonical state after refusal", async () => {
	let finish!: (value: Awaited<ReturnType<typeof updateWebhook>>) => void;
	vi.mocked(updateWebhook).mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	render(<WebhookEndpointCard webhook={endpoint} onUpdated={vi.fn()} onDeleted={vi.fn()} />);
	const toggle = screen.getByRole("switch", { name: "Active: Payroll webhook" });
	act(() => {
		fireEvent.click(toggle);
		fireEvent.click(toggle);
	});
	await waitFor(() => expect(updateWebhook).toHaveBeenCalledTimes(1));
	expect(toggle).toHaveProperty("disabled", true);
	await act(async () => finish({ success: false, error: "Refused", code: "AuthorizationError" }));
	expect(screen.getByRole("alert").textContent).toContain(
		"You do not have access to this setting.",
	);
	expect(toggle.getAttribute("aria-checked")).toBe("true");
});

it("ignores a late rotation secret after Activity retires the endpoint command owner", async () => {
	let finish!: (value: Awaited<ReturnType<typeof regenerateSecret>>) => void;
	vi.mocked(regenerateSecret).mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const tree = (visible: boolean) => (
		<Activity mode={visible ? "visible" : "hidden"}>
			<WebhookEndpointCard webhook={endpoint} onUpdated={vi.fn()} onDeleted={vi.fn()} />
		</Activity>
	);
	const view = render(tree(true));
	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: "Actions for Payroll webhook" }));
	await user.click(await screen.findByRole("menuitem", { name: "Regenerate Secret" }));
	await waitFor(() => expect(regenerateSecret).toHaveBeenCalledTimes(1));
	await act(async () => view.rerender(tree(false)));
	await act(async () => view.rerender(tree(true)));
	await act(async () => finish({ success: true, data: { secret: "public-dummy-rotation-value" } }));
	expect(screen.queryByRole("dialog", { name: "Webhook Secret" })).toBeNull();
});
