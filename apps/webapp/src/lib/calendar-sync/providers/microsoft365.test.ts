import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarEventToCreate, CalendarProviderCredentials } from "../types";
import { Microsoft365CalendarProvider } from "./microsoft365";

const originalFetch = globalThis.fetch;
const idempotencyKey = "a".repeat(64);
const credentials: CalendarProviderCredentials = {
	accessToken: "access-token",
	refreshToken: null,
	expiresAt: null,
	scope: null,
};
const event: CalendarEventToCreate = {
	title: "Annual leave",
	startDate: new Date("2026-07-13T08:00:00.000Z"),
	endDate: new Date("2026-07-13T16:00:00.000Z"),
	isAllDay: false,
	idempotencyKey,
};

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("Microsoft365CalendarProvider.createEvent", () => {
	it("uses the idempotency key as the Microsoft transaction ID", async () => {
		const fetchMock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						id: "provider-event-id",
						start: { dateTime: event.startDate.toISOString(), timeZone: "UTC" },
						end: { dateTime: event.endDate.toISOString(), timeZone: "UTC" },
						isAllDay: false,
						showAs: "oof",
					}),
					{ status: 201, headers: { "Content-Type": "application/json" } },
				),
		);
		globalThis.fetch = fetchMock as typeof fetch;

		await Effect.runPromise(
			new Microsoft365CalendarProvider().createEvent(credentials, "primary", event),
		);

		const [, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(JSON.parse(request.body as string)).toMatchObject({
			transactionId: idempotencyKey,
			subject: "Annual leave",
		});
	});
});
