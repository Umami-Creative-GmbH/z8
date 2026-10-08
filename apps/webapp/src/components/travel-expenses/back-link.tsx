import { IconArrowLeft } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "@/navigation";

/** The way back from a travel expense page, styled like the app's other detail pages. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
	return (
		<Button
			asChild
			variant="ghost"
			size="sm"
			className="-ml-2.5 w-fit text-muted-foreground hover:text-foreground"
		>
			<Link href={href}>
				<IconArrowLeft aria-hidden="true" className="size-4" />
				{children}
			</Link>
		</Button>
	);
}
