import { redirect } from "next/navigation";

// Redirect to the first enterprise page (Custom Domains)
export default function EnterprisePage() {
	redirect("/settings/enterprise/domains");
}
