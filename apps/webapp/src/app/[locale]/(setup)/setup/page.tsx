import { redirect } from "next/navigation";
import { isPlatformConfigured } from "@/lib/setup/config-cache";
import { SetupWizardForm } from "@/components/setup/setup-wizard-form";

interface SetupPageProps {
	params: Promise<{ locale: string }>;
}

export default async function SetupPage({ params }: SetupPageProps) {
	const { locale } = await params;

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
