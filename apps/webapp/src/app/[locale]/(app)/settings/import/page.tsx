import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ImportHub } from "@/components/settings/import/import-hub";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { requireUser } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

export default async function ImportPage() {
	await connection();

	const [authContext, t] = await Promise.all([requireUser(), getTranslate()]);

	const organizationId = authContext.session.activeOrganizationId;
	if (!organizationId) {
		redirect("/");
	}

	const memberRecord = await db.query.member.findFirst({
		where: and(
			eq(authSchema.member.userId, authContext.user.id),
			eq(authSchema.member.organizationId, organizationId),
		),
	});

	if (!memberRecord || (memberRecord.role !== "owner" && memberRecord.role !== "admin")) {
		redirect("/settings");
	}

	return (
		<div className="p-6">
			<div className="mx-auto max-w-5xl space-y-6">
				<div>
					<h1 className="text-2xl font-semibold">
						{t("settings.import.title", "Import Data")}
					</h1>
					<p className="text-muted-foreground">
						{t(
							"settings.import.description",
							"Import data from supported providers like Clockodo and Clockin.",
						)}
					</p>
				</div>

				<ImportHub organizationId={organizationId} />
			</div>
		</div>
	);
}
