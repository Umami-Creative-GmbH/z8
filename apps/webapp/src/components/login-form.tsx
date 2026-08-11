"use client";

import { Suspense } from "react";
import { LoginFormContent } from "./login/login-form-content";
import { AuthContentLoading } from "./shells/auth-content-loading";

export function LoginForm(props: React.ComponentProps<"div">) {
	return (
		<Suspense fallback={<AuthContentLoading />}>
			<LoginFormContent {...props} />
		</Suspense>
	);
}
