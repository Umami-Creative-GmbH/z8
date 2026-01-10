import { redirect } from "next/navigation";

// SSO settings have been moved to the domains page
export default function SSOProvidersPage() {
	redirect("/settings/enterprise/domains");
}
