import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

export const metadata = {
	title: "Export Operations",
	description: "Monitor payroll, audit, and scheduled export activity for your organization.",
};

export default async function ExportOperationsPage() {
	const [t] = await Promise.all([getTranslate(), requireOrgAdminSettingsAccess()]);

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="space-y-1">
				<h1 className="text-2xl font-semibold">
					{t("settings.exportOperations.title", "Export Operations")}
				</h1>
				<p className="text-muted-foreground">
					{t(
						"settings.exportOperations.description",
						"Monitor payroll, audit, and scheduled export activity for your organization.",
					)}
				</p>
			</div>
		</div>
	);
}
