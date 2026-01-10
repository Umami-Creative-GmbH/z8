import { redirect } from "next/navigation";

// Branding settings have been moved to the domains page
export default function BrandingPage() {
	redirect("/settings/enterprise/domains");
}
