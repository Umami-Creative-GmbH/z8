import { IconChevronRight } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "@/navigation";

type DirectoryEmployee = {
	id: string;
	name: string;
	employeeNumber: string | null;
	isActive: boolean;
};

/** A scoped employee directory; callers load the employees the viewer may access. */
export function EmployeeDirectoryCard({
	employees,
	basePath,
	formerEmployeeLabel,
}: {
	employees: readonly DirectoryEmployee[];
	basePath: string;
	formerEmployeeLabel: string;
}) {
	return (
		<Card className="py-0">
			<CardContent className="px-0">
				<ul className="divide-y">
					{employees.map((employee) => (
						<li key={employee.id}>
							<Link
								href={`${basePath}/${employee.id}`}
								className="flex min-w-0 items-center gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
							>
								<span className="min-w-0 flex-1">
									<span className="block truncate font-medium">
										{employee.name}
									</span>
									{employee.employeeNumber ? (
										<span className="block text-sm text-muted-foreground tabular-nums">
											{employee.employeeNumber}
										</span>
									) : null}
								</span>
								{employee.isActive ? null : (
									<Badge variant="secondary">{formerEmployeeLabel}</Badge>
								)}
								<IconChevronRight
									aria-hidden="true"
									className="size-4 shrink-0 text-muted-foreground"
								/>
							</Link>
						</li>
					))}
				</ul>
			</CardContent>
		</Card>
	);
}
