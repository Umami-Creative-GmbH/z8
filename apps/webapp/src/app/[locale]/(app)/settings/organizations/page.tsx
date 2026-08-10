import { and, count, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { OrganizationsPageClient } from "@/components/organization/organizations-page-client";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { organizationNotificationSettings } from "@/db/schema";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { canCreateOrganizationsForDeployment } from "@/lib/organization/creation-policy.server";
import { getTranslate } from "@/tolgee/server";

async function OrganizationsPageContent() {
	const [settingsRouteContext, t] = await Promise.all([
		getCurrentSettingsRouteContext(),
		getTranslate(),
	]);

	if (!settingsRouteContext) {
		redirect("/settings");
	}

	if (settingsRouteContext.accessTier !== "orgAdmin") {
		redirect("/settings");
	}

	const { authContext } = settingsRouteContext;
	const organizationId = authContext.session.activeOrganizationId;

	if (!organizationId) {
		redirect("/settings");
	}

	const memberTable = authSchema.member;
	const [
		organization,
		currentMember,
		memberCountRows,
		organizationNotificationSettingsRecord,
	] = await Promise.all([
		db.query.organization.findFirst({
			where: eq(authSchema.organization.id, organizationId),
		}),
		db
			.select({ role: memberTable.role })
			.from(memberTable)
			.where(
				and(
					eq(memberTable.userId, authContext.user.id),
					eq(memberTable.organizationId, organizationId),
				),
			)
			.limit(1),
		db
			.select({ value: count() })
			.from(memberTable)
			.where(eq(memberTable.organizationId, organizationId)),
		db.query.organizationNotificationSettings.findFirst({
			where: eq(
				organizationNotificationSettings.organizationId,
				organizationId,
			),
			columns: { defaultLanguage: true },
		}),
	]);

	const [currentMemberRecord] = currentMember;

	if (!organization || !currentMemberRecord) {
		return (
			<div className="flex-1 p-6">
				<div className="mx-auto max-w-4xl">
					<h1 className="text-2xl font-semibold">
						{t(
							"settings.organizations.notFound.title",
							"Organization Not Found",
						)}
					</h1>
					<p className="text-muted-foreground mt-2">
						{t(
							"settings.organizations.notFound.description",
							"The organization could not be found or you don't have access to it.",
						)}
					</p>
				</div>
			</div>
		);
	}

	return (
		<OrganizationsPageClient
			organization={organization}
			memberCount={memberCountRows[0]?.value ?? 0}
			currentMemberRole={
				currentMemberRecord.role as "owner" | "admin" | "member"
			}
			defaultNotificationLanguage={
				organizationNotificationSettingsRecord?.defaultLanguage ?? "en"
			}
			canCreateOrganizations={canCreateOrganizationsForDeployment(
				authContext.user.canCreateOrganizations ||
					authContext.user.role === "admin",
			)}
		/>
	);
}

function OrganizationsPageLoading() {
	return (
		<div className="flex-1 p-6">
			<div className="mx-auto max-w-4xl space-y-4">
				<Skeleton className="h-8 w-64" />
				<Skeleton className="h-5 w-96" />
				<Skeleton className="h-[420px] w-full" />
			</div>
		</div>
	);
}

export default function OrganizationsPage() {
	return (
		<Suspense fallback={<OrganizationsPageLoading />}>
			<OrganizationsPageContent />
		</Suspense>
	);
}
