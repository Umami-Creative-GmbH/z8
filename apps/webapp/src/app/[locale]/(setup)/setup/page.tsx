import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { SetupWizardForm } from "@/components/setup/setup-wizard-form";
import { isPlatformConfigured } from "@/lib/setup/config-cache";

export const metadata: Metadata = {
	title: "Setup | Z8",
	description: "Configure your Z8 instance.",
};

interface SetupPageProps {
	params: Promise<{ locale: string }>;
}

export default async function SetupPage({ params }: SetupPageProps) {
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
