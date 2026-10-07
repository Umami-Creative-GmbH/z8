import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

// Branding settings have been moved to the domains page
export default async function BrandingPage() {
	return redirectWithLocale("/settings/enterprise/domains");
}
