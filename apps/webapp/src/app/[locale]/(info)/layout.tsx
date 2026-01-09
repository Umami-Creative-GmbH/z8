import Image from "next/image";
import bgImage from "@/../public/ally-griffin-3hsrEvJi_gw-unsplash.jpg";
import { InfoFooter } from "@/components/info-footer";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { Card, CardContent } from "@/components/ui/card";

type Props = {
	children: React.ReactNode;
};

export default function InfoLayout({ children }: Props) {
	return (
		<div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
			<div className="w-full max-w-sm md:max-w-3xl">
				<div className="mb-4 flex justify-end gap-2">
					<ThemeToggle />
					<LanguageSwitcher />
				</div>
				<Card className="overflow-hidden p-0">
					<CardContent className="relative p-0">
						<div className="relative z-20 flex h-[calc(100vh-8rem)] w-full flex-col bg-card p-6 md:p-8">
							{children}
						</div>
						<div className="absolute inset-0 z-10 hidden bg-muted md:block">
							<Image
								alt="Background Image - Foto von Ally Griffin auf Unsplash"
								fill
								placeholder="blur"
								quality={75}
								sizes="100vw"
								src={bgImage}
								style={{
									objectFit: "cover",
								}}
							/>
						</div>
					</CardContent>
				</Card>
				<div className="mt-6">
					<InfoFooter />
				</div>
			</div>
		</div>
	);
}
