import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

export default async function DeprecatedNewEmployeePage() {
	return redirectWithLocale("/settings/organizations");
}
