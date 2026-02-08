import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ClockodoImportWizard } from "@/components/settings/clockodo-import/clockodo-import-wizard";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { requireUser } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

export default async function ClockodoImportPage() {
	await connection();

	const [authContext, t] = await Promise.all([requireUser(), getTranslate()]);

	const organizationId = authContext.session.activeOrganizationId;
	if (!organizationId) {
		redirect("/");
	}

	const userId = authContext.user.id;

	// Verify admin access
	const memberRecord = await db.query.member.findFirst({
		where: and(
			eq(authSchema.member.userId, userId),
			eq(authSchema.member.organizationId, organizationId),
		),
	});

	if (!memberRecord || (memberRecord.role !== "owner" && memberRecord.role !== "admin")) {
		redirect("/settings");
	}

	return (
		<div className="p-6">
			<div className="mx-auto max-w-3xl space-y-6">
				<div>
					<h1 className="text-2xl font-semibold">
						{t("settings.clockodoImport.title", "Clockodo Import")}
					</h1>
					<p className="text-muted-foreground">
						{t(
							"settings.clockodoImport.description",
							"Import your data from Clockodo into Z8. This is a one-time migration wizard.",
						)}
					</p>
				</div>

				<ClockodoImportWizard organizationId={organizationId} />
			</div>
		</div>
	);
}
