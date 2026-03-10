"use client";

import { IconCheck, IconLoader2, IconMail, IconUserPlus, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { authClient, useSession } from "@/lib/auth-client";
import { Link, useRouter } from "@/navigation";
import { AuthFormWrapper } from "./auth-form-wrapper";

type InvitationState = "loading" | "ready" | "accepting" | "success" | "error";

interface AcceptInvitationFormProps {
	invitationId: string;
}

function getInvitationCallbackUrl(invitationId: string) {
	return `/accept-invitation/${invitationId}`;
}

export function AcceptInvitationForm({ invitationId }: AcceptInvitationFormProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const { data: session, isPending: sessionLoading } = useSession();
	const [state, setState] = useState<InvitationState>("loading");
	const [error, setError] = useState<string | null>(null);
	const [email, setEmail] = useState<string | null>(null);

	const callbackUrl = useMemo(() => getInvitationCallbackUrl(invitationId), [invitationId]);

	useEffect(() => {
		let isMounted = true;

		async function loadInvitation() {
			const result = await authClient.organization.getInvitation({
				query: { id: invitationId },
			});

			if (!isMounted) {
				return;
			}

			if (result.error || !result.data) {
				setState("error");
				setError(
					result.error?.message ||
						t(
							"auth.invitation-invalid",
							"This invitation is invalid, expired, or no longer available.",
						),
				);
				return;
			}

			setEmail(result.data.email ?? null);
			setState("ready");
		}

		void loadInvitation();

		return () => {
			isMounted = false;
		};
	}, [invitationId, t]);

	const handleAcceptInvitation = async () => {
		if (!session) {
			router.push(`/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`);
			return;
		}

		setState("accepting");
		setError(null);

		const result = await authClient.organization.acceptInvitation({
			invitationId,
		});

		if (result.error) {
			setState("error");
			setError(
				result.error.message || t("auth.invitation-accept-failed", "Failed to accept invitation."),
			);
			return;
		}

		setState("success");
		window.setTimeout(() => {
			window.location.assign("/init");
		}, 800);
	};

	if (sessionLoading || state === "loading") {
		return (
			<AuthFormWrapper title={t("auth.accept-invitation", "Accept invitation")}>
				<div className="flex items-center justify-center py-8">
					<IconLoader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
				</div>
			</AuthFormWrapper>
		);
	}

	if (state === "success") {
		return (
			<Card className="mx-auto max-w-md">
				<CardHeader className="text-center">
					<div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
						<IconCheck className="h-8 w-8 text-green-600 dark:text-green-400" aria-hidden="true" />
					</div>
					<CardTitle>{t("auth.invitation-accepted", "Invitation accepted")}</CardTitle>
					<CardDescription>
						{t("auth.invitation-accepted-generic", "Your workspace is being prepared.")}
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	return (
		<AuthFormWrapper title={t("auth.accept-invitation", "Accept invitation")}>
			<Card className="border-none shadow-none">
				<CardHeader className="px-0 text-center">
					<div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
						{state === "error" ? (
							<IconX className="h-8 w-8" aria-hidden="true" />
						) : (
							<IconUserPlus className="h-8 w-8" aria-hidden="true" />
						)}
					</div>
					<CardTitle>
						{state === "error"
							? t("auth.invitation-unavailable", "Invitation unavailable")
							: t("auth.you-are-invited", "You're invited")}
					</CardTitle>
					<CardDescription>
						{t(
							"auth.invitation-description-generic",
							"Accept this invitation to join the workspace.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4 px-0">
					{email ? (
						<Alert>
							<IconMail className="h-4 w-4" aria-hidden="true" />
							<AlertTitle>{t("auth.invited-email", "Invited email")}</AlertTitle>
							<AlertDescription>{email}</AlertDescription>
						</Alert>
					) : null}

					{error ? (
						<Alert variant="destructive">
							<AlertTitle>{t("common.error", "Error")}</AlertTitle>
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					) : null}

					{!session && state !== "error" ? (
						<Alert>
							<AlertTitle>{t("auth.sign-in-required", "Sign in required")}</AlertTitle>
							<AlertDescription>
								{t(
									"auth.sign-in-required-description",
									"Sign in with the invited email address before accepting this invitation.",
								)}
							</AlertDescription>
						</Alert>
					) : null}
				</CardContent>
				<CardFooter className="flex flex-col gap-3 px-0">
					{state !== "error" ? (
						<Button
							className="w-full"
							onClick={handleAcceptInvitation}
							disabled={state === "accepting"}
						>
							{state === "accepting" ? (
								<>
									<IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
									{t("auth.accepting-invitation", "Accepting invitation…")}
								</>
							) : session ? (
								t("auth.accept-invitation", "Accept invitation")
							) : (
								t("auth.sign-in-to-continue", "Sign in to continue")
							)}
						</Button>
					) : null}

					<div className="text-center text-sm text-muted-foreground">
						<Link href="/sign-up">{t("auth.need-account", "Need an account? Sign up")}</Link>
					</div>
				</CardFooter>
			</Card>
		</AuthFormWrapper>
	);
}
