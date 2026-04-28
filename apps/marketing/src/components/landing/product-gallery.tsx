import Image from "next/image";
import type { LandingCopy } from "@/i18n/landing-copy";

type ProductGalleryProps = {
	images: LandingCopy["galleryImages"];
};

export function ProductGallery({ images }: ProductGalleryProps) {
	return (
		<section className="relative z-10 mx-8 lg:mx-16">
			<div className="grid gap-4 md:grid-cols-3">
				{images.map((src) => (
					<div key={src} className="relative h-56 overflow-hidden rounded-2xl">
						<Image
							src={src}
							alt=""
							fill
							className="object-cover transition-transform duration-700 hover:scale-105"
						/>
					</div>
				))}
			</div>
		</section>
	);
}
