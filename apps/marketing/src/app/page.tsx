import { permanentRedirect } from "next/navigation";
import { defaultLocale } from "@/i18n/locales";

export default function RootPage() {
	permanentRedirect(`/${defaultLocale}`);
}
