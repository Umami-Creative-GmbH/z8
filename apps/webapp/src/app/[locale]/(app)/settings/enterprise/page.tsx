import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

// Redirect to the first enterprise page (Custom Domains)
export default async function EnterprisePage() {
	return redirectWithLocale("/settings/enterprise/domains");
}
