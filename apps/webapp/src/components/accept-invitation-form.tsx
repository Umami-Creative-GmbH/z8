"use client";

import { IconCheck, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useState } from "react";
import { withCallbackUrl } from "@/lib/auth/callback-url";
import { useBranding } from "@/lib/auth/domain-auth-context";
import { useAuthPageSession } from "@/lib/auth/use-auth-page-session";
import { useRouter } from "@/navigation";
import { AcceptInvitationFormBody, type InvitationDetails } from "./accept-invitation-form-body";
import { AuthFormWrapper } from "./auth-form-wrapper";
import { clearManualRecoveries } from "./time-tracking/manual-command-recovery";

type InvitationState = "ready" | "accepting" | "success";

interface AcceptInvitationFormProps {
	invitation: InvitationDetails | null;
	invitationId: string;
}

// The app client carries the organization plugin; load it only to accept.
// Loaders live outside the component because React Compiler cannot compile import().
const loadAuthClient = () => import("@/lib/auth-client");
const loadSignOut = () => import("@/lib/store-app/sign-out");

function getInvitationCallbackUrl(invitationId: string) {
	return `/accept-invitation/${invitationId}`;
}

function getLocalizedInitUrl(locale: string, organizationId: string | null | undefined) {
	const basePath = `/${encodeURIComponent(locale)}/init`;
	return organizationId
		? `${basePath}?organizationId=${encodeURIComponent(organizationId)}`
		: basePath;
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

	const basePath = searchParams.size > 0 ? `/sign-up?${searchParams.toString()}` : "/sign-up";
	return withCallbackUrl(basePath, callbackUrl);
}

export function AcceptInvitationForm({ invitation, invitationId }: AcceptInvitationFormProps) {
	const { t } = useTranslate();
	const locale = useLocale();
	const router = useRouter();
	const branding = useBranding();
	const { data: session, isPending: sessionLoading } = useAuthPageSession();
	const [state, setState] = useState<InvitationState>("ready");
	const [error, setError] = useState<string | null>(null);
	const [signingOut, setSigningOut] = useState(false);

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
	const normalizedSessionEmail = session?.user.email?.trim().toLowerCase() ?? null;
	const emailMismatchMessage = t(
		"auth.invitation-email-mismatch",
		"This invitation was sent to a different email address. Sign in with the invited email to continue.",
	);
	const isEmailMismatch =
		Boolean(normalizedInvitedEmail) &&
		Boolean(normalizedSessionEmail) &&
		normalizedInvitedEmail !== normalizedSessionEmail;
	const fatalError = invitationError;

	const handleAcceptInvitation = async () => {
		if (state !== "ready" || signingOut) return;
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
			const { authClient } = await loadAuthClient();
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
			const initUrl = getLocalizedInitUrl(locale, invitation.organizationId);
			window.setTimeout(() => {
				window.location.assign(initUrl);
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
		if (signingOut || state !== "ready") return;
		setSigningOut(true);
		setError(null);
		try {
			const { signOut } = await loadSignOut();
			const result = await signOut({
				fetchOptions: {
					onSuccess: () => {
						// Sign-out ends this tab's manual-entry recovery (#310).
						clearManualRecoveries();
						router.push(withCallbackUrl("/sign-in", callbackUrl));
					},
				},
			});
			if (result?.error) {
				setError(
					result.error.message ||
						t(
							"auth.invitation-sign-out-failed",
							"Could not sign out. Try switching accounts again.",
						),
				);
			}
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: t(
							"auth.invitation-sign-out-failed",
							"Could not sign out. Try switching accounts again.",
						),
			);
		}
		setSigningOut(false);
	};

	if (sessionLoading) {
		return (
			<AuthFormWrapper branding={branding} title={t("auth.accept-invitation", "Accept invitation")}>
				<div
					role="status"
					aria-busy="true"
					className="flex flex-col items-center justify-center gap-3 py-8 text-center"
				>
					<IconLoader2
						className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none"
						aria-hidden="true"
					/>
					<p className="text-muted-foreground text-sm">
						{t("auth.loading-invitation", "Checking your invitation details...")}
					</p>
				</div>
			</AuthFormWrapper>
		);
	}

	if (state === "success") {
		return (
			<AuthFormWrapper branding={branding} title={t("auth.accept-invitation", "Accept invitation")}>
				<div role="status" className="space-y-3 text-center">
					<IconCheck className="mx-auto size-6 text-primary" aria-hidden="true" />
					<h2 className="font-semibold">{t("auth.invitation-accepted", "Invitation accepted")}</h2>
					<p className="text-sm text-muted-foreground">
						{t("auth.invitation-accepted-generic", "Your workspace is being prepared.")}
					</p>
				</div>
			</AuthFormWrapper>
		);
	}

	return (
		<AcceptInvitationFormBody
			accepting={state === "accepting"}
			callbackUrl={callbackUrl}
			actionError={error}
			fatalError={fatalError}
			invitation={invitation}
			isEmailMismatch={isEmailMismatch}
			onAccept={handleAcceptInvitation}
			onSignOut={handleSignOut}
			session={Boolean(session)}
			signingOut={signingOut}
			signUpUrl={signUpUrl}
		/>
	);
}
