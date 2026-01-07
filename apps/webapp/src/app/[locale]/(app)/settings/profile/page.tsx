import { ProfileForm } from "@/components/settings/profile-form";
import { TimezoneSettings } from "@/components/settings/timezone-settings";
import { requireUser } from "@/lib/auth-helpers";
import { getCurrentTimezone, updateTimezone } from "./actions";

export default async function ProfilePage() {
	const authContext = await requireUser();
	const currentTimezone = await getCurrentTimezone();

	return (
		<div className="p-6">
			<div className="mx-auto max-w-2xl space-y-6">
				<div>
					<h1 className="text-2xl font-semibold">Profile Settings</h1>
					<p className="text-muted-foreground">
						Manage your personal information and preferences
					</p>
				</div>

				<ProfileForm user={authContext.user} />

				<TimezoneSettings
					currentTimezone={currentTimezone}
					onUpdate={async (timezone) => {
						"use server";
						const result = await updateTimezone(timezone);
						return result.success
							? { success: true }
							: { success: false, error: result.error?.message };
					}}
				/>
			</div>
		</div>
	);
}
