import { NotificationsInbox } from "@/components/notifications";
import { requireUser } from "@/lib/auth-helpers";

export default async function NotificationsPage() {
	await requireUser();

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 pt-0 md:gap-6 md:p-6 md:pt-0">
			<NotificationsInbox />
		</div>
	);
}
