/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { TrialBanner } from "./trial-banner";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, number>) =>
			fallback.replace("{days}", String(params?.days)),
	}),
}));

vi.mock("@/navigation", () => ({
	Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

describe("TrialBanner", () => {
	it("renders trial messaging and upgrade link", () => {
		render(<TrialBanner daysRemaining={9} billingHref="/en/settings/billing" />);

		expect(screen.getByText("14-day trial active")).toBeTruthy();
		expect(
			screen.getByText(
				"9 days remaining. Add payment details now; your paid subscription starts after the trial.",
			),
		).toBeTruthy();

		const link = screen.getByRole("link", { name: "Upgrade" });
		expect(link.getAttribute("href")).toBe("/en/settings/billing");
	});

	it("uses the localized app navigation link", () => {
		const bannerSource = readFileSync(join(process.cwd(), "src/components/billing/trial-banner.tsx"), "utf8");

		expect(bannerSource).toContain('import { Link } from "@/navigation"');
		expect(bannerSource).not.toContain("<a\n");
		expect(bannerSource).toContain("<Link");
	});

	it("defines trial banner messages for supported locales", () => {
		const expectedMessages = {
			en: {
				title: "14-day trial active",
				description:
					"{days} days remaining. Add payment details now; your paid subscription starts after the trial.",
				upgrade: "Upgrade",
			},
			de: {
				title: "14-tägige Testphase aktiv",
				description:
					"Noch {days} Tage. Hinterlegen Sie jetzt Zahlungsdetails; Ihr kostenpflichtiges Abonnement beginnt nach der Testphase.",
				upgrade: "Upgrade",
			},
			es: {
				title: "Prueba de 14 días activa",
				description:
					"Quedan {days} días. Añada los datos de pago ahora; su suscripción de pago comenzará después de la prueba.",
				upgrade: "Mejorar plan",
			},
			fr: {
				title: "Essai de 14 jours actif",
				description:
					"Il reste {days} jours. Ajoutez vos informations de paiement maintenant ; votre abonnement payant commencera après l’essai.",
				upgrade: "Mettre à niveau",
			},
			it: {
				title: "Prova di 14 giorni attiva",
				description:
					"Restano {days} giorni. Aggiungi ora i dati di pagamento; l’abbonamento a pagamento inizierà dopo la prova.",
				upgrade: "Esegui l’upgrade",
			},
			pt: {
				title: "Teste de 14 dias ativo",
				description:
					"Restam {days} dias. Adicione os dados de pagamento agora; sua assinatura paga começará após o teste.",
				upgrade: "Fazer upgrade",
			},
		};

		for (const [locale, expected] of Object.entries(expectedMessages)) {
			const messages = JSON.parse(readFileSync(join(process.cwd(), `messages/${locale}.json`), "utf8"));

			expect(messages.billing.trialBanner).toEqual(expected);
		}
	});

	it("is wired into the app layout billing access flow", () => {
		const layoutSource = readFileSync(
			join(process.cwd(), "src/app/[locale]/(app)/layout.tsx"),
			"utf8",
		);

		expect(layoutSource).toContain("@/components/billing/trial-banner");
		expect(layoutSource).toContain("BillingEnforcementService");
		expect(layoutSource).toContain("activeOrganizationId = session.session?.activeOrganizationId");
		expect(layoutSource).toContain("checkBillingAccess(activeOrganizationId)");
		expect(layoutSource).toContain("<TrialBanner");
		expect(layoutSource).toContain('billingAccess.state === "trialing"');
	});
});
