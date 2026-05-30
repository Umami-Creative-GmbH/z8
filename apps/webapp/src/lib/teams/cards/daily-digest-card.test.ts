import { describe, expect, it } from "vitest";
import type { DailyDigestData } from "../types";
import { buildDailyDigestCard } from "./daily-digest-card";

const t = (key: string, defaultValue: string, params?: Record<string, string | number>) => {
	const translations: Record<string, string> = {
		"teamsBot:digest.title": "Tägliche Zusammenfassung",
		"teamsBot:digest.pendingApprovals": "Ausstehende Genehmigungen",
		"teamsBot:digest.noPendingApprovals": "Keine ausstehenden Genehmigungen",
		"teamsBot:digest.whosOutToday": "Heute abwesend",
		"teamsBot:digest.everyoneAvailable": "Heute sind alle verfügbar",
		"teamsBot:digest.currentlyClockedIn": "Derzeit eingestempelt",
		"teamsBot:digest.noOneClockedIn": "Noch niemand ist eingestempelt",
		"teamsBot:digest.openDashboard": "Z8-Dashboard öffnen",
	};

	return Object.entries(params ?? {}).reduce(
		(message, [name, value]) => message.replace(`{${name}}`, String(value)),
		translations[key] ?? defaultValue,
	);
};

function digestData(): DailyDigestData {
	return {
		date: new Date("2026-05-20T08:00:00.000Z"),
		timezone: "Europe/Berlin",
		pendingApprovals: 0,
		employeesOut: [],
		employeesClockedIn: [],
	};
}

function collectStrings(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(collectStrings);
	if (value && typeof value === "object") {
		return Object.values(value).flatMap(collectStrings);
	}
	return [];
}

describe("buildDailyDigestCard", () => {
	it("uses a provided translator for static Teams digest card copy", () => {
		const card = buildDailyDigestCard(digestData(), "https://z8.test", "de", t);
		const strings = collectStrings(card);

		expect(strings).toContain("Tägliche Zusammenfassung");
		expect(strings).toContain("Ausstehende Genehmigungen");
		expect(strings).toContain("Keine ausstehenden Genehmigungen");
		expect(strings).toContain("Heute abwesend");
		expect(strings).toContain("Heute sind alle verfügbar");
		expect(strings).toContain("Derzeit eingestempelt");
		expect(strings).toContain("Noch niemand ist eingestempelt");
		expect(strings).toContain("Z8-Dashboard öffnen");
	});
});
