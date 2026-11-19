import { Suspense } from "react";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function RedirectContent({ searchParams }: { searchParams: SearchParams }) {
	await requireOrgAdminSettingsAccess();
	const query = new URLSearchParams();
	for (const [name, value] of Object.entries(await searchParams)) {
		if (Array.isArray(value)) {
			for (const entry of value) query.append(name, entry);
		} else if (value !== undefined) query.append(name, value);
	}
	query.set("tab", "webhooks");
	return redirectWithLocale(`/settings/enterprise/api-keys?${query}`);
}

/** This route redirects to Developer Access; load in the settings page frame. */
function WebhooksSettingsLoading() {
	return (
		<SettingsPageSkeleton
			label={{
				labelKey: "settings.loading",
				labelDefault: "Loading settings",
			}}
		/>
	);
}

export default function WebhooksSettingsPage({ searchParams }: { searchParams: SearchParams }) {
	return (
		<Suspense fallback={<WebhooksSettingsLoading />}>
			<RedirectContent searchParams={searchParams} />
		</Suspense>
	);
}
