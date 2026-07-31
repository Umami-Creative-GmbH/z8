"use client";

import { IconCheck, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { withCallbackUrl } from "@/lib/auth/callback-url";
import { authClient, useSession } from "@/lib/auth-client";
import { useRouter } from "@/navigation";
import {
	AcceptInvitationFormBody,
	type InvitationDetails,
} from "./accept-invitation-form-body";
import { AuthFormWrapper } from "./auth-form-wrapper";

type InvitationState = "ready" | "accepting" | "success";

interface AcceptInvitationFormProps {
	invitation: InvitationDetails | null;
	invitationId: string;
}

function getInvitationCallbackUrl(invitationId: string) {
	return `/accept-invitation/${invitationId}`;
}

function getInvitationSignUpUrl(
	callbackUrl: string,
	invitedEmail: string | null | undefined,
	invitationId: string,
	organizationName: string | null | undefined,
) {
	const searchParams = new URLSearchParams();

	if (invitedEmail) {
		searchParams.set("invitedEmail", invitedEmail);
	}

	searchParams.set("invitationId", invitationId);

	if (organizationName) {
		searchParams.set("organizationName", organizationName);
	}

	const basePath =
		searchParams.size > 0 ? `/sign-up?${searchParams.toString()}` : "/sign-up";
	return withCallbackUrl(basePath, callbackUrl);
}

export function AcceptInvitationForm({
	invitation,
	invitationId,
}: AcceptInvitationFormProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const { data: session, isPending: sessionLoading } = useSession();
	const [state, setState] = useState<InvitationState>("ready");
	const [error, setError] = useState<string | null>(null);

	const callbackUrl = getInvitationCallbackUrl(invitationId);
	const signUpUrl = getInvitationSignUpUrl(
		callbackUrl,
		invitation?.email,
		invitationId,
		invitation?.organizationName,
	);
	const invitationError = (() => {
		if (!invitation) {
			return t(
				"auth.invitation-invalid",
				"This invitation is invalid, expired, or no longer available.",
			);
		}

		if (invitation.isExpired || invitation.status !== "pending") {
			return t(
				"auth.invitation-invalid",
				"This invitation is invalid, expired, or no longer available.",
			);
		}

		return null;
	})();
	const normalizedInvitedEmail = invitation?.email.trim().toLowerCase() ?? null;
	const normalizedSessionEmail =
		session?.user.email?.trim().toLowerCase() ?? null;
	const emailMismatchMessage = t(
		"auth.invitation-email-mismatch",
		"This invitation was sent to a different email address. Sign in with the invited email to continue.",
	);
	const isEmailMismatch =
		Boolean(normalizedInvitedEmail) &&
		Boolean(normalizedSessionEmail) &&
		normalizedInvitedEmail !== normalizedSessionEmail;
	const fatalError = error ?? invitationError;
	const displayedError =
		fatalError ?? (isEmailMismatch ? emailMismatchMessage : null);

	const handleAcceptInvitation = async () => {
		if (!invitation || invitationError) {
			setError(
				invitationError ||
					t(
						"auth.invitation-invalid",
						"This invitation is invalid, expired, or no longer available.",
					),
			);
			return;
		}

		if (!session) {
			router.push(withCallbackUrl("/sign-in", callbackUrl));
			return;
		}

		if (isEmailMismatch) {
			setError(emailMismatchMessage);
			return;
		}

		setState("accepting");
		setError(null);

		try {
			const result = await authClient.organization.acceptInvitation({
				invitationId,
			});

			if (result.error) {
				setState("ready");
				setError(
					result.error.message ||
						t("auth.invitation-accept-failed", "Failed to accept invitation."),
				);
				return;
			}

			setState("success");
			window.setTimeout(() => {
				window.location.assign("/init");
			}, 800);
		} catch (err) {
			setState("ready");
			setError(
				err instanceof Error
					? err.message
					: t("auth.invitation-accept-failed", "Failed to accept invitation."),
			);
		}
	};

	const handleSignOut = async () => {
		await authClient.signOut({
			fetchOptions: {
				onSuccess: () => {
					router.push(withCallbackUrl("/sign-in", callbackUrl));
				},
			},
		});
	};

	if (sessionLoading) {
		return (
			<AuthFormWrapper title={t("auth.accept-invitation", "Accept invitation")}>
				<div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
					<IconLoader2
						className="size-8 animate-spin text-muted-foreground"
						aria-hidden="true"
					/>
					<p aria-live="polite" className="text-muted-foreground text-sm">
						{t(
							"auth.loading-invitation",
							"Checking your invitation details...",
						)}
					</p>
				</div>
			</AuthFormWrapper>
		);
	}

	if (state === "success") {
		return (
			<AuthFormWrapper title={t("auth.accept-invitation", "Accept invitation")}>
				<Card className="border-none shadow-none">
					<CardHeader className="px-0 text-center">
						<div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
							<IconCheck
								className="size-8 text-green-600 dark:text-green-400"
								aria-hidden="true"
							/>
						</div>
						<CardTitle>
							{t("auth.invitation-accepted", "Invitation accepted")}
						</CardTitle>
						<CardDescription>
							{t(
								"auth.invitation-accepted-generic",
								"Your workspace is being prepared.",
							)}
						</CardDescription>
					</CardHeader>
				</Card>
			</AuthFormWrapper>
		);
	}

	return (
		<AcceptInvitationFormBody
			accepting={state === "accepting"}
			callbackUrl={callbackUrl}
			displayedError={displayedError}
			fatalError={fatalError}
			invitation={invitation}
			isEmailMismatch={isEmailMismatch}
			onAccept={handleAcceptInvitation}
			onSignOut={handleSignOut}
			session={Boolean(session)}
			signUpUrl={signUpUrl}
		/>
	);
}
