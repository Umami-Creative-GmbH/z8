import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";
import { AuthContentLoading } from "@/components/shells/auth-content-loading";
import { ALL_LANGUAGES } from "@/tolgee/shared";

export async function generateStaticParams() {
	return ALL_LANGUAGES.map((locale) => ({ locale }));
}

export default function Page() {
	return (
		<Suspense fallback={<AuthContentLoading />}>
			<LoginForm />
		</Suspense>
	);
}
