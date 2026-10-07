import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

export default async function ClockodoImportPage() {
	return redirectWithLocale("/settings/import");
}
