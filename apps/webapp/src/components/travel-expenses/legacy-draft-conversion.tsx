"use client";

import { IconAlertTriangle, IconArrowRight, IconLoader2, IconTransform } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import {
	type ConvertLegacyDraftOutcome,
	convertLegacyTravelExpenseDraftAction,
	getLegacyTravelExpenseConversion,
} from "@/app/[locale]/(app)/travel-expenses/legacy-draft-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useOrganization } from "@/hooks/use-organization";
import { authClient, useSession } from "@/lib/auth-client";
import { queryKeys } from "@/lib/query/keys";
import type { LegacyConversionView } from "@/lib/travel-expenses/legacy-draft-conversion-read";
import type { LegacyReceiptRefusal } from "@/lib/travel-expenses/legacy-draft-conversion-store";
import { Link, useRouter } from "@/navigation";

type Translate = ReturnType<typeof useTranslate>["t"];
type Refusal = Exclude<ConvertLegacyDraftOutcome, { kind: "converted" }>;

function claimScopeMatches(
	scope: ReturnType<typeof useOrganization>,
	session: ReturnType<typeof useSession>,
	expected?: { organizationId: string; employeeId: string; userId?: string },
) {
	return (
		!scope.isLoading &&
		!scope.error &&
		!session.isPending &&
		Boolean(scope.userId && scope.activeOrganizationId && scope.employeeId) &&
		session.data?.user.id === scope.userId &&
		session.data?.session.activeOrganizationId === scope.activeOrganizationId &&
		(!expected ||
			(expected.organizationId === scope.activeOrganizationId &&
				expected.employeeId === scope.employeeId &&
				(!expected.userId || expected.userId === scope.userId)))
	);
}

/** Presentation lifetime only. Server reads/actions still decide access. */
export function LegacyClaimArrival({
	children,
	expected,
}: {
	children: ReactNode;
	expected?: { organizationId: string; employeeId: string; userId?: string };
}) {
	const scope = useOrganization();
	const session = useSession();
	const { t } = useTranslate();
	const router = useRouter();
	const ready = claimScopeMatches(scope, session, expected);
	if (scope.error || (!ready && !scope.isLoading && !session.isPending))
		return (
			<Alert role="alert">
				<AlertDescription className="space-y-3">
					<p>
						{t(
							"travelExpenses.detail.scopeUnavailable",
							"Refresh this claim to confirm your current access.",
						)}
					</p>
					<Button
						type="button"
						variant="outline"
						onClick={() => {
							void scope.refetch();
							router.refresh();
						}}
					>
						{t("common.retry", "Retry")}
					</Button>
				</AlertDescription>
			</Alert>
		);
	if (!ready)
		return (
			<p role="status" className="text-sm text-muted-foreground">
				{t(
					"travelExpenses.detail.confirmingScope",
					"Confirming the current organization and employee…",
				)}
			</p>
		);
	return (
		<div key={JSON.stringify([scope.userId, scope.activeOrganizationId, scope.employeeId])}>
			{children}
		</div>
	);
}

/** Every effect setup is a new read lifetime, including an Activity restore. */
export function useLegacyClaimLifetime() {
	const id = useId();
	const session = useSession();
	const sessionScope =
		!session.isPending && session.data?.user.id && session.data.session.activeOrganizationId
			? JSON.stringify([session.data.user.id, session.data.session.activeOrganizationId])
			: null;
	const sequence = useRef(0);
	const [lifetime, setLifetime] = useState({ id: `${id}:0`, active: false });
	useEffect(() => {
		const arrival = { id: `${id}:${++sequence.current}`, active: sessionScope !== null };
		setLifetime(arrival);
		if (!arrival.active) return;
		let original = authClient.$store.atoms.session.get().data;
		const unsubscribe = authClient.$store.atoms.session.subscribe((value) => {
			// A pending proof retires callbacks even when retained session data is present.
			if (value.isPending || !value.data) arrival.active = false;
			if (
				original &&
				value.data &&
				(original.user.id !== value.data.user.id ||
					original.session.activeOrganizationId !== value.data.session.activeOrganizationId)
			)
				arrival.active = false;
			if (!original) original = value.data;
		});
		return () => {
			arrival.active = false;
			unsubscribe();
		};
	}, [id, sessionScope]);
	return lifetime;
}

