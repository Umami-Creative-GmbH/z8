"use client";

import { IconDownload, IconLoader2 } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	generateInviteQRCode,
	type InviteCodeWithRelations,
} from "@/app/[locale]/(app)/settings/organizations/invite-code-actions";

interface InviteCodeQRDialogProps {
	inviteCode: InviteCodeWithRelations | null;
	organizationId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function InviteCodeQRDialog({
	inviteCode,
	organizationId,
	open,
	onOpenChange,
}: InviteCodeQRDialogProps) {
	const { t } = useTranslate();
	const [format, setFormat] = useState<"png" | "svg">("png");
	const [qrData, setQrData] = useState<{ png?: string; svg?: string }>({});

	// Generate QR code mutation
	const generateMutation = useMutation({
		mutationFn: async (fmt: "png" | "svg") => {
			if (!inviteCode) throw new Error("No invite code");
			const result = await generateInviteQRCode(inviteCode.id, organizationId, fmt);
			if (!result.success) throw new Error(result.error || "Failed to generate QR code");
			return result.data;
		},
		onSuccess: (data) => {
			setQrData((prev) => ({
				...prev,
				[data.format]: data.data,
			}));
		},
		onError: (error) => {
			toast.error(error.message);
		},
	});

	// Generate QR when tab changes or dialog opens
	const handleTabChange = (newFormat: string) => {
		const fmt = newFormat as "png" | "svg";
		setFormat(fmt);

		// Generate if we don't have this format yet
		if (!qrData[fmt] && inviteCode) {
			generateMutation.mutate(fmt);
		}
	};

	// Generate initial QR when dialog opens
	const handleOpenChange = (isOpen: boolean) => {
		if (isOpen && inviteCode && !qrData.png) {
			generateMutation.mutate("png");
		}
		if (!isOpen) {
			// Reset state when closing
			setQrData({});
			setFormat("png");
		}
		onOpenChange(isOpen);
	};

	// Download QR code
	const handleDownload = () => {
		if (!inviteCode) return;

		const data = qrData[format];
		if (!data) return;

		const filename = `invite-${inviteCode.code.toLowerCase()}.${format}`;

		if (format === "svg") {
			// Download SVG
			const blob = new Blob([data], { type: "image/svg+xml" });
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = filename;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
		} else {
			// Download PNG (base64)
			const link = document.createElement("a");
			link.href = `data:image/png;base64,${data}`;
			link.download = filename;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
		}

		toast.success(t("settings.inviteCodes.qrDownloaded", "QR code downloaded"));
	};

	const joinUrl = inviteCode
		? `${typeof window !== "undefined" ? window.location.origin : ""}/join/${inviteCode.code}`
		: "";

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-[400px]">
				<DialogHeader>
					<DialogTitle>{t("settings.inviteCodes.qrCode", "QR Code")}</DialogTitle>
					<DialogDescription>
						{t("settings.inviteCodes.qrDescription", "Scan this QR code to join the organization")}
					</DialogDescription>
				</DialogHeader>

				<div className="py-4">
					{/* Code and URL display */}
					<div className="mb-4 text-center">
						<div className="text-2xl font-mono font-bold">{inviteCode?.code}</div>
						<div className="text-sm text-muted-foreground truncate mt-1">{joinUrl}</div>
					</div>

					{/* QR Code display */}
					<Tabs value={format} onValueChange={handleTabChange}>
						<TabsList className="grid w-full grid-cols-2">
							<TabsTrigger value="png">{t("settings.inviteCodes.formatPng", "PNG")}</TabsTrigger>
							<TabsTrigger value="svg">{t("settings.inviteCodes.formatSvg", "SVG")}</TabsTrigger>
						</TabsList>

						<TabsContent value="png" className="mt-4">
							<div className="flex items-center justify-center min-h-[256px] bg-white rounded-lg p-4">
								{generateMutation.isPending && format === "png" ? (
									<IconLoader2 className="h-8 w-8 animate-spin text-muted-foreground" />
								) : qrData.png ? (
									<img
										src={`data:image/png;base64,${qrData.png}`}
										alt={t("settings.inviteCodes.qrAlt", "QR code for {code}", {
											code: inviteCode?.code,
										})}
										width={256}
										height={256}
										className="max-w-full"
									/>
								) : (
									<div className="text-muted-foreground">
										{t("settings.inviteCodes.generatingQR", "Generating QR code...")}
									</div>
								)}
							</div>
						</TabsContent>

						<TabsContent value="svg" className="mt-4">
							<div className="flex items-center justify-center min-h-[256px] bg-white rounded-lg p-4">
								{generateMutation.isPending && format === "svg" ? (
									<IconLoader2 className="h-8 w-8 animate-spin text-muted-foreground" />
								) : qrData.svg ? (
									<div
										dangerouslySetInnerHTML={{ __html: qrData.svg }}
										className="max-w-full [&>svg]:max-w-full [&>svg]:h-auto"
									/>
								) : (
									<div className="text-muted-foreground">
										{t("settings.inviteCodes.generatingQR", "Generating QR code...")}
									</div>
								)}
							</div>
						</TabsContent>
					</Tabs>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{t("common.close", "Close")}
					</Button>
					<Button onClick={handleDownload} disabled={!qrData[format] || generateMutation.isPending}>
						<IconDownload className="mr-2 h-4 w-4" />
						{t("settings.inviteCodes.downloadFormat", "Download {format}", {
							format: format.toUpperCase(),
						})}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
