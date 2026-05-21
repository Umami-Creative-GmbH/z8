import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";
import { ALL_LANGUAGES } from "@/tolgee/shared";

export async function generateStaticParams() {
	return ALL_LANGUAGES.map((locale) => ({ locale }));
}

export default function Page() {
	return (
		<Suspense fallback={null}>
			<LoginForm />
		</Suspense>
	);
}
