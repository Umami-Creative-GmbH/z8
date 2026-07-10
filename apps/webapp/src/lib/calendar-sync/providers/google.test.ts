import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarEventToCreate, CalendarProviderCredentials } from "../types";
import { GoogleCalendarProvider } from "./google";

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

describe("GoogleCalendarProvider.createEvent", () => {
	it("uses the idempotency key as the Google event ID", async () => {
		const fetchMock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						id: idempotencyKey,
						start: { dateTime: event.startDate.toISOString() },
						end: { dateTime: event.endDate.toISOString() },
						status: "confirmed",
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
		);
		globalThis.fetch = fetchMock as typeof fetch;

		await Effect.runPromise(
			new GoogleCalendarProvider().createEvent(credentials, "primary", event),
		);

		const [, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(JSON.parse(request.body as string)).toMatchObject({
			id: idempotencyKey,
			summary: "Annual leave",
		});
	});

	it("treats a conflict for a deterministic event ID as an idempotent success", async () => {
		globalThis.fetch = vi.fn(async () => new Response(null, { status: 409 })) as typeof fetch;

		const result = await Effect.runPromise(
			new GoogleCalendarProvider().createEvent(credentials, "primary", event),
		);

		expect(result).toEqual({ id: idempotencyKey });
	});
});
