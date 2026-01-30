"use client";

import {
	IconBuilding,
	IconCheck,
	IconClock,
	IconLoader2,
	IconUserPlus,
	IconX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
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
import { useSession } from "@/lib/auth-client";
import { Link, useRouter } from "@/navigation";
import {
	validateInviteCode,
	useInviteCode,
} from "@/app/[locale]/(app)/settings/organizations/invite-code-actions";
import { AuthFormWrapper } from "./auth-form-wrapper";

interface JoinOrganizationFormProps {
	code?: string;
}

type JoinState =
	| "loading"
	| "invalid"
	| "valid"
	| "joining"
	| "success"
	| "error"
	| "already-member";

export function JoinOrganizationForm({ code: initialCode }: JoinOrganizationFormProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const { data: session, isPending: sessionLoading } = useSession();

	const [code, setCode] = useState(initialCode || "");
	const [state, setState] = useState<JoinState>(initialCode ? "loading" : "valid");
	const [error, setError] = useState<string | null>(null);
	const [organizationName, setOrganizationName] = useState<string | null>(null);
	const [joinStatus, setJoinStatus] = useState<"pending" | "approved" | null>(null);

	// Validate code on mount or when code changes
	useEffect(() => {
		if (initialCode && state === "loading") {
			validateCode(initialCode);
		}
	}, [initialCode]);

	const validateCode = async (codeToValidate: string) => {
		if (!codeToValidate.trim()) {
			setState("valid");
			setError(null);
			setOrganizationName(null);
			return;
		}

		setState("loading");
		setError(null);

		const result = await validateInviteCode(codeToValidate.toUpperCase());

		if (!result.success) {
			setState("invalid");
			setError(result.error || t("settings.inviteCodes.invalidCode", "Invalid invite code"));
			return;
		}

		if (!result.data.valid) {
			setState("invalid");
			setError(result.data.error || t("settings.inviteCodes.invalidCode", "Invalid invite code"));
			return;
		}

		setState("valid");
		setOrganizationName(result.data.inviteCode?.organization?.name || null);
	};

	const handleCodeChange = (newCode: string) => {
		setCode(newCode.toUpperCase());
		// Reset state when code changes
		if (newCode !== code) {
			setState("valid");
			setError(null);
			setOrganizationName(null);
		}
	};

	const handleValidateClick = () => {
		validateCode(code);
	};

	const handleJoin = async () => {
		if (!session) {
			// Redirect to sign-in with return URL
			router.push(`/sign-in?callbackUrl=/join/${code}`);
			return;
		}

		setState("joining");
		setError(null);

		const result = await useInviteCode(code);

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

	// Show loading while checking session
	if (sessionLoading) {
		return (
			<AuthFormWrapper title={t("settings.inviteCodes.joinOrganization", "Join Organization")}>
				<div className="flex items-center justify-center py-8">
					<IconLoader2 className="h-8 w-8 animate-spin text-muted-foreground" />
				</div>
			</AuthFormWrapper>
		);
	}

	// Success state
	if (state === "success") {
		return (
			<Card className="max-w-md mx-auto">
				<CardHeader className="text-center">
					<div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
						<IconCheck className="h-8 w-8 text-green-600 dark:text-green-400" />
					</div>
					<CardTitle>
						{joinStatus === "pending"
							? t("settings.inviteCodes.joinRequestSent", "Join Request Sent")
							: t("settings.inviteCodes.joinedSuccessfully", "Joined Successfully")}
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
							<IconClock className="h-4 w-4" />
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
				<CardFooter className="flex justify-center">
					<Button asChild>
						<Link href="/">{t("common.goToDashboard", "Go to Dashboard")}</Link>
					</Button>
				</CardFooter>
			</Card>
		);
	}

	// Already a member state
	if (state === "already-member") {
		return (
			<Card className="max-w-md mx-auto">
				<CardHeader className="text-center">
					<div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900">
						<IconBuilding className="h-8 w-8 text-yellow-600 dark:text-yellow-400" />
					</div>
					<CardTitle>{t("settings.inviteCodes.alreadyMember", "Already a Member")}</CardTitle>
					<CardDescription>
						{t(
							"settings.inviteCodes.alreadyMemberMessage",
							"You are already a member of this organization.",
						)}
					</CardDescription>
				</CardHeader>
				<CardFooter className="flex justify-center">
					<Button asChild>
						<Link href="/">{t("common.goToDashboard", "Go to Dashboard")}</Link>
					</Button>
				</CardFooter>
			</Card>
		);
	}

	return (
		<AuthFormWrapper title={t("settings.inviteCodes.joinOrganization", "Join Organization")}>
			<div className="space-y-6">
				{/* Description */}
				<p className="text-center text-sm text-muted-foreground">
					{organizationName
						? t("settings.inviteCodes.joiningOrganization", "You're about to join {organization}", {
								organization: organizationName,
							})
						: t(
								"settings.inviteCodes.enterCodeDescription",
								"Enter an invite code to join an organization",
							)}
				</p>
				{/* Code input */}
				<div className="space-y-2">
					<Label htmlFor="code">{t("settings.inviteCodes.inviteCode", "Invite Code")}</Label>
					<div className="flex gap-2">
						<Input
							id="code"
							name="code"
							type="text"
							autoComplete="off"
							placeholder={t("settings.inviteCodes.codePlaceholder", "TEAM-ABC123")}
							value={code}
							onChange={(e) => handleCodeChange(e.target.value)}
							disabled={state === "loading" || state === "joining"}
							className="uppercase"
						/>
						{!initialCode && (
							<Button
								type="button"
								variant="outline"
								onClick={handleValidateClick}
								disabled={!code.trim() || state === "loading" || state === "joining"}
							>
								{state === "loading" ? (
									<IconLoader2 className="h-4 w-4 animate-spin" />
								) : (
									t("common.validate", "Validate")
								)}
							</Button>
						)}
					</div>
				</div>

				{/* Error message */}
				{(state === "invalid" || state === "error") && error && (
					<Alert variant="destructive">
						<IconX className="h-4 w-4" />
						<AlertTitle>{t("common.error", "Error")}</AlertTitle>
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}

				{/* Organization info */}
				{organizationName && state === "valid" && (
					<Alert>
						<IconBuilding className="h-4 w-4" />
						<AlertTitle>{organizationName}</AlertTitle>
						<AlertDescription>
							{t(
								"settings.inviteCodes.validCodeDescription",
								"This invite code is valid. Click the button below to join.",
							)}
						</AlertDescription>
					</Alert>
				)}

				{/* Loading state */}
				{state === "loading" && (
					<div className="flex items-center justify-center py-4">
						<IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" />
						<span className="ml-2 text-muted-foreground">
							{t("settings.inviteCodes.validatingCode", "Validating code...")}
						</span>
					</div>
				)}

				{/* Join button */}
				<Button
					type="button"
					className="w-full"
					onClick={handleJoin}
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
							<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
							{t("settings.inviteCodes.joining", "Joining...")}
						</>
					) : !session ? (
						<>
							<IconUserPlus className="mr-2 h-4 w-4" />
							{t("settings.inviteCodes.signInToJoin", "Sign in to Join")}
						</>
					) : (
						<>
							<IconUserPlus className="mr-2 h-4 w-4" />
							{t("settings.inviteCodes.joinOrganization", "Join Organization")}
						</>
					)}
				</Button>

				{/* Sign in link for unauthenticated users */}
				{!session && (
					<p className="text-center text-sm text-muted-foreground">
						{t("settings.inviteCodes.alreadyHaveAccount", "Already have an account?")}{" "}
						<Link
							href={`/sign-in?callbackUrl=/join/${code}`}
							className="text-primary hover:underline"
						>
							{t("auth.sign-in", "Sign in")}
						</Link>
					</p>
				)}

				{/* Sign up link for new users */}
				{!session && (
					<p className="text-center text-sm text-muted-foreground">
						{t("settings.inviteCodes.needAccount", "Don't have an account?")}{" "}
						<Link href={`/sign-up?inviteCode=${code}`} className="text-primary hover:underline">
							{t("auth.sign-up", "Sign up")}
						</Link>
					</p>
				)}
			</div>
		</AuthFormWrapper>
	);
}
