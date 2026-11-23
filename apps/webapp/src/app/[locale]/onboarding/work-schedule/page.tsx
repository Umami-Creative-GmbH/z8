import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

export const instant = false;

export default async function WorkSchedulePage() {
	return redirectWithLocale("/onboarding");
}
