import { describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	findMany: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			webhookEndpoint: {
				findMany: mockState.findMany,
			},
		},
	},
}));

vi.mock("@/db/schema", () => ({
	webhookDelivery: {},
	webhookEndpoint: {
		organizationId: "webhookEndpoint.organizationId",
		createdAt: "webhookEndpoint.createdAt",
	},
}));

vi.mock("drizzle-orm", () => ({
	and: (...args: unknown[]) => args,
	eq: (...args: unknown[]) => args,
	sql: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
	}),
}));

vi.mock("./webhook-config.server", () => ({
	MAX_ATTEMPTS: 3,
	RETRY_DELAYS_MS: [0, 2000, 6000],
}));

const { getRetryDelay, getWebhookEndpointsByOrganization } = await import("./webhook-service");

describe("getRetryDelay", () => {
	it("uses the next attempt delay after a failed attempt", () => {
		expect(getRetryDelay(1)).toBe(2000);
		expect(getRetryDelay(2)).toBe(6000);
	});
});

describe("getWebhookEndpointsByOrganization", () => {
	it("does not return webhook signing secrets for client-facing lists", async () => {
		mockState.findMany.mockResolvedValue([
			{
				id: "webhook-1",
				organizationId: "org-1",
				name: "Payroll",
				url: "https://example.com/webhook",
				secret: "whsec_secret",
				subscribedEvents: ["time_entry.created"],
				isActive: true,
				createdAt: new Date("2026-01-01T00:00:00Z"),
				updatedAt: new Date("2026-01-01T00:00:00Z"),
			},
		]);

		const endpoints = await getWebhookEndpointsByOrganization("org-1");

		expect(endpoints).toHaveLength(1);
		expect(endpoints[0]).not.toHaveProperty("secret");
	});
});
