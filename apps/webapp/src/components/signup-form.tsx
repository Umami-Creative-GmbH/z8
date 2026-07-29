"use client";

import { SignupFormBody } from "./signup-form-body";
import type { SignupFormProps } from "./signup-form-controller";

export function SignupForm(props: SignupFormProps) {
	return <SignupFormBody {...props} />;
}
