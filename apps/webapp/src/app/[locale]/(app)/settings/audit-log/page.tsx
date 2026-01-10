import { redirect } from "next/navigation";
import { AuditLogViewer } from "@/components/settings/audit-log-viewer";
import { requireUser } from "@/lib/auth-helpers";

export default async function AuditLogPage() {
	const authContext = await requireUser();

	// Only admins can access audit logs
	if (authContext.employee?.role !== "admin") {
		redirect("/settings");
	}

	return (
		<div className="p-6">
			<div className="mx-auto max-w-6xl">
				<div className="mb-6">
					<h1 className="text-2xl font-semibold">Audit Log</h1>
					<p className="text-muted-foreground">
						View and search all actions performed in your organization
					</p>
				</div>
				<AuditLogViewer />
			</div>
		</div>
	);
}
