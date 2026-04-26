import { afterEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	resolveAndValidateUrl: vi.fn(),
}));

vi.mock("./url-validation", () => ({
	resolveAndValidateUrl: mockState.resolveAndValidateUrl,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
	}),
}));

const { executeWebhookRequest } = await import("./webhook-delivery");

describe("executeWebhookRequest", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
	});

	it("does not automatically follow redirects after validating the original webhook URL", async () => {
		mockState.resolveAndValidateUrl.mockResolvedValue({ valid: true });
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(null, {
				status: 302,
				headers: { Location: "http://169.254.169.254/latest/meta-data/" },
			}),
		);

		await executeWebhookRequest({
			url: "https://webhook.example.com/events",
			payload: {
				id: "event-1",
				type: "password_changed",
				createdAt: "2026-01-01",
				data: {},
			},
			secret: "secret",
			eventType: "password_changed",
			deliveryId: "delivery-1",
		});

		expect(fetchSpy).toHaveBeenCalledWith(
			"https://webhook.example.com/events",
			expect.objectContaining({ redirect: "manual" }),
		);
	});
});
