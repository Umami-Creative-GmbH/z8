import type { Metadata } from "next";
import { connection } from "next/server";

import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

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

export default async function EmailTemplatesSettingsPage() {
	await connection();

	const [t] = await Promise.all([getTranslate(), requireOrgAdminSettingsAccess()]);

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="space-y-1">
				<h1 className="text-2xl font-semibold">
					{t("settings.emailTemplates.title", "Email Templates")}
				</h1>
				<p className="text-muted-foreground">
					{t(
						"settings.emailTemplates.description",
						"Customize the emails your organization sends",
					)}
				</p>
			</div>
		</div>
	);
}