function receiptReason(t: Translate, reason: LegacyReceiptRefusal): string {
	switch (reason) {
		case "unreadable":
			return t(
				"travelExpenses.legacyDraft.receipt.unreadable",
				"the stored file cannot be read right now",
			);
		case "identity_mismatch":
			return t(
				"travelExpenses.legacyDraft.receipt.mismatch",
				"the stored file no longer matches what was uploaded",
			);
		case "unsupported_type":
			return t(
				"travelExpenses.legacyDraft.receipt.unsupportedType",
				"the stored file is not a supported receipt type",
			);
		case "unsupported_storage":
			return t(
				"travelExpenses.legacyDraft.receipt.unsupportedStorage",
				"the file is kept in an unsupported storage",
			);
	}
}

function refusalText(t: Translate, refusal: Refusal): string {
	switch (refusal.kind) {
		case "not_draft":
		case "has_approval_history":
			return t(
				"travelExpenses.legacyDraft.notDraft",
				"This claim was already submitted. It keeps its original approval and cannot be continued as a report.",
			);
		case "receipt_unavailable":
			return t(
				"travelExpenses.legacyDraft.receiptUnavailable",
				"Nothing was changed because a receipt could not be carried over safely: {receipts}. Please retry later or ask your administrator to restore the file.",
				{
					receipts: refusal.attachments
						.map((attachment) => `${attachment.fileName} (${receiptReason(t, attachment.reason)})`)
						.join(", "),
				},
			);
	}
}

/**
 * Continues one of the employee's legacy drafts as a single-item report and
 * opens it (#616). Repeating the action opens the same report.
 */
export function ContinueLegacyDraftButton({
	claimId,
	size = "sm",
}: {
	claimId: string;
	size?: "sm" | "default";
}) {
	return <ContinueLegacyDraft key={claimId} claimId={claimId} size={size} />;
}

