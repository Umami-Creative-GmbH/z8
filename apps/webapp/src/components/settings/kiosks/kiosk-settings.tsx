"use client";

import { IconBan, IconDeviceTablet, IconPencil, IconPlus, IconQrcode } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import {
	type IssuedPairingCodeData,
	issueKioskPairingCodeAction,
	type KioskAdminData,
	type KioskData,
	revokeKioskAction,
} from "@/app/[locale]/(app)/settings/kiosks/actions";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { KioskFormDialog } from "./kiosk-form-dialog";
import { formatKioskInstant, kioskSettingsErrorMessage } from "./kiosk-format";
import { PairingCodeDialog } from "./pairing-code-dialog";

interface KioskSettingsProps {
	data: KioskAdminData;
}

type Confirmation = { kind: "pair" | "revoke"; kiosk: KioskData } | null;

/** Owner/admin kiosk management (#859): create, pair, configure, rotate and revoke kiosks. */
export function KioskSettings({ data }: KioskSettingsProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [creating, setCreating] = useState(false);
	const [editing, setEditing] = useState<KioskData | null>(null);
	const [confirmation, setConfirmation] = useState<Confirmation>(null);
	const [pairing, setPairing] = useState<{ code: IssuedPairingCodeData; kioskName: string } | null>(
		null,
	);
	const [pending, setPending] = useState(false);

	async function confirm() {
		if (!confirmation) return;
		const { kind, kiosk } = confirmation;
		setPending(true);
		try {
			if (kind === "pair") {
				const result = await issueKioskPairingCodeAction({ kioskId: kiosk.id });
				if (!result.success) {
					toast.error(
						kioskSettingsErrorMessage(t, result.code) ??
							t("settings.kiosks.pairFailed", "A new pairing code could not be issued"),
					);
					return;
				}
				setPairing({ code: result.data, kioskName: kiosk.name });
			} else {
				const result = await revokeKioskAction({ kioskId: kiosk.id });
				if (!result.success) {
					toast.error(
						kioskSettingsErrorMessage(t, result.code) ??
							t("settings.kiosks.revokeFailed", "The kiosk could not be revoked"),
					);
					return;
				}
				toast.success(t("settings.kiosks.revoked", "Kiosk revoked"));
			}
			router.refresh();
		} finally {
			setPending(false);
			setConfirmation(null);
		}
	}

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
					<div className="space-y-1.5">
						<CardTitle className="flex items-center gap-2">
							<IconDeviceTablet className="size-5" aria-hidden="true" />
							{t("settings.kiosks.listTitle", "Kiosks")}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.kiosks.listDescription",
								"Each kiosk belongs to one location. Pair a device by opening the kiosk page on it and entering the pairing code.",
							)}
						</CardDescription>
					</div>
					<Button onClick={() => setCreating(true)} disabled={data.locations.length === 0}>
						<IconPlus className="size-4" aria-hidden="true" />
						{t("settings.kiosks.add", "Add kiosk")}
					</Button>
				</CardHeader>
				<CardContent>
					{data.locations.length === 0 ? (
						<p className="mb-4 text-sm text-muted-foreground">
							{t(
								"settings.kiosks.noLocations",
								"Create a location first: every kiosk belongs to one location.",
							)}
						</p>
					) : null}
					{data.kiosks.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							{t("settings.kiosks.empty", "No kiosks yet.")}
						</p>
					) : (
						<KioskTable
							kiosks={data.kiosks}
							onEdit={setEditing}
							onPair={(kiosk) => setConfirmation({ kind: "pair", kiosk })}
							onRevoke={(kiosk) => setConfirmation({ kind: "revoke", kiosk })}
						/>
					)}
				</CardContent>
			</Card>

			<KioskFormDialog
				mode="create"
				open={creating}
				onOpenChange={setCreating}
				locations={data.locations}
				onCreated={(code, kioskName) => {
					setCreating(false);
					setPairing({ code, kioskName });
					router.refresh();
				}}
			/>
			{editing ? (
				<KioskFormDialog
					mode="edit"
					open
					onOpenChange={(open) => {
						if (!open) setEditing(null);
					}}
					locations={data.locations}
					kiosk={editing}
					onSaved={() => {
						setEditing(null);
						router.refresh();
					}}
				/>
			) : null}
			<PairingCodeDialog
				issued={pairing?.code ?? null}
				kioskName={pairing?.kioskName ?? ""}
				onClose={() => setPairing(null)}
			/>
			<AlertDialog
				open={confirmation !== null}
				onOpenChange={(open) => {
					if (!open && !pending) setConfirmation(null);
				}}
			>
				<AlertDialogContent>
					{confirmation?.kind === "revoke" ? (
						<AlertDialogHeader>
							<AlertDialogTitle>
								{t("settings.kiosks.revokeTitle", "Revoke {name}?", {
									name: confirmation.kiosk.name,
								})}
							</AlertDialogTitle>
							<AlertDialogDescription>
								{t(
									"settings.kiosks.revokeDescription",
									"The kiosk stops working on its next request and cannot be paired again. Create a new kiosk to replace it.",
								)}
							</AlertDialogDescription>
						</AlertDialogHeader>
					) : (
						<AlertDialogHeader>
							<AlertDialogTitle>
								{t("settings.kiosks.pairTitle", "Pair {name} again?", {
									name: confirmation?.kiosk.name ?? "",
								})}
							</AlertDialogTitle>
							<AlertDialogDescription>
								{confirmation?.kiosk.status === "paired"
									? t(
											"settings.kiosks.pairPairedDescription",
											"The device token is rotated: the paired device stops working immediately and must be paired again with the new code.",
										)
									: t(
											"settings.kiosks.pairUnpairedDescription",
											"A new pairing code replaces the previous one.",
										)}
							</AlertDialogDescription>
						</AlertDialogHeader>
					)}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={pending}>{t("common.cancel", "Cancel")}</AlertDialogCancel>
						<AlertDialogAction
							disabled={pending}
							onClick={(event) => {
								event.preventDefault();
								void confirm();
							}}
						>
							{confirmation?.kind === "revoke"
								? t("settings.kiosks.revokeConfirm", "Revoke kiosk")
								: confirmation?.kiosk.status === "paired"
									? t("settings.kiosks.rotateConfirm", "Rotate token and pair again")
									: t("settings.kiosks.issueCodeConfirm", "Issue new code")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

function KioskTable({
	kiosks,
	onEdit,
	onPair,
	onRevoke,
}: {
	kiosks: KioskData[];
	onEdit: (kiosk: KioskData) => void;
	onPair: (kiosk: KioskData) => void;
	onRevoke: (kiosk: KioskData) => void;
}) {
	const { t } = useTranslate();
	const locale = useLocale();

	return (
		<div className="overflow-x-auto">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>{t("settings.kiosks.columns.name", "Name")}</TableHead>
						<TableHead>{t("settings.kiosks.columns.location", "Location")}</TableHead>
						<TableHead>{t("settings.kiosks.columns.status", "Status")}</TableHead>
						<TableHead>{t("settings.kiosks.columns.lastSeen", "Last seen")}</TableHead>
						<TableHead className="text-right">
							<span className="sr-only">{t("settings.kiosks.columns.actions", "Actions")}</span>
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{kiosks.map((kiosk) => (
						<TableRow key={kiosk.id}>
							<TableCell>
								<div className="font-medium">{kiosk.name}</div>
								<div className="text-xs text-muted-foreground">
									{kiosk.timezone}
									{kiosk.boardEnabled
										? ` · ${t("settings.kiosks.boardOn", "Who-is-in board on")}`
										: ""}
								</div>
							</TableCell>
							<TableCell>{kiosk.locationName}</TableCell>
							<TableCell>
								<KioskStatusBadge kiosk={kiosk} />
							</TableCell>
							<TableCell className="text-sm">
								{kiosk.lastSeenAt
									? formatKioskInstant(locale, kiosk.lastSeenAt, kiosk.timezone)
									: t("settings.kiosks.neverSeen", "Never")}
							</TableCell>
							<TableCell className="text-right">
								{kiosk.status === "revoked" ? null : (
									<div className="flex flex-wrap justify-end gap-2">
										<Button variant="outline" size="sm" onClick={() => onEdit(kiosk)}>
											<IconPencil className="size-4" aria-hidden="true" />
											{t("settings.kiosks.edit", "Edit")}
										</Button>
										<Button variant="outline" size="sm" onClick={() => onPair(kiosk)}>
											<IconQrcode className="size-4" aria-hidden="true" />
											{t("settings.kiosks.pairAgain", "Pair again")}
										</Button>
										<Button variant="outline" size="sm" onClick={() => onRevoke(kiosk)}>
											<IconBan className="size-4" aria-hidden="true" />
											{t("settings.kiosks.revoke", "Revoke")}
										</Button>
									</div>
								)}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

function KioskStatusBadge({ kiosk }: { kiosk: KioskData }) {
	const { t } = useTranslate();
	if (kiosk.status === "revoked") {
		return <Badge variant="destructive">{t("settings.kiosks.status.revoked", "Revoked")}</Badge>;
	}
	if (kiosk.status === "paired") {
		return <Badge variant="default">{t("settings.kiosks.status.paired", "Paired")}</Badge>;
	}
	const expired =
		kiosk.pairingCodeExpiresAt === null ||
		Temporal.Instant.compare(parseInstant(kiosk.pairingCodeExpiresAt), Temporal.Now.instant()) <= 0;
	return (
		<Badge variant="secondary">
			{expired
				? t("settings.kiosks.status.codeExpired", "Not paired, code expired")
				: t("settings.kiosks.status.awaitingPairing", "Waiting for pairing")}
		</Badge>
	);
}
