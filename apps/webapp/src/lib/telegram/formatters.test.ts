import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApprovalMessage } from "./formatters";

const translate = (_key: string, defaultValue: string) => defaultValue;

const approval = {
	approvalId: "approval-1",
	createdAt: new Date("2026-07-10T14:00:00.000Z"),
	endDate: "2026-07-11",
	entityType: "absence_entry" as const,
	requesterName: "Avery",
	startDate: "2026-07-10",
};

describe("buildApprovalMessage", () => {
	afterEach(() => vi.unstubAllEnvs());

	it("formats the same submitted instant in each recipient's explicit timezone", () => {
		const berlin = buildApprovalMessage(approval, translate, {
			locale: "en-US",
			timeFormat: "24h",
			timezone: "Europe/Berlin",
		});
		const newYork = buildApprovalMessage(approval, translate, {
			locale: "en-US",
			timeFormat: "12h",
			timezone: "America/New_York",
		});

		expect(berlin.text).toContain("Jul 10, 16:00");
		expect(newYork.text).toContain("Jul 10, 10:00 AM");
	});

	it("does not use the host timezone when recipient context is explicit", () => {
		vi.stubEnv("TZ", "UTC");
		const utcHost = buildApprovalMessage(approval, translate, {
			locale: "en-US",
			timeFormat: "24h",
			timezone: "Europe/Berlin",
		});
		vi.stubEnv("TZ", "America/Los_Angeles");
		const losAngelesHost = buildApprovalMessage(approval, translate, {
			locale: "en-US",
			timeFormat: "24h",
			timezone: "Europe/Berlin",
		});

		expect(losAngelesHost.text).toBe(utcHost.text);
	});

	it("treats absence dates as logical dates rather than instants", () => {
		const message = buildApprovalMessage(approval, translate, {
			locale: "en-US",
			timeFormat: "12h",
			timezone: "America/New_York",
		});

		expect(message.text).toContain("Jul 10 \\- Jul 11");
	});
});
