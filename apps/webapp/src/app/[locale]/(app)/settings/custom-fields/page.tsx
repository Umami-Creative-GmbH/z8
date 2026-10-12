import { eq } from "drizzle-orm";
import { Suspense } from "react";
import { CustomFieldsSettings } from "@/components/settings/custom-fields/custom-fields-settings";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { customFieldSettingsEntities } from "@/lib/organization/custom-fields/definition-rules";
import { listCustomFieldDefinitions } from "@/lib/organization/custom-fields/definitions";
import { getTranslate } from "@/tolgee/server";

/** Project and customer custom fields show only with the projects module on. */
async function getShownEntities(organizationId: string) {
	const organization = await db.query.organization.findFirst({
		columns: { projectsEnabled: true },
		where: eq(authSchema.organization.id, organizationId),
	});
	return customFieldSettingsEntities(organization?.projectsEnabled ?? false);
}

async function CustomFieldsSettingsPageContent() {
	const { organizationId } = await requireOrgAdminSettingsAccess();
	const [t, entities] = await Promise.all([getTranslate(), getShownEntities(organizationId)]);
	const fields = await listCustomFieldDefinitions(db, organizationId, entities);

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
				<CustomFieldsSettings entities={entities} initialFields={fields} />
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
