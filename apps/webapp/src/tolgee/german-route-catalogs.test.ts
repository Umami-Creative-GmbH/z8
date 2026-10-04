import { describe, expect, it, vi } from "vitest";
import { applyCatalogRecords } from "./catalog-store";
import { loadCatalogSlice, loadShellTranslations } from "./load-translations";
import { getNamespacesForRoute, TolgeeBase } from "./shared";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));

describe("German route catalogs", () => {
	it("retains German shared-dialog and presence copy across route catalog navigation", async () => {
		const tolgee = TolgeeBase({ loadAllLanguageCatalogs: false }).init({
			language: "de",
			staticData: { de: {} },
		});
		applyCatalogRecords(tolgee, await loadShellTranslations("de"));
		await tolgee.run();
		try {
			for (const route of [
				"/team",
				"/calendar",
				"/time-tracking",
				"/approvals/inbox",
			]) {
				applyCatalogRecords(
					tolgee,
					await loadCatalogSlice("de", getNamespacesForRoute(route)),
				);
				expect(
					tolgee.t("common.timeInput.openTimePicker", "Open time picker"),
				).toBe("Zeitauswahl öffnen");
				expect(tolgee.t("presence.clockedOut", "Clocked out")).toBe(
					"Ausgestempelt",
				);
				expect(
					tolgee.t("presence.activity.lastActivity", { date: "03.10." }),
				).toBe("letzte Aktivität 03.10.");
			}
			expect(
				tolgee.t("calendar.requirements.dayLabel", {
					date: "4. Oktober",
					required: "8h",
					actual: "7h",
					delta: "-1h",
					status: "Sollzeit unterschritten",
				}),
			).toBe(
				"4. Oktober: 8h Sollzeit, 7h erfasst, -1h Differenz, Sollzeit unterschritten",
			);
			expect(
				tolgee.t("calendar.calendar.break.titleWithDuration", {
					duration: "30m",
				}),
			).toBe("Pause – 30m");
		} finally {
			tolgee.stop();
		}
	});
	it.each([
		[
			"/approvals/inbox",
			"approvals:approvals.types.absence_entry",
			"Abwesenheitsanträge",
		],
		["/time-tracking", "timeTracking.title", "Zeiterfassung"],
		[
			"/time-tracking",
			"timeTracking.table.recordedLocalTime",
			"Erfasste Ortszeit",
		],
		["/time-tracking", "common.timeInput.openTimePicker", "Zeitauswahl öffnen"],
		[
			"/calendar",
			"calendar.requirements.status.missing",
			"Fehlende erfasste Zeit",
		],
	])("provides German copy for %s: %s", async (route, key, expected) => {
		const slice = await loadCatalogSlice("de", getNamespacesForRoute(route));
		const tolgee = TolgeeBase({ loadAllLanguageCatalogs: false }).init({
			language: "de",
			staticData: slice.records,
		});
		await tolgee.run();
		try {
			expect(tolgee.t(key, "English fallback")).toBe(expected);
		} finally {
			tolgee.stop();
		}
	});
	it("translates the work diagnostics summary on initial load", async () => {
		const slice = await loadCatalogSlice(
			"de",
			getNamespacesForRoute("/settings/work-diagnostics"),
		);
		const tolgee = TolgeeBase({ loadAllLanguageCatalogs: false }).init({
			language: "de",
			staticData: slice.records,
		});
		await tolgee.run();
		try {
			expect(
				tolgee.t("settings.workDiagnostics.summary.status", "Completeness"),
			).toBe("Vollständigkeit");
			expect(
				tolgee.t("settings.workDiagnostics.previousMonth", "Previous month"),
			).toBe("Vorheriger Monat");
		} finally {
			tolgee.stop();
		}
	});
});
