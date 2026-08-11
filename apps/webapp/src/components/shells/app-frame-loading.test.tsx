/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppFrameLoading } from "./app-frame-loading";
import { AuthContentLoading } from "./auth-content-loading";
import { SettingsContentLoading } from "./settings-content-loading";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (key: string, fallback: string) => {
			const translations: Record<string, string> = {
				"common:loading.application": "Anwendung wird geladen",
				"common:loading.authentication": "Anmeldung wird geladen",
				"common:loading.chart": "Diagramm wird geladen",
				"common:loading.settings": "Einstellungen werden geladen",
			};
			return translations[key] ?? fallback;
		},
	}),
}));

describe("AppFrameLoading", () => {
	it("renders a neutral authenticated frame without tenant data", () => {
		const { container } = render(<AppFrameLoading />);

		expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
		expect(screen.getByText("Anwendung wird geladen")).toBeTruthy();
		expect(screen.getByTestId("app-sidebar-loading")).toBeTruthy();
		expect(screen.getByTestId("app-header-loading")).toBeTruthy();
		expect(container.textContent).toBe("Anwendung wird geladen");
	});

	it("does not import sensitive application modules", () => {
		const forbiddenImport =
			/from\s+["'][^"']*(?:auth|db|organization|billing|notification|session)/i;
		const shellModules = [
			"app-frame-loading.tsx",
			"auth-content-loading.tsx",
			"settings-content-loading.tsx",
		];

		for (const fileName of shellModules) {
			const source = readFileSync(new URL(fileName, import.meta.url), "utf8");
			expect(source, fileName).not.toMatch(forbiddenImport);
		}
	});
});

describe("AuthContentLoading", () => {
	it("renders a named busy region with generic auth card structure", () => {
		const { container } = render(<AuthContentLoading />);

		expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
		expect(screen.getByText("Anmeldung wird geladen")).toBeTruthy();
		expect(container.querySelector('[data-slot="card"]')).toBeTruthy();
		expect(container.textContent).toBe("Anmeldung wird geladen");
	});
});

describe("SettingsContentLoading", () => {
	it("immediately renders a localized busy region with generic settings structure", () => {
		const { container } = render(<SettingsContentLoading />);

		expect(
			screen
				.getByRole("status", { name: "Einstellungen werden geladen" })
				.getAttribute("aria-busy"),
		).toBe("true");
		expect(
			screen.queryByRole("status", { name: "Loading settings" }),
		).toBeNull();
		expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(
			5,
		);
		expect(container.textContent).toBe("");
	});

	it("defines localized loading labels in every common catalog", () => {
		const expected = {
			de: {
				application: "Anwendung wird geladen",
				authentication: "Authentifizierung wird geladen",
				calendar: "Kalender wird geladen",
				chart: "Diagramm wird geladen",
				licenses: "Lizenzen werden geladen",
				platformAnalytics: "Plattformanalyse wird geladen",
				settings: "Einstellungen werden geladen",
				setup: "Einrichtung wird geladen",
				teamAbsences: "Team-Abwesenheiten werden geladen",
				workerQueue: "Auftragswarteschlange wird geladen",
			},
			el: {
				application: "Φόρτωση εφαρμογής",
				authentication: "Φόρτωση ελέγχου ταυτότητας",
				calendar: "Φόρτωση ημερολογίου",
				chart: "Φόρτωση γραφήματος",
				licenses: "Φόρτωση αδειών χρήσης",
				platformAnalytics: "Φόρτωση αναλυτικών στοιχείων πλατφόρμας",
				settings: "Φόρτωση ρυθμίσεων",
				setup: "Φόρτωση διαμόρφωσης",
				teamAbsences: "Φόρτωση απουσιών ομάδας",
				workerQueue: "Φόρτωση ουράς εργασιών",
			},
			en: {
				application: "Loading application",
				authentication: "Loading authentication",
				calendar: "Loading calendar",
				chart: "Loading chart",
				licenses: "Loading licenses",
				platformAnalytics: "Loading platform analytics",
				settings: "Loading settings",
				setup: "Loading setup",
				teamAbsences: "Loading team absences table",
				workerQueue: "Loading worker queue",
			},
			es: {
				application: "Cargando aplicación",
				authentication: "Cargando autenticación",
				calendar: "Cargando calendario",
				chart: "Cargando gráfico",
				licenses: "Cargando licencias",
				platformAnalytics: "Cargando analíticas de la plataforma",
				settings: "Cargando ajustes",
				setup: "Cargando configuración",
				teamAbsences: "Cargando ausencias del equipo",
				workerQueue: "Cargando cola de trabajos",
			},
			fr: {
				application: "Chargement de l’application",
				authentication: "Chargement de l’authentification",
				calendar: "Chargement du calendrier",
				chart: "Chargement du graphique",
				licenses: "Chargement des licences",
				platformAnalytics: "Chargement des analyses de la plateforme",
				settings: "Chargement des paramètres",
				setup: "Chargement de la configuration",
				teamAbsences: "Chargement des absences de l’équipe",
				workerQueue: "Chargement de la file d’attente des tâches",
			},
			gsw: {
				application: "Awändig wird glade",
				authentication: "Amäldig wird glade",
				calendar: "Kaländer wird glade",
				chart: "Diagramm wird glade",
				licenses: "Lizänze wärde glade",
				platformAnalytics: "Plattform-Analyse wird glade",
				settings: "Istellige wärde glade",
				setup: "Iirichtig wird glade",
				teamAbsences: "Team-Abweseheite wärde glade",
				workerQueue: "Uuftragswarteschlange wird glade",
			},
			it: {
				application: "Caricamento dell’applicazione",
				authentication: "Caricamento dell’autenticazione",
				calendar: "Caricamento del calendario",
				chart: "Caricamento del grafico",
				licenses: "Caricamento delle licenze",
				platformAnalytics: "Caricamento delle analisi della piattaforma",
				settings: "Caricamento delle impostazioni",
				setup: "Caricamento della configurazione",
				teamAbsences: "Caricamento delle assenze del team",
				workerQueue: "Caricamento della coda di lavoro",
			},
			pl: {
				application: "Ładowanie aplikacji",
				authentication: "Ładowanie uwierzytelniania",
				calendar: "Ładowanie kalendarza",
				chart: "Ładowanie wykresu",
				licenses: "Ładowanie licencji",
				platformAnalytics: "Ładowanie analityki platformy",
				settings: "Ładowanie ustawień",
				setup: "Ładowanie konfiguracji",
				teamAbsences: "Ładowanie nieobecności zespołu",
				workerQueue: "Ładowanie kolejki zadań",
			},
			pt: {
				application: "A carregar aplicação",
				authentication: "A carregar autenticação",
				calendar: "A carregar calendário",
				chart: "A carregar gráfico",
				licenses: "A carregar licenças",
				platformAnalytics: "A carregar análises da plataforma",
				settings: "A carregar definições",
				setup: "A carregar configuração",
				teamAbsences: "A carregar ausências da equipa",
				workerQueue: "A carregar fila de trabalhos",
			},
			tr: {
				application: "Uygulama yükleniyor",
				authentication: "Kimlik doğrulama yükleniyor",
				calendar: "Takvim yükleniyor",
				chart: "Grafik yükleniyor",
				licenses: "Lisanslar yükleniyor",
				platformAnalytics: "Platform analizleri yükleniyor",
				settings: "Ayarlar yükleniyor",
				setup: "Kurulum yükleniyor",
				teamAbsences: "Ekip devamsızlıkları yükleniyor",
				workerQueue: "İş kuyruğu yükleniyor",
			},
		};

		for (const [locale, loading] of Object.entries(expected)) {
			const catalog = JSON.parse(
				readFileSync(`messages/common/${locale}.json`, "utf8"),
			);

			expect(catalog.loading).toEqual(loading);
		}
	});
});
