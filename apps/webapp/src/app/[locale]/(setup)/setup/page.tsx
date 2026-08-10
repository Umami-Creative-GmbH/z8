import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SetupWizardForm } from "@/components/setup/setup-wizard-form";
import { Skeleton } from "@/components/ui/skeleton";
import { isPlatformConfigured } from "@/lib/setup/config-cache";

export const metadata: Metadata = {
	title: "Setup | Z8",
	description: "Configure your Z8 instance.",
};

interface SetupPageProps {
	params: Promise<{ locale: string }>;
}

async function SetupPageContent({ params }: SetupPageProps) {
	const { locale } = await params;
	// OpenTelemetry database instrumentation creates synchronous random trace IDs per request.
	await connection();
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

function SetupPageLoading() {
	return (
		<div
			className="w-full max-w-md"
			role="status"
			aria-label="Loading platform setup"
		>
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

export default function SetupPage(props: SetupPageProps) {
	return (
		<Suspense fallback={<SetupPageLoading />}>
			<SetupPageContent {...props} />
		</Suspense>
	);
}