function ContinueLegacyDraft({ claimId, size }: { claimId: string; size: "sm" | "default" }) {
	const { t } = useTranslate();
	const router = useRouter();
	const queryClient = useQueryClient();
	const lifetime = useLegacyClaimLifetime();
	const reserved = useRef(false);
	const mutation = useMutation({
		mutationFn: async (activation: typeof lifetime) => {
			if (!activation.active) throw new Error("Conversion arrival retired");
			const result = await convertLegacyTravelExpenseDraftAction(claimId);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: async (outcome, activation) => {
			if (outcome.kind !== "converted") return;
			const invalidation = queryClient.invalidateQueries({
				queryKey: queryKeys.travelExpenses.all,
			});
			// The conversion read can replace this button with its new report link.
			// Navigate while this successful activation still owns the current view.
			if (activation.active) router.push(`/travel-expenses/reports/${outcome.reportId}`);
			await invalidation;
		},
		onSettled: () => {
			reserved.current = false;
		},
	});
	const currentAttempt = mutation.variables === lifetime && lifetime.active;
	const outcome = currentAttempt ? mutation.data : undefined;
	return (
		<div className="space-y-2">
			<Button
				type="button"
				size={size}
				variant="outline"
				disabled={mutation.isPending || !lifetime.active}
				aria-busy={mutation.isPending}
				className="h-auto min-h-9 whitespace-normal text-start"
				onClick={() => {
					if (reserved.current || !lifetime.active) return;
					reserved.current = true;
					mutation.mutate(lifetime);
				}}
			>
				{mutation.isPending ? (
					<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
				) : (
					<IconTransform aria-hidden="true" className="mr-2 size-4" />
				)}
				{t("travelExpenses.legacyDraft.continue", "Continue as report")}
			</Button>
			<div aria-live="polite">
				{((currentAttempt && mutation.isError) || (outcome && outcome.kind !== "converted")) && (
					<Alert variant="destructive">
						<IconAlertTriangle aria-hidden="true" className="size-4" />
						<AlertDescription>
							{outcome && outcome.kind !== "converted"
								? refusalText(t, outcome)
								: t(
										"travelExpenses.legacyDraft.failed",
										"The draft could not be continued. Please retry.",
									)}
						</AlertDescription>
					</Alert>
				)}
			</div>
		</div>
	);
}

const linkClass =
	"rounded-sm text-primary underline underline-offset-4 hover:text-primary/80 focus-visible:outline-2";

/**
 * Actions of a row in the employee's legacy claim list: every claim can be
 * viewed; a draft is continued as a report (#616), or opens the report it was
 * continued as.
 */
export function LegacyClaimActions({
	claim,
}: {
	claim: { id: string; status: string; convertedReportId?: string | null };
}) {
	const { t } = useTranslate();
	if (claim.convertedReportId) {
		return (
			<Link className={linkClass} href={`/travel-expenses/reports/${claim.convertedReportId}`}>
				{t("travelExpenses.legacyDraft.openReport", "Open the report")}
			</Link>
		);
	}
	return (
		<div className="flex flex-wrap items-start gap-3">
			<Link className={linkClass} href={`/travel-expenses/${claim.id}`}>
				{t("travelExpenses.actions.viewClaim", "View claim")}
			</Link>
			{claim.status === "draft" && <ContinueLegacyDraftButton claimId={claim.id} />}
		</div>
	);
}

/**
 * On a legacy draft's detail page (#616): legacy drafts are no longer
 * submitted; the owner continues them as a report, or opens the report they
 * already continued it as.
 */
export function LegacyDraftConversionPanel({ claimId }: { claimId: string }) {
	return (
		<LegacyClaimArrival>
			<LegacyConversionRead key={claimId} claimId={claimId} />
		</LegacyClaimArrival>
	);
}

type LegacyConversionReadResult =
	| { kind: "available"; conversion: LegacyConversionView | null }
	| { kind: "withdrawn" };

function LegacyConversionRead({ claimId }: { claimId: string }) {
	const { t } = useTranslate();
	const lifetime = useLegacyClaimLifetime();
	const {
		data: result,
		isError,
		isLoading,
		refetch,
		isFetching,
	} = useQuery({
		queryKey: [...queryKeys.travelExpenses.detail(claimId), "legacy-conversion", lifetime.id],
		enabled: lifetime.active,
		retry: false,
		queryFn: async (): Promise<LegacyConversionReadResult> => {
			const result = await getLegacyTravelExpenseConversion({ claimId });
			if (!lifetime.active) throw new Error("Conversion read retired");
			if (!result.success) {
				if (["Unauthorized", "Travel expense claim not found"].includes(result.error))
					return { kind: "withdrawn" };
				throw new Error(result.error);
			}
			return { kind: "available", conversion: result.data };
		},
	});
	const data = result?.kind === "available" ? result.conversion : undefined;
	const loadError = isError && (
		<Alert variant="destructive">
			<IconAlertTriangle aria-hidden="true" className="size-4" />
			<AlertDescription className="flex flex-wrap items-center gap-2">
				{t("travelExpenses.legacyDraft.loadFailed", "Unable to check this draft. Please retry.")}
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={isFetching}
					onClick={() => void refetch()}
				>
					{t("common.retry", "Retry")}
				</Button>
			</AlertDescription>
		</Alert>
	);
	if (result?.kind === "withdrawn")
		return (
			<div className="space-y-3">
				<Alert role="alert">
					<AlertDescription>
						{t(
							"travelExpenses.legacyDraft.readRefused",
							"Draft continuation is not available for the current reader.",
						)}
					</AlertDescription>
				</Alert>
				{loadError}
			</div>
		);
	if (isLoading || !lifetime.active)
		return (
			<p role="status" className="text-sm text-muted-foreground">
				{t("travelExpenses.legacyDraft.checking", "Checking draft continuation…")}
			</p>
		);
	return (
		<Card>
			<CardHeader>
				<h2 className="font-semibold leading-none">
					{t("travelExpenses.legacyDraft.title", "Continue this draft")}
				</h2>
			</CardHeader>
			<CardContent className="space-y-3">
				{loadError}
				{data ? (
					<>
						<p className="text-sm text-muted-foreground">
							{t(
								"travelExpenses.legacyDraft.converted",
								"You continued this draft as an expense report. This claim stays here unchanged for reference.",
							)}
						</p>
						<Link
							href={`/travel-expenses/reports/${data.reportId}`}
							className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4"
						>
							{t("travelExpenses.legacyDraft.openReport", "Open the report")}
							<IconArrowRight aria-hidden="true" className="size-4" />
						</Link>
					</>
				) : !isError ? (
					<>
						<p className="text-sm text-muted-foreground">
							{t(
								"travelExpenses.legacyDraft.description",
								"Drafts from the earlier claim form are now finished as expense reports. Your amount, dates, notes and receipts are carried over; anything the new form needs that this draft never recorded is left for you to complete. This claim itself stays unchanged.",
							)}
						</p>
						<ContinueLegacyDraftButton claimId={claimId} size="default" />
					</>
				) : null}
			</CardContent>
		</Card>
	);
}
