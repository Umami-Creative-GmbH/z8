"use client";

import { IconArchive, IconDownload } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import type { OfflineRecoveryRecord } from "@/lib/offline/types";
import { runWithCleanup } from "@/lib/run-with-cleanup";

export function OfflineRecoveryDialog({
	loadRecords,
	archiveRecord,
}: {
	loadRecords: () => Promise<OfflineRecoveryRecord[]>;
	archiveRecord: (eventId: string) => Promise<OfflineRecoveryRecord[]>;
}) {
	const { t } = useTranslate();
	const [records, setRecords] = useState<OfflineRecoveryRecord[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const generation = useRef(0);
	useEffect(
		() => () => {
			generation.current++;
		},
		[],
	);

	async function load(archiveId?: string) {
		setBusy(true);
		setError(null);
		const started = ++generation.current;
		await runWithCleanup(
			async () => {
				try {
					const records = await (archiveId
						? archiveRecord(archiveId)
						: loadRecords());
					if (started !== generation.current) return;
					setRecords(records);
				} catch (error) {
					if (started !== generation.current) return;
					setRecords([]);
					setError(
						error instanceof Error
							? error.message
							: t(
									"common:offline.recovery.loadError",
									"Could not read saved records",
								),
					);
				}
			},
			() => {
				if (started === generation.current) setBusy(false);
			},
		);
	}

	async function exportRecords() {
		setBusy(true);
		setError(null);
		const started = ++generation.current;
		await runWithCleanup(
			async () => {
				try {
					// Reauthorize export rather than exporting stale data after context changes.
					const current = await loadRecords();
					if (started !== generation.current) return;
					const url = URL.createObjectURL(
						new Blob(
							[
								JSON.stringify(
									{ format: "z8-browser-recovery-v1", records: current },
									null,
									2,
								),
							],
							{ type: "application/json" },
						),
					);
					const anchor = document.createElement("a");
					anchor.href = url;
					anchor.download = "z8-saved-clock-records.json";
					anchor.click();
					URL.revokeObjectURL(url);
				} catch (error) {
					if (started !== generation.current) return;
					setError(
						error instanceof Error
							? error.message
							: t(
									"common:offline.recovery.exportError",
									"Could not export saved records",
								),
					);
				}
			},
			() => {
				if (started === generation.current) setBusy(false);
			},
		);
	}

	return (
		<Dialog
			onOpenChange={(open) => {
				if (open) void load();
				else {
					generation.current++;
					setRecords([]);
					setBusy(false);
				}
			}}
		>
			<DialogTrigger asChild>
				<Button size="sm" variant="secondary">
					{t("common:offline.recovery.review", "Review saved records")}
				</Button>
			</DialogTrigger>
			<DialogContent className="max-h-[85dvh] overflow-y-auto overscroll-contain sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>
						{t("common:offline.recovery.title", "Saved clock records")}
					</DialogTitle>
					<DialogDescription>
						{t(
							"common:offline.recovery.description",
							"These records are saved on this device. Server commitment is unknown. Check existing time entries with your manager before submitting replacement work. Archiving keeps the evidence and does not cancel work on the server.",
						)}
					</DialogDescription>
				</DialogHeader>
				{error ? (
					<p role="alert" className="text-sm text-destructive">
						{error}
					</p>
				) : null}
				{busy ? (
					<p role="status" className="text-sm text-muted-foreground">
						{t("common:offline.recovery.loading", "Reading saved records…")}
					</p>
				) : null}
				{!busy && !error && records.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{t(
							"common:offline.recovery.empty",
							"No accessible records. Older records without account evidence need organization-level review; records without organization evidence require separately authorized recovery.",
						)}
					</p>
				) : null}
				<ul className="space-y-3">
					{records.map((record) => (
						<li
							key={record.id}
							className="rounded-md border p-3 space-y-3 [content-visibility:auto] [contain-intrinsic-size:auto_150px]"
						>
							<p className="text-sm font-medium">
								{record.recovery?.state === "archived"
									? t(
											"common:offline.recovery.archived",
											"Archived — evidence retained",
										)
									: t(
											"common:offline.recovery.held",
											"Needs review — not confirmed on server",
										)}
							</p>
							<details>
								<summary className="cursor-pointer text-sm focus-visible:outline-ring">
									{t(
										"common:offline.recovery.evidence",
										"Original evidence and recovery status",
									)}
								</summary>
								<pre
									translate="no"
									className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs"
								>
									{JSON.stringify(record, null, 2)}
								</pre>
							</details>
							{record.recovery?.state !== "archived" ? (
								<Button
									variant="outline"
									size="sm"
									disabled={busy}
									onClick={() => void load(record.id)}
								>
									<IconArchive className="size-4" aria-hidden="true" />
									{t(
										"common:offline.recovery.archive",
										"Archive and retain evidence",
									)}
								</Button>
							) : null}
						</li>
					))}
				</ul>
				<Button
					variant="outline"
					disabled={busy || records.length === 0}
					onClick={() => void exportRecords()}
				>
					<IconDownload className="size-4" aria-hidden="true" />
					{t("common:offline.recovery.export", "Export accessible evidence")}
				</Button>
			</DialogContent>
		</Dialog>
	);
}
