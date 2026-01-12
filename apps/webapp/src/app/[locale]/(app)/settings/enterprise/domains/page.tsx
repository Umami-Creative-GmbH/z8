import { redirect } from "next/navigation";
import { DomainsAndBrandingTabs } from "@/components/settings/enterprise/domains-branding-tabs";
import { requireUser } from "@/lib/auth-helpers";
import { getBrandingAction, listDomainsAction, listSSOProvidersAction } from "../actions";

export default async function CustomDomainsPage() {
	const authContext = await requireUser();

	if (authContext.employee?.role !== "admin") {
		redirect("/settings");
	}

	const [domains, branding, providers] = await Promise.all([
		listDomainsAction(),
		getBrandingAction(),
		listSSOProvidersAction(),
	]);

	return (
		<div className="p-6">
			<div className="mx-auto max-w-4xl">
				<div className="mb-6">
					<h1 className="text-2xl font-semibold">Custom Domain & Branding</h1>
					<p className="text-muted-foreground">
						Configure your organization&apos;s custom login domain, branding, and SSO providers.
					</p>
				</div>
				<DomainsAndBrandingTabs
					initialDomains={domains as any}
					initialBranding={branding}
					initialProviders={providers as any}
					organizationId={authContext.employee?.organizationId ?? ""}
				/>
			</div>
		</div>
	);
}
