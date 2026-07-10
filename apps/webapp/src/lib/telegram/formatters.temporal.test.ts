import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { buildApprovalMessage, buildResolvedApprovalMessage } from "./formatters";

const execFileAsync = promisify(execFile);

function normalizeWhitespace(value: string): string {
	return value.replace(/\s/gu, " ").replace(/ +/gu, " ");
}

function approvalText(timezone: string, timeFormat: "12h" | "24h"): string {
	return buildApprovalMessage(
		{
			approvalId: "approval-1",
			entityType: "time_entry",
			requesterName: "Ada",
			createdAt: new Date("2026-07-10T12:30:00.000Z"),
			originalTime: "2026-07-10T12:30:00.000Z",
			originalTimeOffsetMinutes: -240,
		},
		{ locale: "en-US", timezone, timeFormat },
	).text;
}

describe("Telegram approval temporal formatting", () => {
	it("renders the same approval instant in each recipient timezone while preserving the audit offset", () => {
		const newYork = normalizeWhitespace(approvalText("America/New_York", "12h"));
		const berlin = normalizeWhitespace(approvalText("Europe/Berlin", "24h"));

		expect(newYork).toContain("Jul 10, 2026, 8:30 AM");
		expect(berlin).toContain("Jul 10, 2026, 14:30");
		expect(newYork).toContain("Original event: Jul 10, 2026, 8:30 AM");
		expect(berlin).toContain("Original event: Jul 10, 2026, 08:30");
	});

	it("does not inherit the UTC/Honolulu host timezone", async () => {
		const text = normalizeWhitespace(approvalText("Europe/Berlin", "24h"));
		expect(text).toContain("Jul 10, 2026, 14:30");

		if (process.env.TELEGRAM_TEMPORAL_HONOLULU_HOST === "1") return;

		await execFileAsync(
			"pnpm",
			["exec", "vitest", "run", "src/lib/telegram/formatters.temporal.test.ts", "--reporter=dot"],
			{
				cwd: process.cwd(),
				env: {
					...process.env,
					TELEGRAM_TEMPORAL_HONOLULU_HOST: "1",
					TZ: "Pacific/Honolulu",
				},
			},
		);
	}, 15_000);

	it("keeps logical absence dates unchanged across recipient and host timezones", () => {
		const data = {
			approvalId: "approval-1",
			entityType: "absence_entry" as const,
			requesterName: "Ada",
			createdAt: new Date("2026-07-10T12:30:00.000Z"),
			startDate: "2026-01-01",
			endDate: "2026-01-02",
		};

		const newYork = normalizeWhitespace(
			buildApprovalMessage(data, {
				locale: "en-US",
				timezone: "America/New_York",
				timeFormat: "12h",
			}).text,
		);
		const berlin = normalizeWhitespace(
			buildApprovalMessage(data, {
				locale: "en-US",
				timezone: "Europe/Berlin",
				timeFormat: "24h",
			}).text,
		);

		expect(newYork).toContain("Jan 1, 2026 \\- Jan 2, 2026");
		expect(berlin).toContain("Jan 1, 2026 \\- Jan 2, 2026");
	});

	it("keeps the captured audit endpoint after an approval is resolved", () => {
		const text = normalizeWhitespace(
			buildResolvedApprovalMessage(
				{
					approvalId: "approval-1",
					entityType: "time_entry",
					requesterName: "Ada",
					createdAt: new Date("2026-07-10T12:30:00.000Z"),
					originalTime: "2026-07-10T12:30:00.000Z",
					originalTimeOffsetMinutes: -240,
				},
				{
					action: "approved",
					approverName: "Lin",
					resolvedAt: new Date("2026-07-10T13:30:00.000Z"),
				},
				{ locale: "en-US", timezone: "Europe/Berlin", timeFormat: "24h" },
			),
		);

		expect(text).toContain("Original event: Jul 10, 2026, 08:30");
	});
});
