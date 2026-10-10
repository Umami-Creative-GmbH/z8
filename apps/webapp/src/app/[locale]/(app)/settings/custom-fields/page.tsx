import { Suspense } from "react";
import { CustomFieldsSettings } from "@/components/settings/custom-fields/custom-fields-settings";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { listCustomFieldDefinitions } from "@/lib/organization/custom-fields/definitions";
import { getTranslate } from "@/tolgee/server";

async function CustomFieldsSettingsPageContent() {
	const { organizationId } = await requireOrgAdminSettingsAccess();
	const [t, fields] = await Promise.all([
		getTranslate(),
		listCustomFieldDefinitions(db, organizationId),
	]);

	return (
		<div className="p-4 sm:p-6">
			<div className="mx-auto min-w-0 max-w-3xl space-y-6">
				<div>
					<h1 className="text-2xl font-semibold">
						{t("settings.customFields.title", "Custom fields")}
					</h1>
					<p className="text-muted-foreground">
						{t(
							"settings.customFields.description",
							"Your own fields on employees, projects and customers",
						)}
					</p>
				</div>
				<CustomFieldsSettings initialFields={fields} />
			</div>
		</div>
	);
}

function CustomFieldsSettingsPageLoading() {
	return (
		<div className="p-4 sm:p-6">
			<div className="mx-auto min-w-0 max-w-3xl space-y-6">
				<div className="space-y-2">
					<Skeleton className="h-8 w-56" />
					<Skeleton className="h-5 w-full max-w-xl" />
				</div>
				<Skeleton className="h-9 w-72" />
				<Skeleton className="h-64 w-full" />
			</div>
		</div>
	);
}

export default function CustomFieldsSettingsPage() {
	return (
		<Suspense fallback={<CustomFieldsSettingsPageLoading />}>
			<CustomFieldsSettingsPageContent />
		</Suspense>
	);
}
