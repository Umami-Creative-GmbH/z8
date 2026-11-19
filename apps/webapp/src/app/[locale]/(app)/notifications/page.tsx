import { NotificationsInbox } from "@/components/notifications";
import { requireUser } from "@/lib/auth-helpers";

export default async function NotificationsPage() {
	await requireUser();

	return (
		<div className="page-frame flex flex-1 flex-col gap-4 md:gap-6">
			<NotificationsInbox />
		</div>
	);
}
