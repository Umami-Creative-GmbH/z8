import type { Metadata } from "next";
import { Suspense } from "react";

import { EmailTemplateSettingsClient } from "@/components/settings/email-templates/email-template-settings-client";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { listEmailTemplates } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslate();

	return {
		title: t("settings.emailTemplates.title", "Email Templates"),
		description: t(
			"settings.emailTemplates.description",
			"Customize the emails your organization sends",
		),
	};
}

async function EmailTemplatesSettingsPageContent() {
	const [templates] = await Promise.all([
		listEmailTemplates(),
		getTranslate(),
		requireOrgAdminSettingsAccess(),
	]);

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<EmailTemplateSettingsClient
				templates={templates.map(({ override, ...definition }) => ({
					definition,
					override,
				}))}
			/>
		</div>
	);
}

function EmailTemplatesSettingsPageLoading() {
	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<Skeleton className="h-8 w-56" />
			<Skeleton className="h-64 w-full" />
		</div>
	);
}

export default function EmailTemplatesSettingsPage() {
	return (
		<Suspense fallback={<EmailTemplatesSettingsPageLoading />}>
			<EmailTemplatesSettingsPageContent />
		</Suspense>
	);
}
