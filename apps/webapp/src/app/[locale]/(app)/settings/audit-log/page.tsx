import { redirect } from "next/navigation";
import { AuditLogViewer } from "@/components/settings/audit-log-viewer";
import { requireUser } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

export default async function AuditLogPage() {
	const [authContext, t] = await Promise.all([requireUser(), getTranslate()]);

	// Only admins can access audit logs
	if (authContext.employee?.role !== "admin") {
		redirect("/settings");
	}

	return (
		<div className="p-6">
			<div className="mx-auto max-w-6xl">
				<div className="mb-6">
					<h1 className="text-2xl font-semibold">{t("settings.auditLog.title", "Audit Log")}</h1>
					<p className="text-muted-foreground">
						{t("settings.auditLog.description", "View and search all actions performed in your organization")}
					</p>
				</div>
				<AuditLogViewer />
			</div>
		</div>
	);
}
