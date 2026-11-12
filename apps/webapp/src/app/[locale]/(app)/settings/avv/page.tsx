import { connection } from "next/server";
import { Suspense } from "react";
import { AvvDownloadButton } from "@/components/settings/avv/avv-download-button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { env } from "@/env";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { avvHostingDetails } from "@/lib/avv/avv-details";
import {
	getAvvMissingFields,
	getRegisteredAddressLines,
} from "@/lib/avv/profile";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";
import { getOrganizationProfile } from "../organization/profile-actions";

async function AvvPageContent() {
	// Deployment flags must be evaluated per request, as on the billing page.
	await connection();
	if (env.BILLING_ENABLED !== "true") {
		return redirectWithLocale("/settings");
	}

	const [, t] = await Promise.all([
		requireOrgAdminSettingsAccess(),
		getTranslate(),
	]);

	const result = await getOrganizationProfile();
	if (!result.success) {
		return redirectWithLocale("/settings");
	}
	const profile = result.data;
	const missingFields = getAvvMissingFields(profile);

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="space-y-1">
				<h1 className="text-2xl font-semibold">
					{t("settings.avv.title", "Auftragsverarbeitungsvertrag (AVV)")}
				</h1>
				<p className="text-muted-foreground">
					{t(
						"settings.avv.description",
						"Laden Sie Ihren Auftragsverarbeitungsvertrag gemäß Art. 28 DSGVO herunter.",
					)}
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>
						{t("settings.avv.contractDetails.title", "Vertragsdetails")}
					</CardTitle>
					<CardDescription>
						{t(
							"settings.avv.contractDetails.descriptionPrefix",
							"Dieser Vertrag regelt die Auftragsverarbeitung personenbezogener Daten zwischen Ihrer Organisation und ",
						)}
						Umami Creative GmbH.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-6">
					<div className="grid gap-6 sm:grid-cols-2">
						<div className="min-w-0 space-y-1 break-words">
							<h2 className="text-sm font-medium text-muted-foreground">
								{t(
									"settings.avv.contractDetails.controller",
									"Auftraggeber (Verantwortlicher)",
								)}
							</h2>
							{profile.legalCompanyName.trim() && (
								<p className="font-medium">{profile.legalCompanyName.trim()}</p>
							)}
							<address className="text-sm not-italic">
								{getRegisteredAddressLines(profile).map(({ field, value }) => (
									<p key={field}>{value}</p>
								))}
							</address>
							{profile.vatId.trim() && (
								<dl className="text-sm">
									<dt>{t("settings.avv.profile.vatId", "VAT ID")}</dt>
									<dd>{profile.vatId.trim()}</dd>
								</dl>
							)}
							<Link
								href="/settings/organization#organization-profile"
								className="text-sm text-primary underline underline-offset-4"
							>
								{t("settings.avv.profile.edit", "Edit organization profile")}
							</Link>
						</div>

						<div className="space-y-1">
							<h2 className="text-sm font-medium text-muted-foreground">
								{t(
									"settings.avv.contractDetails.processor",
									"Auftragnehmer (Auftragsverarbeiter)",
								)}
							</h2>
							<div className="text-sm">
								<p className="font-medium">Umami Creative GmbH</p>
								<p>Bismarckstra&szlig;e 9</p>
								<p>91054 Erlangen, Bayern</p>
								<p>Deutschland</p>
							</div>
						</div>
					</div>

					<div className="space-y-2">
						<h2 className="text-sm font-medium text-muted-foreground">
							{t("settings.avv.hosting.title", "Hosting & Subprozessoren")}
						</h2>
						<p className="text-sm">
							{t(
								"settings.avv.hosting.descriptionPrefix",
								"Alle Daten werden auf Servern der ",
							)}
							{avvHostingDetails.displayText}
							{t(
								"settings.avv.hosting.descriptionSuffix",
								" gehostet. Derzeit eingesetzte Subprozessoren:",
							)}
						</p>
						<ul className="list-disc space-y-1 pl-5 text-sm">
							{avvHostingDetails.subprocessors.map((subprocessor) => (
								<li key={subprocessor.providerName}>
									{subprocessor.displayText}
								</li>
							))}
						</ul>
					</div>

					<div className="border-t pt-6">
						<AvvDownloadButton
							missingFields={missingFields}
						/>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

function AvvPageLoading() {
	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="space-y-2">
				<Skeleton className="h-8 w-72" />
				<Skeleton className="h-5 w-full max-w-xl" />
			</div>
			<Skeleton className="h-80 w-full" />
		</div>
	);
}

export default function AvvPage() {
	return (
		<Suspense fallback={<AvvPageLoading />}>
			<AvvPageContent />
		</Suspense>
	);
}
