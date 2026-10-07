import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

// SSO settings have been moved to the domains page
export default async function SSOProvidersPage() {
	return redirectWithLocale("/settings/enterprise/domains");
}
