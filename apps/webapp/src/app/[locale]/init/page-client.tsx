"use client";

import { IconArrowRight, IconBuilding, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useSearchParams } from "next/navigation";
import {
	type ReactNode,
	Suspense,
	useEffect,
	useEffectEvent,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import { sanitizeCallbackUrl } from "@/lib/auth/callback-url";
import { activateOrganization as activateWorkspace } from "@/lib/enterprise-identity/organization-activation";
import {
	getLastOrganization,
	saveLastOrganization,
} from "@/lib/org-persistence";

type Organization = { id: string; name: string };
type Status = "checking" | "selecting" | "activating" | "redirecting" | "error";

function InitFrame({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<main className="flex min-h-svh items-center justify-center bg-background py-8 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
			<section className="w-full min-w-0 max-w-lg" aria-labelledby="init-title">
				<header className="mb-6 space-y-3">
					<p className="text-sm font-semibold text-primary" translate="no">
						Z8
					</p>
					<h1
						id="init-title"
						className="text-balance text-2xl font-semibold tracking-tight"
					>
						{title}
					</h1>
				</header>
				{children}
			</section>
		</main>
	);
}

function InitProgress({
	status,
	organizationName,
}: {
	status: Status;
	organizationName?: string;
}) {
	const { t } = useTranslate();
	const label =
		status === "checking"
			? t("setup:init.checking", "Checking session...")
			: status === "activating"
				? t("setup:init.activating", "Setting up your workspace...")
				: t("setup:init.redirecting", "Redirecting...");

	return (
		<output
			aria-label={organizationName ? `${label} ${organizationName}` : label}
			aria-live="polite"
			aria-atomic="true"
			className="flex items-center gap-3 text-sm text-muted-foreground"
		>
			<IconLoader2
				className="size-5 shrink-0 animate-spin text-primary motion-reduce:animate-none"
				aria-hidden="true"
			/>
			<span className="min-w-0 [overflow-wrap:anywhere]">
				{organizationName ? (
					<span className="block font-medium text-foreground">
						{organizationName}
					</span>
				) : null}
				<span>{label}</span>
			</span>
		</output>
	);
}

function InitPageLoading() {
	const { t } = useTranslate();
	return (
		<InitFrame title={t("setup:init.title", "Open your workspace")}>
			<InitProgress status="checking" />
		</InitFrame>
	);
}

/** Establish organization context before entering the authenticated workspace shell. */
function InitPageContent() {
	const { t } = useTranslate();
	const searchParams = useSearchParams();
	const redirectUrl = sanitizeCallbackUrl(
		searchParams.get("callbackUrl"),
		"/",
		typeof window === "undefined" ? undefined : location.href,
	);
	const [status, setStatus] = useState<Status>("checking");
	const [organizations, setOrganizations] = useState<Organization[]>([]);
	const [selectedOrg, setSelectedOrg] = useState<string | null>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const activationPending = useRef(false);
	const mounted = useRef(false);
	const selectedButton = useRef<HTMLButtonElement>(null);

	const activateOrganization = async (orgId: string, allowSso = true) => {
		// State updates alone cannot prevent two events in the same render from submitting.
		if (activationPending.current) return;
		activationPending.current = true;
		setSelectedOrg(orgId);
		setStatus("activating");
		setErrorMessage(null);
		try {
			const result = await activateWorkspace(
				orgId,
				redirectUrl,
				fetch,
				allowSso,
			);
			if (!mounted.current) return;
			if (result.kind === "sso" || result.kind === "mfa") {
				setStatus("redirecting");
				location.assign(result.url);
				return;
			}
			saveLastOrganization(orgId);
			setStatus("redirecting");
			location.assign(redirectUrl);
		} catch (error) {
			if (!mounted.current) return;
			setErrorMessage(
				error instanceof Error
					? error.message
					: t("organization.switchFailed", "Failed to switch organization"),
			);
			activationPending.current = false;
			setStatus("selecting");
		}
	};

	const initializeSession = async () => {
		const failSessionCheck = () => {
			if (!mounted.current) return;
			setErrorMessage(
				t(
					"setup:init.checkFailed",
					"We couldn't check your organizations. Try again.",
				),
			);
			setStatus("error");
		};
		const response = await fetch("/api/session/organization-status").catch(
			() => {
				failSessionCheck();
				return null;
			},
		);
		if (!response || !mounted.current) return;
		if (!response.ok) {
			if (response.status === 401 || response.status === 403)
				location.assign("/sign-in");
			else failSessionCheck();
			return;
		}
		const data = await response.json().catch(() => {
			failSessionCheck();
			return null;
		});
		if (!mounted.current) return;
		if (
			!data ||
			!Array.isArray(data.organizations) ||
			data.organizations.some(
				(org: Organization | null) =>
					!org || typeof org.id !== "string" || typeof org.name !== "string",
			)
		) {
			failSessionCheck();
			return;
		}

		const { hasActiveOrganization, organizations: orgs } = data;
		setOrganizations(orgs ?? []);
		if (searchParams.get("ssoError")) {
			setErrorMessage(
				t(
					"organization.ssoFailed",
					"SSO sign-in did not complete. Select an organization to try again, or choose another workspace.",
				),
			);
			setStatus("selecting");
			return;
		}
		const requestedOrg = searchParams.get("organizationId");
		if (
			requestedOrg &&
			orgs?.some((org: Organization) => org.id === requestedOrg)
		) {
			await activateOrganization(requestedOrg, !searchParams.get("ssoAttempt"));
			return;
		}
		if (hasActiveOrganization || !orgs || orgs.length === 0) {
			setStatus("redirecting");
			location.assign(redirectUrl);
			return;
		}
		const lastOrgId = getLastOrganization();
		if (lastOrgId && orgs.some((org: Organization) => org.id === lastOrgId)) {
			await activateOrganization(lastOrgId);
			return;
		}
		if (orgs.length === 1) {
			await activateOrganization(orgs[0].id);
			return;
		}
		setStatus("selecting");
	};
	const initializeOnMount = useEffectEvent(initializeSession);

	useEffect(() => {
		mounted.current = true;
		// React Strict Mode replays mount effects. Only the live effect starts initialization.
		let cancelled = false;
		void Promise.resolve().then(() => {
			if (!cancelled) void initializeOnMount();
		});
		return () => {
			cancelled = true;
			mounted.current = false;
		};
	}, []);

	useEffect(() => {
		if (errorMessage) selectedButton.current?.focus();
	}, [errorMessage]);

	const showPicker = status === "selecting" || selectedOrg !== null;
	const pending = status !== "selecting";

	return (
		<InitFrame
			title={
				showPicker
					? t("setup:init.selectOrganization", "Select Organization")
					: t("setup:init.title", "Open your workspace")
			}
		>
			{showPicker ? (
				<div className="space-y-4" data-testid="init-organization-picker">
					<p className="text-pretty text-muted-foreground">
						{t(
							"setup:init.selectOrganizationDescription",
							"Choose which organization you want to work with",
						)}
					</p>
					{errorMessage ? (
						<p
							role="alert"
							className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
						>
							{errorMessage}
						</p>
					) : null}
					<ul
						aria-labelledby="init-title"
						aria-busy={pending}
						className="max-h-[min(28rem,50svh)] scroll-py-1 divide-y overflow-y-auto overscroll-contain rounded-xl border bg-card text-card-foreground"
					>
						{organizations.map((org) => (
							<li key={org.id}>
								<button
									type="button"
									ref={selectedOrg === org.id ? selectedButton : undefined}
									disabled={pending}
									aria-describedby={
										pending && selectedOrg === org.id
											? "init-progress"
											: undefined
									}
									onClick={() => void activateOrganization(org.id)}
									className={`flex min-h-20 w-full touch-manipulation items-center gap-3 px-4 py-4 text-start transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-wait ${selectedOrg === org.id ? "bg-primary/5" : ""}`}
								>
									<span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
										<IconBuilding className="size-5" aria-hidden="true" />
									</span>
									<span className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">
										{org.name}
									</span>
									<IconArrowRight
										className="size-4 shrink-0 text-muted-foreground"
										aria-hidden="true"
									/>
								</button>
							</li>
						))}
					</ul>
					<div id="init-progress" className="min-h-6">
						{pending ? (
							<InitProgress
								status={status}
								organizationName={
									organizations.find((org) => org.id === selectedOrg)?.name
								}
							/>
						) : (
							<p className="text-sm text-muted-foreground">
								{t(
									"setup:init.selectionHint",
									"Your workspace opens after selection.",
								)}
							</p>
						)}
					</div>
				</div>
			) : status === "error" ? (
				<div className="space-y-4">
					<p role="alert" className="text-sm text-destructive">
						{errorMessage}
					</p>
					<Button
						type="button"
						onClick={() => {
							setErrorMessage(null);
							setStatus("checking");
							void initializeSession();
						}}
					>
						{t("setup:init.retry", "Try again")}
					</Button>
				</div>
			) : (
				<InitProgress status={status} />
			)}
		</InitFrame>
	);
}

export default function InitPage() {
	return (
		<Suspense fallback={<InitPageLoading />}>
			<InitPageContent />
		</Suspense>
	);
}
