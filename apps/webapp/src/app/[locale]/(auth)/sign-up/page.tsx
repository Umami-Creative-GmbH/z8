import { SignupForm } from "@/components/signup-form";
import { ALL_LANGUAGES } from "@/tolgee/shared";

export async function generateStaticParams() {
	return ALL_LANGUAGES.map((locale) => ({ locale }));
}

export default function Page() {
	return <SignupForm />;
}
