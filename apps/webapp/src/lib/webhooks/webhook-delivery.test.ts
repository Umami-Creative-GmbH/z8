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

vi.mock("./webhook-config.server", () => ({
	MAX_RESPONSE_BODY_LENGTH: 5,
	WEBHOOK_TIMEOUT_MS: 1234,
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
		vi.useRealTimers();
		vi.restoreAllMocks();
		vi.clearAllMocks();
		mockState.agentOptions = undefined;
	});

	it("aborts requests after the configured timeout", async () => {
		vi.useFakeTimers();
		mockState.resolveAndValidateUrl.mockResolvedValue({
			valid: true,
			addresses: [{ address: "93.184.216.34", family: 4 }],
		});
		mockState.fetch.mockImplementation((_url: string, init: RequestInit) => {
			return new Promise((_resolve, reject) => {
				init.signal?.addEventListener(
					"abort",
					() => reject(new DOMException("Aborted", "AbortError")),
					{ once: true },
				);
			});
		});
		const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

		const resultPromise = executeWebhookRequest({
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
		await vi.advanceTimersByTimeAsync(0);
		expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1234);

		await vi.advanceTimersByTimeAsync(1234);

		await expect(resultPromise).resolves.toEqual(
			expect.objectContaining({
				success: false,
				errorMessage: "Request timeout after 1234ms",
			}),
		);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("truncates response bodies to the configured character length", async () => {
		mockState.resolveAndValidateUrl.mockResolvedValue({
			valid: true,
			addresses: [{ address: "93.184.216.34", family: 4 }],
		});
		mockState.fetch.mockResolvedValue(new Response("abcdefghi", { status: 200 }));

		const result = await executeWebhookRequest({
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

		expect(result.responseBody).toBe("abcde");
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
