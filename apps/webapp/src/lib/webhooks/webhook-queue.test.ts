import { beforeEach, describe, expect, it, vi } from "vitest";

const addJobMock = vi.hoisted(() => vi.fn());

vi.mock("./webhook-config.server", () => ({
	MAX_ATTEMPTS: 3,
	RETRY_DELAYS_MS: [0, 2000, 6000, 9999],
}));

vi.mock("@/lib/queue", () => ({ addJob: addJobMock }));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ debug: vi.fn(), info: vi.fn() }),
}));

const params = {
	deliveryId: "delivery-1",
	webhookEndpointId: "endpoint-1",
	organizationId: "org-1",
	url: "https://webhook.example.com/events",
	payload: {
		id: "event-1",
		type: "password_changed" as const,
		createdAt: "2026-01-01T00:00:00.000Z",
		data: {},
	},
	eventType: "password_changed" as const,
};

describe("webhook queue retry configuration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		addJobMock.mockResolvedValue({ id: "job-1" });
	});

	it.each([
		[2, 2000],
		[3, 6000],
	])(
		"uses configured delay for attempt %i",
		async (attemptNumber, expectedDelay) => {
			const { addWebhookJob } = await import("./webhook-queue");

			await addWebhookJob({ ...params, attemptNumber });

			expect(addJobMock).toHaveBeenCalledWith(
				"webhook-delivery-delivery-1",
				expect.objectContaining({ attemptNumber }),
				expect.objectContaining({ delay: expectedDelay }),
			);
		},
	);

	it("uses configured max attempts rather than delay-list length", async () => {
		const { scheduleWebhookRetry } = await import("./webhook-queue");

		const result = await scheduleWebhookRetry({ ...params, attemptNumber: 3 });

		expect(result).toBeNull();
		expect(addJobMock).not.toHaveBeenCalled();
	});
});
