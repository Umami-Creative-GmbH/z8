import { redirect } from "next/navigation";
import { connection } from "next/server";
import { isPlatformConfigured } from "@/lib/setup/config-cache";
import { SetupWizardForm } from "@/components/setup/setup-wizard-form";

interface SetupPageProps {
	params: Promise<{ locale: string }>;
}

export default async function SetupPage({ params }: SetupPageProps) {
	const { locale } = await params;

	// Signal dynamic rendering before any database calls (OpenTelemetry uses Math.random for trace IDs)
	await connection();

	// Double-check if already configured (middleware should catch this, but be safe)
	const configured = await isPlatformConfigured();
	if (configured) {
		redirect(`/${locale}/`);
	}

	return (
		<div className="w-full max-w-md">
			<SetupWizardForm locale={locale} />
		</div>
	);
}
