import { Suspense } from "react";
import { JoinOrganizationForm } from "@/components/join-organization-form";
import { Skeleton } from "@/components/ui/skeleton";

interface JoinPageProps {
	params: Promise<{ code: string }>;
}

async function JoinPageContent({ params }: JoinPageProps) {
	const { code } = await params;
	return <JoinOrganizationForm code={code} />;
}

function JoinPageLoading() {
	return (
		<div className="mx-auto w-full max-w-md space-y-4">
			<Skeleton className="h-8 w-48" />
			<Skeleton className="h-[320px] w-full" />
		</div>
	);
}

export default function JoinPage(props: JoinPageProps) {
	return (
		<Suspense fallback={<JoinPageLoading />}>
			<JoinPageContent {...props} />
		</Suspense>
	);
}
