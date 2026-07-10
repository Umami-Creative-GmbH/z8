/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebhookDeliveryLogsDialog } from "./index";

const mocks = vi.hoisted(() => ({
	getWebhookDeliveryLogs: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string) => fallback,
	}),
}));
vi.mock("next-intl", () => ({
	useLocale: () => "en",
}));
vi.mock("@/app/[locale]/(app)/settings/webhooks/actions", () => ({
	getWebhookDeliveryLogs: mocks.getWebhookDeliveryLogs,
}));

function delivery(id: string) {
	return {
		id,
		webhookEndpointId: "webhook-1",
		organizationId: "org-1",
		eventType: id,
		eventId: null,
		url: "https://example.com/webhook",
		payload: {},
		requestHeaders: null,
		status: "success",
		httpStatus: 200,
		responseBody: null,
		errorMessage: null,
		attemptNumber: 1,
		maxAttempts: 6,
		nextRetryAt: null,
		bullmqJobId: null,
		scheduledAt: new Date("2026-07-10T08:00:00Z"),
		startedAt: null,
		completedAt: null,
		durationMs: 25,
		createdAt: new Date("2026-07-10T08:00:00Z"),
	};
}

function success(id: string, total = 1) {
	return {
		success: true,
		data: { deliveries: [delivery(id)], total },
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

describe("WebhookDeliveryLogsDialog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("loads the selected pagination offset", async () => {
		mocks.getWebhookDeliveryLogs
			.mockResolvedValueOnce(success("page-1", 40))
			.mockResolvedValueOnce(success("page-2", 40));
		const user = userEvent.setup();

		render(
			<WebhookDeliveryLogsDialog
				webhookId="webhook-1"
				webhookName="Payroll"
				open
				onOpenChange={vi.fn()}
			/>,
		);

		await screen.findByText("page-1");
		await user.click(screen.getByRole("button", { name: "Next" }));

		await waitFor(() => {
			expect(mocks.getWebhookDeliveryLogs).toHaveBeenLastCalledWith("webhook-1", {
				limit: 20,
				offset: 20,
			});
		});
		await screen.findByText("page-2");
	});

	it("ignores a stale response after the selected webhook changes", async () => {
		const first = deferred<ReturnType<typeof success>>();
		const second = deferred<ReturnType<typeof success>>();
		mocks.getWebhookDeliveryLogs
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);

		const { rerender } = render(
			<WebhookDeliveryLogsDialog
				webhookId="webhook-a"
				webhookName="A"
				open
				onOpenChange={vi.fn()}
			/>,
		);
		await waitFor(() => expect(mocks.getWebhookDeliveryLogs).toHaveBeenCalledOnce());

		rerender(
			<WebhookDeliveryLogsDialog
				webhookId="webhook-b"
				webhookName="B"
				open
				onOpenChange={vi.fn()}
			/>,
		);
		await waitFor(() => expect(mocks.getWebhookDeliveryLogs).toHaveBeenCalledTimes(2));

		second.resolve(success("newest"));
		await screen.findByText("newest");
		first.resolve(success("stale"));

		await waitFor(() => expect(screen.queryByText("stale")).toBeNull());
		expect(screen.getByText("newest")).toBeTruthy();
	});

	it("shows a retryable error instead of an empty result", async () => {
		mocks.getWebhookDeliveryLogs.mockResolvedValue({
			success: false,
			error: "Delivery service unavailable",
		});

		render(
			<WebhookDeliveryLogsDialog
				webhookId="webhook-1"
				webhookName="Payroll"
				open
				onOpenChange={vi.fn()}
			/>,
		);

		expect(await screen.findByText("Delivery service unavailable")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
	});

	it("resets pagination when switching away and back", async () => {
		mocks.getWebhookDeliveryLogs.mockResolvedValue(success("delivery", 40));
		const user = userEvent.setup();
		const { rerender } = render(
			<WebhookDeliveryLogsDialog
				webhookId="webhook-a"
				webhookName="A"
				open
				onOpenChange={vi.fn()}
			/>,
		);
		await screen.findByText("delivery");
		await user.click(screen.getByRole("button", { name: "Next" }));
		await waitFor(() =>
			expect(mocks.getWebhookDeliveryLogs).toHaveBeenLastCalledWith("webhook-a", {
				limit: 20,
				offset: 20,
			}),
		);

		rerender(
			<WebhookDeliveryLogsDialog
				webhookId="webhook-b"
				webhookName="B"
				open
				onOpenChange={vi.fn()}
			/>,
		);
		await waitFor(() =>
			expect(mocks.getWebhookDeliveryLogs).toHaveBeenLastCalledWith("webhook-b", {
				limit: 20,
				offset: 0,
			}),
		);

		rerender(
			<WebhookDeliveryLogsDialog
				webhookId="webhook-a"
				webhookName="A"
				open
				onOpenChange={vi.fn()}
			/>,
		);
		await waitFor(() =>
			expect(mocks.getWebhookDeliveryLogs).toHaveBeenLastCalledWith("webhook-a", {
				limit: 20,
				offset: 0,
			}),
		);
	});
});
