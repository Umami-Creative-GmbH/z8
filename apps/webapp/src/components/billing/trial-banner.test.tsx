/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
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
	it("renders trial messaging and upgrade link when billing management is allowed", () => {
		render(
			<TrialBanner
				daysRemaining={9}
				billingHref="/en/settings/billing"
				showUpgradeButton={true}
			/>,
		);

		expect(screen.getByText("14-day trial active")).toBeTruthy();
		expect(
			screen.getByText(
				"9 days remaining. Add payment details now; your paid subscription starts after the trial.",
			),
		).toBeTruthy();

		const link = screen.getByRole("link", { name: "Upgrade" });
		expect(link.getAttribute("href")).toBe("/en/settings/billing");
	});

	it("hides the upgrade link when billing management is not allowed", () => {
		render(
			<TrialBanner
				daysRemaining={9}
				billingHref="/en/settings/billing"
				showUpgradeButton={false}
			/>,
		);

		expect(screen.getByText("14-day trial active")).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Upgrade" })).toBeNull();
	});

	it("can be dismissed for the current page session", () => {
		render(
			<TrialBanner
				daysRemaining={9}
				billingHref="/en/settings/billing"
				showUpgradeButton={true}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Dismiss trial banner" }));

		expect(screen.queryByText("14-day trial active")).toBeNull();
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
				dismiss: "Dismiss trial banner",
			},
			de: {
				title: "14-tägige Testversion aktiv",
				description:
					"{days} Tage verbleibend. Fügen Sie jetzt Zahlungsdetails hinzu; Ihr kostenpflichtiges Abonnement beginnt nach der Testversion.",
				upgrade: "Upgrade",
				dismiss: "Testversionsbanner ausblenden",
			},
			es: {
				title: "Prueba de 14 días activa",
				description:
					"{days} días restantes. Agregue los detalles de pago ahora; su suscripción de pago comienza después de la prueba.",
				upgrade: "Actualizar",
				dismiss: "Descartar banner de prueba",
			},
			fr: {
				title: "Essai de 14 jours actif",
				description:
					"{days} jours restants. Ajoutez vos coordonnées de paiement maintenant ; votre abonnement payé commence après la période d'essai.",
				upgrade: "Mettre à niveau",
				dismiss: "Masquer la bannière d'essai",
			},
			it: {
				title: "Prova di 14 giorni attiva",
				description:
					"{days} giorni rimanenti. Aggiungi ora i dettagli di pagamento; l'abbonamento a pagamento inizierà dopo la prova.",
				upgrade: "Aggiorna",
				dismiss: "Nascondi banner della prova",
			},
			pt: {
				title: "Teste de 14 dias ativo",
				description:
					"{days} dias restantes. Adicione os detalhes de pagamento agora; sua assinatura paga começa após o teste.",
				upgrade: "Atualizar",
				dismiss: "Dispensar banner de teste",
			},
		};

		for (const [locale, expected] of Object.entries(expectedMessages)) {
			const commonMessages = JSON.parse(
				readFileSync(join(process.cwd(), `messages/common/${locale}.json`), "utf8"),
			);
			const rootMessages = JSON.parse(readFileSync(join(process.cwd(), `messages/${locale}.json`), "utf8"));

			expect(commonMessages.billing.trialBanner).toEqual(expected);
			expect(rootMessages.billing?.trialBanner).toBeUndefined();
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
		expect(layoutSource).toContain('import { and, eq } from "drizzle-orm"');
		expect(layoutSource).toContain('import { db } from "@/db"');
		expect(layoutSource).toContain('import { member } from "@/db/auth-schema"');
		expect(layoutSource).toContain('import { subscription } from "@/db/schema"');
		expect(layoutSource).toContain("member.userId");
		expect(layoutSource).toContain("member.organizationId");
		expect(layoutSource).toContain('membershipRole === "owner" || membershipRole === "admin"');
		expect(layoutSource).toContain('subscriptionRow?.status === "trialing"');
		expect(layoutSource).toContain("Boolean(subscriptionRow?.stripeSubscriptionId)");
		expect(layoutSource).toContain("!hasPreparedTrialSubscription");
		expect(layoutSource).toContain("showUpgradeButton={canManageBilling}");
	});
});
