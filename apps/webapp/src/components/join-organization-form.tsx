"use client";

import { useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";
import {
	redeemInviteCode,
	validateInviteCode,
} from "@/app/[locale]/(auth)/invite-code-actions";
import { useSession } from "@/lib/auth-client";
import { useRouter } from "@/navigation";
import {
	JoinOrganizationFormBody,
	type JoinState,
} from "./join-organization-form-body";

interface JoinOrganizationFormProps {
	code?: string;
}

export function JoinOrganizationForm({
	code: initialCode,
}: JoinOrganizationFormProps) {
	return (
		<JoinOrganizationFormContent
			key={initialCode ?? ""}
			initialCode={initialCode}
		/>
	);
}

function JoinOrganizationFormContent({
	initialCode,
}: {
	initialCode?: string;
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const { data: session, isPending: sessionLoading } = useSession();

	const [code, setCode] = useState(initialCode || "");
	const [state, setState] = useState<JoinState>(
		initialCode ? "loading" : "valid",
	);
	const [error, setError] = useState<string | null>(null);
	const [organizationName, setOrganizationName] = useState<string | null>(null);
	const [joinStatus, setJoinStatus] = useState<"pending" | "approved" | null>(
		null,
	);
	const validationOperationRef = useRef(0);

	async function validateCode(codeToValidate: string) {
		const operation = ++validationOperationRef.current;
		if (!codeToValidate.trim()) {
			setState("valid");
			setError(null);
			setOrganizationName(null);
			return;
		}

		setState("loading");
		setError(null);

		let result: Awaited<ReturnType<typeof validateInviteCode>>;
		try {
			result = await validateInviteCode(codeToValidate.toUpperCase());
		} catch {
			if (validationOperationRef.current !== operation) return;
			setState("invalid");
			setError(t("settings.inviteCodes.invalidCode", "Invalid invite code"));
			return;
		}
		if (validationOperationRef.current !== operation) return;

		if (!result.success) {
			setState("invalid");
			setError(
				result.error ||
					t("settings.inviteCodes.invalidCode", "Invalid invite code"),
			);
			return;
		}

		if (!result.data.valid) {
			setState("invalid");
			setError(
				result.data.error ||
					t("settings.inviteCodes.invalidCode", "Invalid invite code"),
			);
			return;
		}

		setState("valid");
		setOrganizationName(result.data.inviteCode?.organization?.name || null);
	}

	useEffect(() => {
		let cancelled = false;

		if (!initialCode) return;
		const codeToValidate = initialCode;

		async function validateInitialCode() {
			let result: Awaited<ReturnType<typeof validateInviteCode>>;
			try {
				result = await validateInviteCode(codeToValidate.toUpperCase());
			} catch {
				if (cancelled) return;
				setState("invalid");
				setError(t("settings.inviteCodes.invalidCode", "Invalid invite code"));
				return;
			}
			if (cancelled) return;

			if (!result.success) {
				setState("invalid");
				setError(
					result.error ||
						t("settings.inviteCodes.invalidCode", "Invalid invite code"),
				);
				return;
			}

			if (!result.data.valid) {
				setState("invalid");
				setError(
					result.data.error ||
						t("settings.inviteCodes.invalidCode", "Invalid invite code"),
				);
				return;
			}

			setState("valid");
			setOrganizationName(result.data.inviteCode?.organization?.name || null);
		}

		void validateInitialCode();
		return () => {
			cancelled = true;
		};
	}, [initialCode, t]);

	const handleCodeChange = (newCode: string) => {
		validationOperationRef.current += 1;
		setCode(newCode.toUpperCase());
		// Reset state when code changes
		if (newCode !== code) {
			setState("valid");
			setError(null);
			setOrganizationName(null);
		}
	};

	const handleValidateClick = () => {
		void validateCode(code);
	};

	const handleJoin = async () => {
		if (!session) {
			// Redirect to sign-in with return URL
			router.push(`/sign-in?callbackUrl=/join/${code}`);
			return;
		}

		setState("joining");
		setError(null);

		const result = await redeemInviteCode(code);

		if (!result.success) {
			if (result.error?.includes("already a member")) {
				setState("already-member");
				setError(result.error);
			} else {
				setState("error");
				setError(result.error || t("common.error", "An error occurred"));
			}
			return;
		}

		setState("success");
		setOrganizationName(result.data.organizationName);
		setJoinStatus(result.data.status);
	};

	return (
		<JoinOrganizationFormBody
			code={code}
			error={error}
			initialCode={initialCode}
			joinStatus={joinStatus}
			onCodeChange={handleCodeChange}
			onJoin={handleJoin}
			onValidate={handleValidateClick}
			organizationName={organizationName}
			session={Boolean(session)}
			sessionLoading={sessionLoading}
			state={state}
		/>
	);
}
