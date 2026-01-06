import { ProfileForm } from "@/components/settings/profile-form";
import { requireAuth } from "@/lib/auth-helpers";

export default async function ProfilePage() {
	const authContext = await requireAuth();

	return (
		<div className="flex-1 p-6">
			<div className="mx-auto max-w-2xl">
				<div className="mb-6">
					<h1 className="text-2xl font-semibold">Profile Settings</h1>
					<p className="text-muted-foreground">
						Manage your account information and security settings
					</p>
				</div>
				<ProfileForm user={authContext.user} />
			</div>
		</div>
	);
}
