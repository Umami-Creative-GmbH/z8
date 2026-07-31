import { DateTime } from "luxon";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createMobileClockInAction,
	createMobileClockOutAction,
	getActionTimeTimezone,
} from "./clock-action";

const fixedNow = DateTime.fromISO("2026-07-10T12:30:00.123Z", { zone: "utc" });

afterEach(() => {
	vi.restoreAllMocks();
});

function fakeIntl(timeZone: string) {
	return {
		DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone }) }),
	} as Pick<typeof Intl, "DateTimeFormat">;
}

describe("mobile clock action evidence", () => {
	it("captures the instant, IANA timezone, and offset at the clock-in tap", () => {
		expect(
			createMobileClockInAction({
				workLocationType: "home",
				now: fixedNow,
				intlApi: fakeIntl("Asia/Kathmandu"),
			}),
		).toEqual({
			action: "clock_in",
			workLocationType: "home",
			timestamp: "2026-07-10T12:30:00.123Z",
			browserTimezone: "Asia/Kathmandu",
			utcOffsetMinutes: 345,
		});
	});

	it("uses UTC evidence when the device timezone is unavailable", () => {
		const submissionId = "10000000-0000-4000-8000-000000000099";
		const randomUUID = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValue(submissionId);
		expect(
			createMobileClockOutAction({ now: fixedNow, intlApi: fakeIntl("Not/AZone") }),
		).toEqual({
			action: "clock_out",
			submissionId,
			timestamp: "2026-07-10T12:30:00.123Z",
			browserTimezone: "UTC",
			utcOffsetMinutes: 0,
		});
		expect(getActionTimeTimezone(fakeIntl("Not/AZone"))).toBeNull();
		expect(randomUUID).toHaveBeenCalledOnce();
		randomUUID.mockRestore();
	});

	it("scopes submission ids to deliberate actions and preserves one serialized retry id", () => {
		const firstSubmissionId = "10000000-0000-4000-8000-000000000099";
		const secondSubmissionId = "20000000-0000-4000-8000-000000000099";
		const randomUUID = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce(firstSubmissionId)
			.mockReturnValueOnce(secondSubmissionId);

		const firstAction = createMobileClockOutAction({
			now: fixedNow,
			intlApi: fakeIntl("Europe/Berlin"),
		});
		const serializedRetry = JSON.parse(
			JSON.stringify(firstAction),
		) as typeof firstAction;
		const secondAction = createMobileClockOutAction({
			now: fixedNow,
			intlApi: fakeIntl("Europe/Berlin"),
		});

		expect([
			firstAction.submissionId,
			serializedRetry.submissionId,
			secondAction.submissionId,
		]).toEqual([firstSubmissionId, firstSubmissionId, secondSubmissionId]);
		expect(randomUUID).toHaveBeenCalledTimes(2);
		randomUUID.mockRestore();
	});
});
