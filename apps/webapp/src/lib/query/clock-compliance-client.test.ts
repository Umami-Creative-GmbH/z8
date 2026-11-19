import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClockComplianceSnapshot } from "@/lib/compliance/clock-compliance-types";
import { superJsonResponse } from "@/lib/superjson";
import { fetchClockCompliance } from "./clock-compliance-client";

const scope = { userId: "user-a", organizationId: "org-a", employeeId: "employee-a" };
const snapshot: ClockComplianceSnapshot = {
	scope,
	mode: "idle",
	alerts: [],
	myExceptions: [],
	restPeriod: {
		canClockIn: false,
		enforcement: "block",
		violation: null,
		hasValidException: false,
		nextAllowedClockIn: new Date("2026-11-17T10:00:00Z"),
	},
};

afterEach(() => vi.unstubAllGlobals());

describe("fetchClockCompliance", () => {
	it("sends one cancellable private GET and preserves boundary dates", async () => {
		const fetch = vi.fn(async () => superJsonResponse(snapshot));
		vi.stubGlobal("fetch", fetch);
		const signal = new AbortController().signal;
		expect(await fetchClockCompliance(scope, "idle", 0, signal)).toEqual(snapshot);
		expect(fetch).toHaveBeenCalledExactlyOnceWith(
			"/api/time-entries/compliance?mode=idle&currentSessionMinutes=0",
			{
				cache: "no-store",
				signal,
				headers: { "x-z8-context-user": "user-a", "x-z8-context-organization": "org-a" },
			},
		);
	});

	it.each([
		{ ...scope, userId: "other-user" },
		{ ...scope, organizationId: "other-org" },
		{ ...scope, employeeId: "other-employee" },
	])("rejects a response from a replaced actor scope: %j", async (returnedScope) => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => superJsonResponse({ ...snapshot, scope: returnedScope })),
		);
		await expect(
			fetchClockCompliance(scope, "idle", 0, new AbortController().signal),
		).rejects.toMatchObject({ status: 409 });
	});
});
