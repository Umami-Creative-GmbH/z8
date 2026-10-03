import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAutoClockOutNotification, planAutoClockOutChannels } from "./notifications";
import { decision } from "./testing.test.fixture";

describe("automatic clock-out notification", () => {
	afterEach(() => vi.unstubAllEnvs());
	it("renders the recipient locale with cutoff DST zone and links the work's starting local day", () => {
		vi.stubEnv("TZ", "Pacific/Honolulu");
		const facts = decision();
		const en = buildAutoClockOutNotification({
			decision: facts,
			recipientUserId: "recipient",
			locale: "en",
		});
		const de = buildAutoClockOutNotification({
			decision: facts,
			recipientUserId: "recipient",
			locale: "de",
		});
		expect(en.title).toBe("Automatically clocked out");
		expect(en.message).toContain("720");
		expect(en.message).toContain("Europe/Berlin");
		expect(de.message).toContain("07:00");
		expect(de.message).toContain("25.10.2026");
		expect(de.title).toBe("Automatisch ausgestempelt");
		expect(en.actionUrl).toBe(`/calendar/${facts.employeeId}?date=2026-10-24`);
		expect(en.idempotencyKey).toBe(`automatic-clock-out:${facts.operationId}:recipient`);
		expect(en.metadata?.i18n).toMatchObject({
			titleKey: "common:notifications.content.automaticClockOut.title",
		});
	});
	it("always includes inbox and stages enabled optional channels for independent availability checks", () => {
		expect(
			planAutoClockOutChannels({
				in_app: false,
				email: true,
				push: false,
				teams: true,
				telegram: false,
				slack: false,
				discord: false,
			}),
		).toEqual(["in_app", "email", "teams"]);
	});
});
