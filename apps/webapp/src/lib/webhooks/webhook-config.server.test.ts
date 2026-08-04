import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
	env: {
		WEBHOOK_RETRY_DELAYS_MS: "0,2000,6000",
		WEBHOOK_MAX_ATTEMPTS: "3",
		WEBHOOK_TIMEOUT_MS: "31000",
		WEBHOOK_MAX_RESPONSE_BODY_LENGTH: "11240",
	},
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
	}),
}));
vi.mock("./webhook-delivery", () => ({ executeWebhookRequest: vi.fn() }));
vi.mock("./webhook-queue", () => ({ scheduleWebhookRetry: vi.fn() }));
vi.mock("./webhook-service", () => ({
	checkAndDisableUnhealthyEndpoint: vi.fn(),
	getRetryDelay: vi.fn(),
	getWebhookEndpoint: vi.fn(),
	updateDeliveryRecord: vi.fn(),
	updateEndpointStats: vi.fn(),
}));

describe("webhook server configuration", () => {
	it("parses operational settings from env", async () => {
		const config = await import("./webhook-config.server");

		expect(config.RETRY_DELAYS_MS).toEqual([0, 2000, 6000]);
		expect(config.MAX_ATTEMPTS).toBe(3);
		expect(config.WEBHOOK_TIMEOUT_MS).toBe(31000);
		expect(config.MAX_RESPONSE_BODY_LENGTH).toBe(11240);
	});

	it("imports worker configuration without a server-only runtime dependency", async () => {
		const configPath = fileURLToPath(new URL("./webhook-config.server.ts", import.meta.url));

		expect(readFileSync(configPath, "utf8")).not.toContain('import "server-only"');
		await expect(import("./webhook-config.server")).resolves.toBeDefined();
		await expect(import("./webhook-worker")).resolves.toBeDefined();
	});
});
