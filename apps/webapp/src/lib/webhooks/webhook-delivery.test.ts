import { afterEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	resolveAndValidateUrl: vi.fn(),
	fetch: vi.fn(),
	agentClose: vi.fn(),
	agentOptions: undefined as unknown,
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

vi.mock("undici", () => ({
	Agent: class MockAgent {
		constructor(options: unknown) {
			mockState.agentOptions = options;
		}

		close = mockState.agentClose;
	},
	fetch: mockState.fetch,
}));

const { executeWebhookRequest } = await import("./webhook-delivery");

describe("executeWebhookRequest", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
		mockState.agentOptions = undefined;
	});

	it("does not automatically follow redirects after validating the original webhook URL", async () => {
		mockState.resolveAndValidateUrl.mockResolvedValue({
			valid: true,
			addresses: [{ address: "93.184.216.34", family: 4 }],
		});
		mockState.fetch.mockResolvedValue(
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

		expect(mockState.fetch).toHaveBeenCalledWith(
			"https://webhook.example.com/events",
			expect.objectContaining({ redirect: "manual", dispatcher: expect.anything() }),
		);
	});

	it("pins the request lookup to the validated DNS answers", async () => {
		mockState.resolveAndValidateUrl.mockResolvedValue({
			valid: true,
			addresses: [{ address: "93.184.216.34", family: 4 }],
		});
		mockState.fetch.mockResolvedValue(new Response(null, { status: 204 }));

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

		const lookup = (
			mockState.agentOptions as {
				connect: {
					lookup: (
						hostname: string,
						options: object,
						callback: (error: Error | null, address: string, family: number) => void,
					) => void;
				};
			}
		).connect.lookup;
		const callback = vi.fn();
		lookup("webhook.example.com", {}, callback);

		expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
		expect(mockState.agentClose).toHaveBeenCalledOnce();
	});
});
