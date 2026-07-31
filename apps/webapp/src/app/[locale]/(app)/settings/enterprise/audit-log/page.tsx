import { eq } from "drizzle-orm";
import { AuditLogViewer } from "@/components/settings/audit-log-viewer";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

export default async function EnterpriseAuditLogPage() {
	const [access, t] = await Promise.all([
		requireOrgAdminSettingsAccess(),
		getTranslate(),
	]);
	const ownedOrganization = await db.query.organization.findFirst({
		where: eq(organization.id, access.organizationId),
		columns: { timezone: true },
	});

	return (
		<div className="p-6">
			<div className="mx-auto max-w-6xl">
				<div className="mb-6">
					<h1 className="text-2xl font-semibold">
						{t("settings.auditLog.title", "Audit Log")}
					</h1>
					<p className="text-muted-foreground">
						{t(
							"settings.auditLog.description",
							"View and search all actions performed in your organization",
						)}
					</p>
				</div>
				<AuditLogViewer
					organizationId={access.organizationId}
					organizationTimezone={ownedOrganization?.timezone ?? "UTC"}
				/>
			</div>
		</div>
	);
}
