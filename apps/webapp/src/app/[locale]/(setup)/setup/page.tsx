import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SetupWizardForm } from "@/components/setup/setup-wizard-form";
import { LocalizedLoadingLabel } from "@/components/shells/localized-loading-label";
import { Skeleton } from "@/components/ui/skeleton";
import { isPlatformConfigured } from "@/lib/setup/config-cache";

export const metadata: Metadata = {
	title: "Setup | Z8",
	description: "Configure your Z8 instance.",
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
		<div className="w-full max-w-md space-y-4" aria-busy="true" role="status">
			<LocalizedLoadingLabel
				translationKey="common:loading.setup"
				fallback="Loading setup"
			/>
			<Skeleton className="h-8 w-48" />
			<Skeleton className="h-[420px] w-full" />
		</div>
	);
}

async function SetupPageContent({ params }: SetupPageProps) {
	// Signal dynamic rendering before any database calls (OpenTelemetry uses Math.random for trace IDs)
	const [{ locale }, , configured] = await Promise.all([
		params,
		connection(),
		isPlatformConfigured(),
	]);
	if (configured) {
		redirect(`/${locale}/`);
	}

	return (
		<div className="w-full max-w-md">
			<SetupWizardForm locale={locale} />
		</div>
	);
}
