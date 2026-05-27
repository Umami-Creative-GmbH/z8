import Image from "next/image";
import type { LandingCopy } from "@/i18n/landing-copy";

type LargeBannerProps = {
	copy: LandingCopy["largeBanner"];
};

export function LargeBanner({ copy }: LargeBannerProps) {
	return (
		<section
			className="relative z-10 mx-8 overflow-hidden rounded-3xl lg:mx-16"
			style={{ height: "420px" }}
		>
			<Image
				src={copy.image}
				alt={copy.imageAlt}
				fill
				sizes="(max-width: 1024px) 100vw, 90vw"
				className="object-cover"
			/>
			<div
				className="absolute inset-0 flex flex-col items-center justify-center text-center"
				style={{
					background: "linear-gradient(to top, rgba(26,26,26,0.85) 0%, rgba(26,26,26,0.4) 100%)",
				}}
			>
				<h2
					className="mb-4 text-white"
					style={{
						fontSize: "clamp(1.8rem, 3.5vw, 2.8rem)",
						fontWeight: 700,
						letterSpacing: "-0.02em",
					}}
				>
					{copy.title}
				</h2>
				<p className="max-w-md text-[15px] text-[#bbb]">{copy.description}</p>
			</div>
		</section>
	);
}
