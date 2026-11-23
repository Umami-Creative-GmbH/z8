import { describe, expect, it, vi } from "vitest";
import { applyCatalogRecords } from "./catalog-store";
import { loadCatalogSlice, loadShellTranslations } from "./load-translations";
import { getRouteCatalogScope } from "./route-catalog-scopes";
import { getNamespacesForRoute, loadNamespaces, TolgeeBase } from "./shared";

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
			for (const route of ["/team", "/calendar", "/time-tracking", "/approvals/inbox"]) {
				applyCatalogRecords(tolgee, await loadCatalogSlice("de", getNamespacesForRoute(route)));
				expect(tolgee.t("common.timeInput.openTimePicker", "Open time picker")).toBe(
					"Zeitauswahl öffnen",
				);
				expect(tolgee.t("presence.clockedOut", "Clocked out")).toBe("Ausgestempelt");
				expect(tolgee.t("presence.activity.lastActivity", { date: "03.10." })).toBe(
					"letzte Aktivität 03.10.",
				);
			}
			expect(
				tolgee.t("calendar.requirements.dayLabel", {
					date: "4. Oktober",
					required: "8h",
					actual: "7h",
					delta: "-1h",
					status: "Sollzeit unterschritten",
				}),
			).toBe("4. Oktober: 8h Sollzeit, 7h erfasst, -1h Differenz, Sollzeit unterschritten");
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
		["/approvals/inbox", "approvals:approvals.types.absence_entry", "Abwesenheitsanträge"],
		["/time-tracking", "timeTracking.title", "Zeiterfassung"],
		["/time-tracking", "timeTracking.table.recordedLocalTime", "Erfasste Ortszeit"],
		["/time-tracking", "common.timeInput.openTimePicker", "Zeitauswahl öffnen"],
		["/calendar", "calendar.requirements.status.missing", "Fehlende erfasste Zeit"],
		["/travel-expenses", "travelExpenses.history.emptyTitle", "Noch keine Reisekosten"],
		["/travel-expenses", "travelExpenses.report.actions.newReceipt", "Neuer Beleg"],
		["/travel-expenses", "travelExpenses.report.actions.newTrip", "Neue Reise"],
		["/travel-expenses", "common.loadingRegions.travelExpenses", "Reisekosten werden geladen"],
		["/travel-expenses/reports/report-1", "travelExpenses.report.trip.title", "Reisedetails"],
		[
			"/travel-expenses/reports/report-1",
			"travelExpenses.report.status.submitted",
			"Wartet auf Überprüfung",
		],
		["/travel-expenses/finance", "travelExpenses.finance.title", "Ausgaben-Finanzen"],
		["/approvals/inbox", "approvals:approvals.types.travel_expense_report", "Ausgabenberichte"],
		["/approvals/inbox", "travelExpenses.report.status.submitted", "Wartet auf Überprüfung"],
		["/settings/travel-expenses", "settings.travelExpenses.title", "Reisekostenrichtlinien"],
		["/settings/travel-expenses", "travelExpenses.settings.tabs.rates", "Sätze"],
		[
			"/settings/travel-expenses",
			"common.loadingRegions.travelExpenseSettings",
			"Reisekosteneinstellungen werden geladen",
		],
		["/settings/contracts", "settings.contracts.title", "Verträge"],
		["/settings/contracts", "settings.contracts.tabs.defaults", "Standards"],
		[
			"/settings/contracts",
			"settings.contracts.onCall.statutoryMinDaily",
			"Keine tägliche Abrufdauer vereinbart — nach § 12 Abs. 1 TzBfG gelten mindestens drei aufeinanderfolgende Stunden je Abruf",
		],
		["/settings/employees", "settings.employees.leavingDate.title", "Austrittsdatum"],
		[
			"/settings/employees",
			"settings.employees.offboarding.contractorRehireHint",
			"Ein Externer Dienstleister erhält keinen Arbeitsvertrag, keine Arbeitszeitrichtlinie und keinen Urlaubsanspruch. Dienstleistersätze werden gesondert festgelegt.",
		],
		["/settings/employees", "organization.invite.engagement.label", "Einladen als"],
		// Contractor compensation (#1998): the Employee Detail card and the Contracts tab.
		[
			"/settings/employees",
			"settings.contracts.contractors.title",
			"Vergütung Externer Dienstleister",
		],
		["/settings/contracts", "settings.contracts.tabs.contractors", "Externe Dienstleister"],
		[
			"/settings/contracts",
			"settings.contracts.contractors.rules.halfAndFullDay",
			"Halbe und ganze Tage",
		],
		["/settings/employees", "settings.contracts.employee.effectiveTitle", "Wirksamer Vertrag"],
		["/settings/notification-channels", "settings.discord.connect", "Discord-Bot verbinden"],
		[
			"/settings/notification-channels",
			"settings.discord.interactionEndpointUrl",
			"Interaktions-Endpunkt-URL",
		],
		[
			"/settings/notification-channels",
			"settings.discord.errors.invalidBotToken",
			"Ungültiges Bot-Token. Prüfen Sie Ihre Discord-Bot-Zugangsdaten und versuchen Sie es erneut.",
		],
		[
			"/settings/notification-channels",
			"settings.discord.errors.applicationIdMismatch",
			"Die Anwendungs-ID stimmt nicht mit dem angegebenen Bot-Token überein.",
		],
		[
			"/settings/notification-channels",
			"settings.discord.errors.publicKeyMismatch",
			"Der öffentliche Schlüssel stimmt nicht mit der Discord-Anwendung überein.",
		],
		[
			"/settings/report-share-links",
			"settings.reportShareLinks.projectsDisabledNotice.title",
			"Projekte sind deaktiviert",
		],
		[
			"/settings/report-share-links",
			"settings.reportShareLinks.projectsDisabledNotice.description",
			"Projekte sind für diese Organisation derzeit deaktiviert, sodass keine neuen Berichtsfreigabe-Links erstellt werden können. Bestehende Links können Sie hier weiterhin einsehen und widerrufen.",
		],
	])("provides German copy for %s: %s", async (route, key, expected) => {
		const namespaces = getRouteCatalogScope(route)?.namespaces;
		if (!namespaces) throw new Error(`No catalog scope for ${route}`);
		const slice = await loadCatalogSlice("de", namespaces);
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
	it.each(["/sign-in", "/licenses/third-party", "/team", "/"])(
		"resolves common:-prefixed header labels on %s",
		async (route) => {
			const namespaces = getRouteCatalogScope(route)?.namespaces;
			if (!namespaces) throw new Error(`No catalog scope for ${route}`);
			const tolgee = TolgeeBase({ loadAllLanguageCatalogs: false }).init({
				language: "de",
				staticData: { de: {} },
			});
			applyCatalogRecords(tolgee, await loadShellTranslations("de"));
			applyCatalogRecords(tolgee, await loadCatalogSlice("de", namespaces));
			await tolgee.run();
			try {
				expect(tolgee.t("common:user.theme-toggle", "Toggle theme")).toBe("Design umschalten");
				expect(tolgee.t("common:user.font-size", "Font size")).toBe("Schriftgröße");
				// The External Contractor badge of the shared pickers (#1995).
				expect(tolgee.t("common:engagement.externalContractor", "External Contractor")).toBe(
					"Externer Dienstleister",
				);
			} finally {
				tolgee.stop();
			}
		},
	);
	it("resolves common:-prefixed keys in server catalogs", async () => {
		const tolgee = TolgeeBase({ loadAllLanguageCatalogs: false }).init({
			language: "de",
			staticData: await loadNamespaces("de", ["common"]),
		});
		await tolgee.run();
		try {
			expect(tolgee.t("common:notifications.time.justNow", "just now")).toBe("gerade eben");
		} finally {
			tolgee.stop();
		}
	});
	it("translates the work diagnostics summary on initial load", async () => {
		const slice = await loadCatalogSlice("de", getNamespacesForRoute("/settings/work-diagnostics"));
		const tolgee = TolgeeBase({ loadAllLanguageCatalogs: false }).init({
			language: "de",
			staticData: slice.records,
		});
		await tolgee.run();
		try {
			expect(tolgee.t("settings.workDiagnostics.summary.status", "Completeness")).toBe(
				"Vollständigkeit",
			);
			expect(tolgee.t("settings.workDiagnostics.previousMonth", "Previous month")).toBe(
				"Vorheriger Monat",
			);
		} finally {
			tolgee.stop();
		}
	});
});
