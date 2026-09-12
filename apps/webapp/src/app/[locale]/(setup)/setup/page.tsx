import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SetupWizardForm } from "@/components/setup/setup-wizard-form";
import { LocalizedLoadingLabel } from "@/components/shells/localized-loading-label";
import { Skeleton } from "@/components/ui/skeleton";
import { setupBootstrap } from "@/lib/setup/bootstrap.server";
import { isPlatformConfigured } from "@/lib/setup/config-cache";
import { SETUP_COOKIE_NAME } from "@/lib/setup/http";
import { getTranslate } from "@/tolgee/server";

export const metadata: Metadata = {
	title: "Setup | Z8",
	description: "Configure your Z8 instance.",
	referrer: "no-referrer",
	robots: { index: false, follow: false },
};

interface SetupPageProps {
	params: Promise<{ locale: string }>;
}

export default function SetupPage(props: SetupPageProps) {
	return (
		<Suspense fallback={<SetupPageLoading />}>
			<SetupPageContent {...props} />
		</Suspense>
	);
}

function SetupPageLoading() {
	return (
		<div
			aria-busy="true"
			aria-label="Loading platform setup"
			className="w-full max-w-md"
			role="status"
		>
			<LocalizedLoadingLabel
				translationKey="common:loading.setup"
				fallback="Loading setup"
			/>
			<div className="space-y-6 rounded-xl border p-6">
				<div className="space-y-2">
					<Skeleton aria-hidden="true" className="h-8 w-48" />
					<Skeleton aria-hidden="true" className="h-4 w-full" />
				</div>
				<Skeleton aria-hidden="true" className="h-10 w-full" />
				<Skeleton aria-hidden="true" className="h-10 w-full" />
				<Skeleton aria-hidden="true" className="h-10 w-32" />
			</div>
		</div>
	);
}

async function SetupPageContent({ params }: SetupPageProps) {
	const { locale } = await params;
	// OpenTelemetry database instrumentation creates synchronous random trace IDs per request.
	await connection();
	const configured = await isPlatformConfigured();
	if (configured) {
		redirect(`/${locale}/`);
	}
	const setupToken = (await cookies()).get(SETUP_COOKIE_NAME)?.value;
	const authorized = await setupBootstrap
		.authorize(setupToken)
		.catch(() => false);
	if (!authorized) {
		const t = await getTranslate();
		return (
			<section
				className="w-full max-w-md space-y-4 rounded-xl border p-6"
				aria-labelledby="setup-authorization-title"
			>
				<h2
					id="setup-authorization-title"
					className="text-xl font-semibold text-balance"
				>
					{t("setup:setup.authorization.title", "Setup authorization required")}
				</h2>
				<p className="text-sm text-muted-foreground">
					{t(
						"setup:setup.authorization.instructions",
						"Open the temporary setup link printed in the server console when this instance starts.",
					)}
				</p>
				<p className="text-sm text-muted-foreground">
					{t(
						"setup:setup.authorization.expiry",
						"The link can be used once within one hour. Complete setup within ten minutes of opening it. If authorization expires, wait for the original hour to end and restart the server to generate a new link.",
					)}
				</p>
			</section>
		);
	}

	return (
		<div className="w-full max-w-md">
			<SetupWizardForm locale={locale} />
		</div>
	);
}
