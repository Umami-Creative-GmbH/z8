import {
	IconBuilding,
	IconCheck,
	IconClock,
	IconLoader2,
	IconUserPlus,
	IconX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "@/navigation";
import { AuthFormWrapper } from "./auth-form-wrapper";

export type JoinState =
	| "loading"
	| "invalid"
	| "valid"
	| "joining"
	| "success"
	| "error"
	| "already-member";

interface JoinOrganizationFormBodyProps {
	code: string;
	error: string | null;
	initialCode?: string;
	joinStatus: "pending" | "approved" | null;
	onCodeChange: (code: string) => void;
	onJoin: () => void;
	onValidate: () => void;
	organizationName: string | null;
	session: boolean;
	sessionLoading: boolean;
	state: JoinState;
}

export function JoinOrganizationFormBody({
	code,
	error,
	initialCode,
	joinStatus,
	onCodeChange,
	onJoin,
	onValidate,
	organizationName,
	session,
	sessionLoading,
	state,
}: JoinOrganizationFormBodyProps) {
	const { t } = useTranslate();

	if (sessionLoading) {
		return (
			<AuthFormWrapper
				title={t("settings.inviteCodes.joinOrganization", "Join Organization")}
			>
				<div className="flex items-center justify-center py-8">
					<IconLoader2 className="size-8 animate-spin text-muted-foreground" />
				</div>
			</AuthFormWrapper>
		);
	}

	if (state === "success") {
		return (
			<Card className="mx-auto w-full max-w-md">
				<CardHeader className="text-center">
					<div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
						<IconCheck className="size-8 text-green-600 dark:text-green-400" />
					</div>
					<CardTitle>
						{joinStatus === "pending"
							? t("settings.inviteCodes.joinRequestSent", "Join Request Sent")
							: t(
									"settings.inviteCodes.joinedSuccessfully",
									"Joined Successfully",
								)}
					</CardTitle>
					<CardDescription>
						{joinStatus === "pending"
							? t(
									"settings.inviteCodes.pendingApprovalMessage",
									"Your request to join {organization} has been submitted. An administrator will review your request.",
									{ organization: organizationName },
								)
							: t(
									"settings.inviteCodes.joinedMessage",
									"You have successfully joined {organization}.",
									{ organization: organizationName },
								)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{joinStatus === "pending" && (
						<Alert>
							<IconClock className="size-4" />
							<AlertTitle>
								{t("settings.inviteCodes.pendingApproval", "Pending Approval")}
							</AlertTitle>
							<AlertDescription>
								{t(
									"settings.inviteCodes.pendingApprovalDescription",
									"You will be notified once your membership is approved.",
								)}
							</AlertDescription>
						</Alert>
					)}
				</CardContent>
				<CardFooter className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-center">
					<Button asChild>
						<Link href="/">{t("common.goToDashboard", "Go to Dashboard")}</Link>
					</Button>
				</CardFooter>
			</Card>
		);
	}

	if (state === "already-member") {
		return (
			<Card className="mx-auto w-full max-w-md">
				<CardHeader className="text-center">
					<div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900">
						<IconBuilding className="size-8 text-yellow-600 dark:text-yellow-400" />
					</div>
					<CardTitle>
						{t("settings.inviteCodes.alreadyMember", "Already a Member")}
					</CardTitle>
					<CardDescription>
						{t(
							"settings.inviteCodes.alreadyMemberMessage",
							"You are already a member of this organization.",
						)}
					</CardDescription>
				</CardHeader>
				<CardFooter className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-center">
					<Button asChild>
						<Link href="/">{t("common.goToDashboard", "Go to Dashboard")}</Link>
					</Button>
				</CardFooter>
			</Card>
		);
	}

	return (
		<AuthFormWrapper
			title={t("settings.inviteCodes.joinOrganization", "Join Organization")}
		>
			<div className="space-y-6">
				<p className="text-center text-sm text-muted-foreground">
					{organizationName
						? t(
								"settings.inviteCodes.joiningOrganization",
								"You're about to join {organization}",
								{ organization: organizationName },
							)
						: t(
								"settings.inviteCodes.enterCodeDescription",
								"Enter an invite code to join an organization",
							)}
				</p>
				<div className="space-y-2">
					<Label htmlFor="code">
						{t("settings.inviteCodes.inviteCode", "Invite Code")}
					</Label>
					<div className="flex flex-col gap-2 sm:flex-row">
						<Input
							id="code"
							name="code"
							type="text"
							autoComplete="off"
							placeholder={t(
								"settings.inviteCodes.codePlaceholder",
								"TEAM-ABC123",
							)}
							value={code}
							onChange={(event) => onCodeChange(event.target.value)}
							disabled={state === "loading" || state === "joining"}
							className="font-mono uppercase tracking-[0.2em]"
						/>
						{!initialCode && (
							<Button
								type="button"
								variant="outline"
								className="w-full sm:w-auto"
								onClick={onValidate}
								disabled={
									!code.trim() || state === "loading" || state === "joining"
								}
							>
								{state === "loading" ? (
									<IconLoader2 className="size-4 animate-spin" />
								) : (
									t("common.validate", "Validate")
								)}
							</Button>
						)}
					</div>
				</div>
				{(state === "invalid" || state === "error") && error && (
					<Alert variant="destructive">
						<IconX className="size-4" />
						<AlertTitle>{t("common.error", "Error")}</AlertTitle>
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}
				{organizationName && state === "valid" && (
					<Alert>
						<IconBuilding className="size-4" />
						<AlertTitle>{organizationName}</AlertTitle>
						<AlertDescription>
							{t(
								"settings.inviteCodes.validCodeDescription",
								"This invite code is valid. Click the button below to join.",
							)}
						</AlertDescription>
					</Alert>
				)}
				{state === "loading" && (
					<div className="flex items-center justify-center py-4">
						<IconLoader2 className="size-6 animate-spin text-muted-foreground" />
						<span className="ml-2 text-muted-foreground">
							{t("settings.inviteCodes.validatingCode", "Validating code...")}
						</span>
					</div>
				)}
				<Button
					type="button"
					className="w-full"
					onClick={onJoin}
					disabled={
						!code.trim() ||
						state === "loading" ||
						state === "joining" ||
						state === "invalid" ||
						!organizationName
					}
				>
					{state === "joining" ? (
						<>
							<IconLoader2 className="mr-2 size-4 animate-spin" />
							{t("settings.inviteCodes.joining", "Joining...")}
						</>
					) : !session ? (
						<>
							<IconUserPlus className="mr-2 size-4" />
							{t("settings.inviteCodes.signInToJoin", "Sign in to Join")}
						</>
					) : (
						<>
							<IconUserPlus className="mr-2 size-4" />
							{t("settings.inviteCodes.joinOrganization", "Join Organization")}
						</>
					)}
				</Button>
				{!session && (
					<p className="text-center text-sm text-muted-foreground">
						{t(
							"settings.inviteCodes.alreadyHaveAccount",
							"Already have an account?",
						)}{" "}
						<Link
							href={`/sign-in?callbackUrl=/join/${code}`}
							className="text-primary hover:underline"
						>
							{t("auth.sign-in", "Sign in")}
						</Link>
					</p>
				)}
				{!session && (
					<p className="text-center text-sm text-muted-foreground">
						{t("settings.inviteCodes.needAccount", "Don't have an account?")}{" "}
						<Link
							href={`/sign-up?inviteCode=${code}`}
							className="text-primary hover:underline"
						>
							{t("auth.sign-up", "Sign up")}
						</Link>
					</p>
				)}
			</div>
		</AuthFormWrapper>
	);
}
