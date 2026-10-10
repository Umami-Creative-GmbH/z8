import { headers } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";
import { StoreAppSignInForm } from "@/components/login/store-app-sign-in-form";
import { AuthContentLoading } from "@/components/shells/auth-content-loading";
import { getStoreAppPlatformFromUserAgent } from "@/lib/store-app/shell";
import { ALL_LANGUAGES } from "@/tolgee/shared";

export async function generateStaticParams() {
	return ALL_LANGUAGES.map((locale) => ({ locale }));
}

/** The store app shell signs in through the system browser (#842), so it gets the email screen. */
async function SignInContent() {
	await connection();
	const userAgent = (await headers()).get("user-agent");
	return getStoreAppPlatformFromUserAgent(userAgent) ? <StoreAppSignInForm /> : <LoginForm />;
}

export default function Page() {
	return (
		<Suspense fallback={<AuthContentLoading />}>
			<SignInContent />
		</Suspense>
	);
}
