import Image from "next/image";
import Link from "next/link";

export default function Design10() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Hiragino Mincho ProN', 'Yu Mincho', 'Garamond', 'Georgia', serif",
				backgroundColor: "#f6f3ee",
				color: "#2c2c28",
			}}
		>
			{/* Header */}
			<header className="relative z-10 flex items-center justify-between px-10 py-10 lg:px-24">
				<span className="text-xl tracking-[0.15em]" style={{ color: "#8a8478" }}>
					Z8
				</span>
				<nav className="hidden items-center gap-12 text-[12px] tracking-[0.2em] text-[#a8a298] md:flex">
					<a href="#features" className="transition-colors hover:text-[#2c2c28]">
						Funktionen
					</a>
					<a href="#philosophy" className="transition-colors hover:text-[#2c2c28]">
						Gedanken
					</a>
					<a href="#contact" className="transition-colors hover:text-[#2c2c28]">
						Kontakt
					</a>
				</nav>
				<a
					href="#contact"
					className="text-[11px] tracking-[0.2em] text-[#8a8478] transition-colors hover:text-[#2c2c28]"
				>
					Anfragen &rarr;
				</a>
			</header>

			{/* Hero - extreme whitespace */}
			<section className="relative z-10 px-10 pb-32 pt-16 lg:px-24">
				<div className="mx-auto max-w-4xl">
					<div className="mb-16 flex justify-center">
						<div className="h-24 w-px" style={{ backgroundColor: "#2c2c2815" }} />
					</div>

					<h1
						className="animate-fade-up text-center text-[clamp(2.5rem,6vw,5rem)] leading-[1.2] tracking-[0.02em]"
						style={{ animationDelay: "0.2s" }}
					>
						Stille Pr&auml;zision
					</h1>

					<p
						className="animate-fade-up mx-auto mt-8 max-w-md text-center text-[15px] leading-[2] text-[#8a8478]"
						style={{ animationDelay: "0.4s" }}
					>
						Zeiterfassung, die sich zur&uuml;cknimmt. Die funktioniert, ohne zu
						st&ouml;ren. GoBD-konform, unsichtbar integriert.
					</p>

					<div className="mt-16 flex justify-center">
						<div className="h-24 w-px" style={{ backgroundColor: "#2c2c2815" }} />
					</div>
				</div>
			</section>

			{/* Image - full width, restrained */}
			<section className="relative z-10 mx-10 lg:mx-24">
				<div className="animate-scale-in relative h-[50vh] overflow-hidden" style={{ animationDelay: "0.5s" }}>
					<Image
						src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=1600&q=80&auto=format&fit=crop"
						alt="Quiet workspace"
						fill
						className="object-cover"
						style={{ objectPosition: "center 40%", filter: "saturate(0.7) brightness(1.05)" }}
						priority
					/>
				</div>
			</section>

			{/* Spacer */}
			<div className="relative z-10 flex justify-center py-20">
				<div className="h-16 w-px" style={{ backgroundColor: "#2c2c2815" }} />
			</div>

			{/* Features - sparse, one at a time feel */}
			<section id="features" className="relative z-10 px-10 pb-32 lg:px-24">
				<p className="mb-20 text-center text-[11px] tracking-[0.5em] text-[#a8a298]">
					FUNKTIONEN
				</p>

				<div className="mx-auto max-w-3xl">
					<div className="grid gap-16 md:grid-cols-2">
						{[
							{ title: "Stempeluhr", desc: "Ein Klick. Alle Ger\u00e4te. Stille Synchronisation." },
							{ title: "GoBD-Konform", desc: "Unver\u00e4nderbar. Revisionssicher. Ohne Aufwand." },
							{ title: "Lohnexport", desc: "DATEV, Lexware, Personio. Nahtlos und automatisch." },
							{ title: "Team-\u00dcbersicht", desc: "Klarheit \u00fcber Anwesenheit. Ohne \u00dcberfl\u00fcssiges." },
							{ title: "Enterprise-SSO", desc: "SAML, OIDC, SCIM. Sicher und ger\u00e4uschlos." },
							{ title: "Analyse", desc: "\u00dcberstunden und Trends. Sichtbar, wenn n\u00f6tig." },
						].map((f, i) => (
							<div key={i} className="group text-center">
								<h3 className="mb-3 text-lg tracking-wide">{f.title}</h3>
								<p className="text-[13px] leading-[1.9] text-[#a8a298]">{f.desc}</p>
								<div
									className="mx-auto mt-6 h-px w-6 transition-all duration-700 group-hover:w-12"
									style={{ backgroundColor: "#2c2c2830" }}
								/>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Two images - asymmetric pair */}
			<section className="relative z-10 mx-10 mb-32 lg:mx-24">
				<div className="grid gap-4 md:grid-cols-5">
					<div className="relative h-72 overflow-hidden md:col-span-2">
						<Image
							src="https://images.unsplash.com/photo-1497215842964-222b430dc094?w=600&q=80&auto=format&fit=crop"
							alt=""
							fill
							className="object-cover"
							style={{ filter: "saturate(0.6) brightness(1.05)" }}
						/>
					</div>
					<div className="relative h-72 overflow-hidden md:col-span-3">
						<Image
							src="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=900&q=80&auto=format&fit=crop"
							alt=""
							fill
							className="object-cover"
							style={{ filter: "saturate(0.6) brightness(1.05)" }}
						/>
					</div>
				</div>
			</section>

			{/* Philosophy */}
			<section id="philosophy" className="relative z-10 px-10 py-24 lg:px-24">
				<div className="mx-auto max-w-xl text-center">
					<div className="mb-10 flex justify-center">
						<div className="h-16 w-px" style={{ backgroundColor: "#2c2c2815" }} />
					</div>
					<blockquote className="text-[clamp(1.4rem,3vw,2.2rem)] leading-[1.5] tracking-[0.01em]">
						Das beste Werkzeug ist das, welches man nicht bemerkt.
					</blockquote>
					<div className="mt-10 flex justify-center">
						<div className="h-16 w-px" style={{ backgroundColor: "#2c2c2815" }} />
					</div>
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 px-10 py-24 lg:px-24">
				<div className="mx-auto max-w-md text-center">
					<p className="mb-6 text-[11px] tracking-[0.5em] text-[#a8a298]">KONTAKT</p>
					<h2 className="mb-6 text-3xl tracking-wide">Bereit?</h2>
					<p className="mb-10 text-[14px] leading-[1.9] text-[#8a8478]">
						Wir zeigen Ihnen Z8 in einer ruhigen, pers&ouml;nlichen Demo.
					</p>
					<a
						href="mailto:hello@z8.app"
						className="inline-block px-8 py-3.5 text-[12px] tracking-[0.2em] text-[#f6f3ee] transition-opacity hover:opacity-80"
						style={{ backgroundColor: "#2c2c28" }}
					>
						Demo vereinbaren
					</a>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-10 py-10 lg:px-24">
				<div className="flex items-center justify-between text-[11px] tracking-[0.2em] text-[#b5b0a5]">
					<span>&copy; 2025 Z8</span>
					<Link href="/" className="transition-colors hover:text-[#2c2c28]">
						&larr; Alle Designs
					</Link>
				</div>
			</footer>
		</div>
	);
}
