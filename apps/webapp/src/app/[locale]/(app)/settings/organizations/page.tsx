import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

// Keeps links in already-sent emails and bookmarks working after the rename.
export default async function DeprecatedOrganizationsSettingsPage() {
	return redirectWithLocale("/settings/organization");
}
