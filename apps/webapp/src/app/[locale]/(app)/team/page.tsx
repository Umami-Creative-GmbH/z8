import { Suspense } from "react";
import { TeamDirectory } from "./team-directory";
import { TeamDirectoryLoading } from "./team-directory-feedback";

export const instant = true;

type TeamPageProps = {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function TeamPage(props: TeamPageProps) {
	return (
		<Suspense fallback={<TeamDirectoryLoading />}>
			<TeamDirectory {...props} />
		</Suspense>
	);
}
