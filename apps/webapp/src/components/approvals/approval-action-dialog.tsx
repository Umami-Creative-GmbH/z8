"use client";

import { IconCheck, IconLoader2, IconX } from "@tabler/icons-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface ApprovalActionDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	action: "approve" | "reject";
	title: string;
	description: string;
	onConfirm: (reason?: string) => Promise<void>;
}

export function ApprovalActionDialog({
	open,
	onOpenChange,
	action,
	title,
	description,
	onConfirm,
}: ApprovalActionDialogProps) {
	const [loading, setLoading] = useState(false);
	const [rejectionReason, setRejectionReason] = useState("");

	const handleConfirm = async () => {
		if (action === "reject" && !rejectionReason.trim()) {
			toast.error("Please provide a reason for rejection");
			return;
		}

		setLoading(true);
		const confirmed = await onConfirm(action === "reject" ? rejectionReason : undefined)
			.then(() => true)
			.catch(() => false);
		if (confirmed) {
			onOpenChange(false);
			setRejectionReason("");
		}
		setLoading(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>

				{action === "reject" && (
					<div className="grid gap-2 py-4">
						<Label htmlFor="reason">Reason for rejection *</Label>
						<Textarea
							id="reason"
							placeholder="Provide a clear reason for rejecting this request..."
							value={rejectionReason}
							onChange={(e) => setRejectionReason(e.target.value)}
							rows={4}
							required
						/>
					</div>
				)}

				{action === "approve" && (
					<div className="py-4">
						<p className="text-sm text-muted-foreground">
							This action will approve the request and notify the employee.
						</p>
					</div>
				)}

				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={loading}
					>
						Cancel
					</Button>
					<Button
						type="button"
						variant={action === "approve" ? "default" : "destructive"}
						onClick={handleConfirm}
						disabled={loading}
					>
						{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
						{action === "approve" ? (
							<>
								<IconCheck className="mr-2 size-4" />
								Approve
							</>
						) : (
							<>
								<IconX className="mr-2 size-4" />
								Reject
							</>
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
