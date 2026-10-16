import { eq } from "drizzle-orm";
import { Suspense } from "react";
import { DomainsAndBrandingTabs } from "@/components/settings/enterprise/domains-branding-tabs";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { getOrganizationPlatformOrigins } from "@/lib/auth-domain-config";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { getBrandingAction, listDomainsAction } from "../actions";

async function DomainSettingsContent({
	searchParams,
}: {
	searchParams: Promise<{ tab?: string }>;
}) {
	const { organizationId } = await requireOrgAdminSettingsAccess();

	const { tab } = await searchParams;
	if (tab === "sso" || tab === "social-oauth")
		return redirectWithLocale(`/settings/enterprise/identity-setup?tab=${tab}`);
	const [domains, branding, organizationRecord] = await Promise.all([
		listDomainsAction(),
		getBrandingAction(),

		db.query.organization.findFirst({
			where: eq(organization.id, organizationId),
			columns: { id: true, slug: true },
		}),
	]);
	const [canonicalDefaultUrl] = getOrganizationPlatformOrigins({
		id: organizationId,
		slug: organizationRecord?.slug ?? organizationId,
	});

	return (
		<DomainsAndBrandingTabs
			initialDomains={domains}
			initialBranding={branding}
			organizationId={organizationId}
			defaultUrls={{ canonical: canonicalDefaultUrl }}
		/>
	);
}

export default function CustomDomainsPage(props: {
	searchParams: Promise<{ tab?: string }>;
}) {
	return (
		<Suspense
			fallback={
				<SettingsPageSkeleton
					label={{
						labelKey: "settings.loading",
						labelDefault: "Loading settings",
					}}
				/>
			}
		>
			<DomainSettingsContent {...props} />
		</Suspense>
	);
}
