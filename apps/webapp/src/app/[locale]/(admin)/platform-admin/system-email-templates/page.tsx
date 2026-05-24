import { SystemEmailTemplateSettingsClient } from "@/components/platform-admin/system-email-templates/system-email-template-settings-client";
import { Card, CardContent } from "@/components/ui/card";
import { getTranslate } from "@/tolgee/server";
import { listPlatformSystemEmailTemplates } from "./actions";

export default async function PlatformSystemEmailTemplatesPage() {
	const t = await getTranslate();
	const templates = await listPlatformSystemEmailTemplates();

	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<p className="font-medium text-primary text-sm">
					{t("admin:admin.systemEmailTemplates.eyebrow", "System transport")}
				</p>
				<h1 className="font-semibold text-2xl tracking-tight">
					{t("admin:admin.systemEmailTemplates.title", "System Email Templates")}
				</h1>
				<p className="max-w-3xl text-muted-foreground text-sm leading-6">
					{t(
						"admin:admin.systemEmailTemplates.description",
						"Manage platform-owned billing and system emails. These templates are sent with the system email transport only and are not scoped to an organization.",
					)}
				</p>
			</div>

			<Card className="border-primary/20 bg-primary/5">
				<CardContent className="p-4 text-sm text-muted-foreground leading-6">
					{t(
						"admin:admin.systemEmailTemplates.transportNotice",
						"Use this area for global billing and system email copy. Organization email transport settings are ignored for these messages; tests and live sends use the platform system transport.",
					)}
				</CardContent>
			</Card>

			<SystemEmailTemplateSettingsClient
				templates={templates.map(({ override, ...definition }) => ({ definition, override }))}
			/>
		</div>
	);
}
