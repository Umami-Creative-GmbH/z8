import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { withCallbackUrl } from "@/lib/auth/callback-url";
import { useBranding } from "@/lib/auth/domain-auth-context";
import { Link } from "@/navigation";
import { AuthFormWrapper } from "./auth-form-wrapper";

export interface InvitationDetails {
	email: string;
	inviterName: string | null;
	isExpired: boolean;
	organizationId: string;
	organizationName: string | null;
	role: string | null;
	status: string;
}

interface AcceptInvitationFormBodyProps {
	accepting: boolean;
	callbackUrl: string;
	actionError: string | null;
	fatalError: string | null;
	invitation: InvitationDetails | null;
	isEmailMismatch: boolean;
	onAccept: () => void;
	onSignOut: () => void;
	session: boolean;
	signingOut: boolean;
	signUpUrl: string;
}

export function AcceptInvitationFormBody({
	accepting,
	callbackUrl,
	actionError,
	fatalError,
	invitation,
	isEmailMismatch,
	onAccept,
	onSignOut,
	session,
	signingOut,
	signUpUrl,
}: AcceptInvitationFormBodyProps) {
	const { t } = useTranslate();
	const branding = useBranding();
	return (
		<AuthFormWrapper branding={branding} title={t("auth.accept-invitation", "Accept invitation")}>
			{fatalError ? (
				<Alert variant="destructive">
					<AlertTitle>{t("auth.invitation-unavailable", "Invitation unavailable")}</AlertTitle>
					<AlertDescription>
						<p>{fatalError}</p>
						<p>
							{t(
								"auth.invitation-unavailable-description",
								"This invitation can no longer be used. Ask your workspace admin to send a new one.",
							)}
						</p>
					</AlertDescription>
				</Alert>
			) : (
				<p className="text-pretty text-sm text-muted-foreground">
					{invitation?.organizationName
						? t(
								"auth.invitation-description-with-org",
								"Accept this invitation to join {organization}.",
								{ organization: invitation.organizationName },
							)
						: t(
								"auth.invitation-description-generic",
								"Accept this invitation to join the workspace.",
							)}
				</p>
			)}
			{invitation ? (
				<section aria-labelledby="invitation-details-heading" className="min-w-0">
					<h2 id="invitation-details-heading" className="font-medium text-sm">
						{t("auth.invitation-details", "Invitation details")}
					</h2>
					<dl className="mt-3 divide-y border-y text-sm [&>div]:grid [&>div]:gap-1 [&>div]:py-3 [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:font-medium [&_dd]:[overflow-wrap:anywhere]">
						<div>
							<dt>{t("auth.workspace", "Workspace")}</dt>
							<dd>{invitation.organizationName ?? t("common.not-available", "Not available")}</dd>
						</div>
						<div>
							<dt>{t("auth.invited-email", "Invited email")}</dt>
							<dd>{invitation.email}</dd>
						</div>
						{invitation.role ? (
							<div>
								<dt>{t("auth.role", "Role")}</dt>
								<dd>{invitation.role}</dd>
							</div>
						) : null}
						{invitation.inviterName ? (
							<div>
								<dt>{t("auth.invited-by-label", "Invited by")}</dt>
								<dd>{invitation.inviterName}</dd>
							</div>
						) : null}
					</dl>
				</section>
			) : null}
			<div className="space-y-3">
				{session && isEmailMismatch ? (
					<Alert>
						<AlertTitle>{t("auth.wrong-account", "Wrong account")}</AlertTitle>
						<AlertDescription>
							{t(
								"auth.wrong-account-description",
								"You're signed in as a different email. Sign out and use the invited email address to accept this invitation.",
							)}
						</AlertDescription>
					</Alert>
				) : null}
				{actionError ? (
					<Alert variant="destructive">
						<AlertTitle>{t("common.error", "Error")}</AlertTitle>
						<AlertDescription>{actionError}</AlertDescription>
					</Alert>
				) : null}
				{!fatalError && !isEmailMismatch && session ? (
					<Button
						type="button"
						className="h-auto min-h-11 w-full whitespace-normal py-2"
						onClick={onAccept}
						disabled={accepting}
						aria-busy={accepting}
					>
						{accepting ? (
							<IconLoader2
								className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
								aria-hidden="true"
							/>
						) : null}
						{accepting
							? t("auth.accepting-invitation", "Accepting invitation…")
							: t("auth.accept-invitation", "Accept invitation")}
					</Button>
				) : null}
				{!fatalError && !session ? (
					<>
						<section aria-labelledby="invitation-next-heading" className="space-y-2 text-sm">
							<h2 id="invitation-next-heading" className="font-medium">
								{t("auth.what-happens-next", "What happens next")}
							</h2>
							<p className="text-muted-foreground">
								{t(
									"auth.invitation-step-one-description",
									"Use the invited email address so the workspace can match this invitation automatically.",
								)}
							</p>
							<p className="text-muted-foreground">
								{t(
									"auth.invitation-return-to-review",
									"After signing in or creating an account, return here to review and accept the invitation.",
								)}
							</p>
						</section>
						<Button asChild className="h-auto min-h-11 w-full whitespace-normal py-2">
							<Link href={signUpUrl}>
								{t("auth.create-account-invited-email", "Create account with invited email")}
							</Link>
						</Button>
						<Button
							asChild
							className="h-auto min-h-11 w-full whitespace-normal py-2"
							variant="outline"
						>
							<Link href={withCallbackUrl("/sign-in", callbackUrl)}>
								{t("auth.sign-in-invited-email", "Sign in with invited email")}
							</Link>
						</Button>
					</>
				) : null}
				{session && isEmailMismatch ? (
					<Button
						type="button"
						className="h-auto min-h-11 w-full whitespace-normal py-2"
						onClick={onSignOut}
						disabled={signingOut}
						aria-busy={signingOut}
						variant="outline"
					>
						{signingOut ? (
							<IconLoader2
								className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
								aria-hidden="true"
							/>
						) : null}
						{t("auth.sign-out-and-switch", "Sign out and switch account")}
					</Button>
				) : null}
				<p role="status" className="text-sm text-muted-foreground">
					{accepting
						? t("auth.accepting-invitation", "Accepting invitation…")
						: signingOut
							? t("auth.invitation-signing-out", "Signing out…")
							: null}
				</p>
			</div>
		</AuthFormWrapper>
	);
}
