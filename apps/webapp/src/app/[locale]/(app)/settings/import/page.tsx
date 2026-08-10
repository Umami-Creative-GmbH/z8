import { and, eq } from "drizzle-orm";
import { Suspense } from "react";
import { ImportHub } from "@/components/settings/import/import-hub";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

async function ImportPageContent() {
	const [{ authContext, organizationId }, t] = await Promise.all([
		requireOrgAdminSettingsAccess(),
		getTranslate(),
	]);

	const _memberRecord = await db.query.member.findFirst({
		where: and(
			eq(authSchema.member.userId, authContext.user.id),
			eq(authSchema.member.organizationId, organizationId),
		),
	});

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

function ImportPageLoading() {
	return (
		<div className="p-6" role="status" aria-label="Loading import settings">
			<div className="mx-auto max-w-5xl space-y-6">
				<div className="space-y-2">
					<Skeleton aria-hidden="true" className="h-8 w-48" />
					<Skeleton aria-hidden="true" className="h-4 w-96 max-w-full" />
				</div>
				<Skeleton aria-hidden="true" className="h-10 w-64" />
				<Skeleton aria-hidden="true" className="h-64 w-full" />
			</div>
		</div>
	);
}

export default function ImportPage() {
	return (
		<Suspense fallback={<ImportPageLoading />}>
			<ImportPageContent />
		</Suspense>
	);
}
