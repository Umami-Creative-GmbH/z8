"use client";

import { IconBell, IconLoader2, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
	ActionPanel,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";

interface PushPermissionModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onEnable: () => Promise<boolean>;
	onDismiss: () => void;
	isLoading: boolean;
}

export function PushPermissionModal({
	open,
	onOpenChange,
	onEnable,
	onDismiss,
	isLoading,
}: PushPermissionModalProps) {
	const handleEnable = async () => {
		const success = await onEnable();
		if (success) {
			onOpenChange(false);
		}
	};

	const handleDismiss = () => {
		onDismiss();
		onOpenChange(false);
	};

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent showCloseButton={false} size="compact">
				<ActionPanelHeader className="text-center sm:text-center">
					<div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10">
						<IconBell className="size-6 text-primary" />
					</div>
					<ActionPanelTitle>Stay Updated</ActionPanelTitle>
					<ActionPanelDescription className="text-center">
						Enable push notifications to receive instant updates about approvals, time corrections,
						and important team changes - even when you're not using the app.
					</ActionPanelDescription>
				</ActionPanelHeader>

				<div className="space-y-3 rounded-lg bg-muted/50 p-4 text-sm">
					<div className="flex items-start gap-3">
						<div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
							<span className="text-xs text-green-600 dark:text-green-400">1</span>
						</div>
						<p className="text-muted-foreground">
							Get notified when your requests are approved or rejected
						</p>
					</div>
					<div className="flex items-start gap-3">
						<div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
							<span className="text-xs text-green-600 dark:text-green-400">2</span>
						</div>
						<p className="text-muted-foreground">Receive alerts for pending approval requests</p>
					</div>
					<div className="flex items-start gap-3">
						<div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
							<span className="text-xs text-green-600 dark:text-green-400">3</span>
						</div>
						<p className="text-muted-foreground">Stay informed about team and security updates</p>
					</div>
				</div>

				<ActionPanelFooter className="flex-col gap-2 sm:flex-col">
					<Button onClick={handleEnable} disabled={isLoading} className="w-full">
						{isLoading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
						Enable Notifications
					</Button>
					<Button
						variant="ghost"
						onClick={handleDismiss}
						disabled={isLoading}
						className="w-full text-muted-foreground"
					>
						<IconX className="mr-2 size-4" />
						Not Now
					</Button>
				</ActionPanelFooter>
			</ActionPanelContent>
		</ActionPanel>
	);
}
