"use client";

import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { redeemInviteCode, validateInviteCode } from "@/app/[locale]/(auth)/invite-code-actions";
import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { withCallbackUrl } from "@/lib/auth/callback-url";
import { useAuthPageSession } from "@/lib/auth/use-auth-page-session";
import { runWithCleanup } from "@/lib/run-with-cleanup";
import { useRouter } from "@/navigation";
import { JoinOrganizationFormBody, type JoinState } from "./join-organization-form-body";

async function readInviteCode(code: string) {
	try {
		return await validateInviteCode(code.toUpperCase());
	} catch {
		return null;
	}
}

function getJoinAuthHrefs(code: string) {
	const trimmedCode = code.trim();
	const callbackUrl = trimmedCode ? `/join/${encodeURIComponent(trimmedCode)}` : "/join";
	const signUpBase = trimmedCode
		? `/sign-up?inviteCode=${encodeURIComponent(trimmedCode)}`
		: "/sign-up";
	return {
		signInHref: withCallbackUrl("/sign-in", callbackUrl),
		signUpHref: withCallbackUrl(signUpBase, callbackUrl),
	};
}

export function JoinOrganizationForm({ code }: { code?: string }) {
	const { data: session, isPending } = useAuthPageSession({
		refetchOnWindowFocus: true,
	});
	const activeOrganizationId =
		session &&
		"activeOrganizationId" in session.session &&
		typeof session.session.activeOrganizationId === "string"
			? session.session.activeOrganizationId
			: "";
	// A new account/scope must review its own outcome, never inherit an in-flight result.
	return (
		<JoinOrganizationFormContent
			key={`${code ?? ""}:${session?.user.id ?? ""}:${activeOrganizationId}`}
			initialCode={code}
			accountEmail={session?.user.email ?? null}
			sessionLoading={isPending}
		/>
	);
}

function JoinOrganizationFormContent({
	initialCode,
	accountEmail,
	sessionLoading,
}: {
	initialCode?: string;
	accountEmail: string | null;
	sessionLoading: boolean;
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const [state, setState] = useState<JoinState>(initialCode ? "loading" : "valid");
	const [error, setError] = useState<string | null>(null);
	const [organizationId, setOrganizationId] = useState<string | null>(null);
	const [organizationName, setOrganizationName] = useState<string | null>(null);
	const [joinStatus, setJoinStatus] = useState<"pending" | "approved" | null>(null);
	const validationOperationRef = useRef(0);
	const joiningRef = useRef(false);
	const mountedRef = useRef(true);
	const inputRef = useRef<HTMLInputElement>(null);
	const form = useForm({
		defaultValues: { code: initialCode?.toUpperCase() ?? "" },
		onSubmit: async ({ value }) => {
			if (
				sessionLoading ||
				joiningRef.current ||
				state === "loading" ||
				state === "invalid" ||
				!organizationName
			)
				return;
			if (!accountEmail) {
				router.push(signInHref);
				return;
			}
			joiningRef.current = true;
			setState("joining");
			setError(null);
			await runWithCleanup(
				async () => {
					try {
						const result = await redeemInviteCode(value.code);
						if (!mountedRef.current) return;
						if (!result.success) {
							setState(result.error?.includes("already a member") ? "already-member" : "error");
							setError(result.error || t("common.error", "An error occurred"));
							return;
						}
						setState("success");
						setOrganizationId(result.data.organizationId);
						setOrganizationName(result.data.organizationName);
						setJoinStatus(result.data.status);
					} catch {
						if (!mountedRef.current) return;
						setState("error");
						setError(
							t(
								"auth.join.retryJoin",
								"Could not confirm your membership. Try again with the same code.",
							),
						);
					}
				},
				() => {
					joiningRef.current = false;
				},
			);
		},
	});
	const code = useStore(form.store, (value) => value.values.code);
	const { signInHref, signUpHref } = getJoinAuthHrefs(code);

	function applyValidation(operation: number, result: Awaited<ReturnType<typeof readInviteCode>>) {
		if (!mountedRef.current || validationOperationRef.current !== operation) return;
		if (!result?.success || !result.data.valid) {
			setState("invalid");
			setOrganizationId(null);
			setError(
				(result?.success ? result.data.error : result?.error) ||
					t("settings.inviteCodes.invalidCode", "Invalid invite code"),
			);
			inputRef.current?.focus();
			return;
		}
		setState("valid");
		setOrganizationId(
			result.data.inviteCode?.organization?.id ?? result.data.inviteCode?.organizationId ?? null,
		);
		setOrganizationName(result.data.inviteCode?.organization?.name || null);
	}
	const completeInitialValidation = useEffectEvent(applyValidation);
	function validateCode(codeToValidate: string) {
		const operation = ++validationOperationRef.current;
		if (codeToValidate.trim()) {
			void readInviteCode(codeToValidate).then((result) => applyValidation(operation, result));
		}
	}
	useEffect(() => {
		mountedRef.current = true;
		if (initialCode?.trim()) {
			const operation = ++validationOperationRef.current;
			void readInviteCode(initialCode).then((result) =>
				completeInitialValidation(operation, result),
			);
		}
		return () => {
			mountedRef.current = false;
			validationOperationRef.current += 1;
		};
	}, [initialCode]);

	return (
		<JoinOrganizationFormBody
			code={code}
			codeField={
				<form.Field name="code">
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={state === "invalid"}>
								{t("settings.inviteCodes.inviteCode", "Invite Code")}
							</TFormLabel>
							<TFormControl hasError={state === "invalid"}>
								<Input
									ref={inputRef}
									name={field.name}
									type="text"
									autoComplete="off"
									spellCheck={false}
									autoCapitalize="characters"
									translate="no"
									placeholder={t("settings.inviteCodes.codePlaceholder", "TEAM-ABC123")}
									value={field.state.value}
									onBlur={field.handleBlur}
									disabled={state === "joining"}
									onChange={(event) => {
										validationOperationRef.current += 1;
										field.handleChange(event.target.value.toUpperCase());
										setState("valid");
										setError(null);
										setOrganizationId(null);
										setOrganizationName(null);
									}}
									className="font-mono uppercase tracking-wider"
								/>
							</TFormControl>
							<TFormDescription>
								{t("auth.join.codeHint", "Check the organization below before joining.")}
							</TFormDescription>
							<TFormMessage>{state === "invalid" ? error : null}</TFormMessage>
						</TFormItem>
					)}
				</form.Field>
			}
			error={error}
			joinStatus={joinStatus}
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
			onValidate={() => {
				setOrganizationId(null);
				setOrganizationName(null);
				setError(null);
				setState("loading");
				void validateCode(code);
			}}
			organizationId={organizationId}
			organizationName={organizationName}
			accountEmail={accountEmail}
			sessionLoading={sessionLoading}
			signInHref={signInHref}
			signUpHref={signUpHref}
			state={state}
		/>
	);
}
