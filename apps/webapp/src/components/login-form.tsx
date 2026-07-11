"use client";

import { Suspense } from "react";
import { LoginFormContent } from "./login/login-form-content";

export function LoginForm(props: React.ComponentProps<"div">) {
	return (
		<Suspense fallback={null}>
			<LoginFormContent {...props} />
		</Suspense>
	);
}
