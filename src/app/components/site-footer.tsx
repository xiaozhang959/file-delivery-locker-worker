"use client";

import { useI18n } from "../i18n";

export function SiteFooter() {
	const { language, setLanguage, t } = useI18n();

	return (
		<div className="bg-[var(--surface-dark)] px-5 pt-14 pb-10 text-[var(--on-dark-soft)] max-md:pt-10 max-md:pb-8" role="contentinfo">
			<div className="mx-auto flex max-w-[1200px] items-start justify-between gap-8 max-md:flex-col max-md:gap-7">
				<div className="flex max-w-[520px] items-start gap-3.5">
					<img src="/logo.webp" alt="logo" className="w-16" />
					<div>
						<strong className="block text-[22px] leading-[1.3] font-medium text-[var(--on-dark)]">
							{t("footer.brand")}
						</strong>
						<p className="mt-2 mb-0 text-sm leading-[1.55]">{t("footer.copy")}</p>
					</div>
				</div>

				<div className="flex flex-none flex-wrap items-center justify-end gap-3 max-md:w-full max-md:justify-start" aria-label={t("language.switch")}>
					<span className="text-[13px] leading-[1.4] font-medium text-[var(--on-dark-soft)]">{t("language.label")}</span>
					<div
						className="inline-flex items-center rounded-full border border-[rgba(250,249,245,0.12)] bg-[var(--surface-dark-elevated)] p-[3px]"
						role="group"
						aria-label={t("language.switch")}
					>
						<button
							className={`min-h-[30px] cursor-pointer rounded-full border-0 px-3 text-[13px] leading-none font-medium transition-colors ${
								language === "zh"
									? "bg-[var(--canvas)] text-[var(--ink)]"
									: "bg-transparent text-[var(--on-dark-soft)] hover:text-[var(--on-dark)]"
							}`}
							type="button"
							aria-pressed={language === "zh"}
							onClick={() => setLanguage("zh")}
						>
							{t("language.zh")}
						</button>
						<button
							className={`min-h-[30px] cursor-pointer rounded-full border-0 px-3 text-[13px] leading-none font-medium transition-colors ${
								language === "en"
									? "bg-[var(--canvas)] text-[var(--ink)]"
									: "bg-transparent text-[var(--on-dark-soft)] hover:text-[var(--on-dark)]"
							}`}
							type="button"
							aria-pressed={language === "en"}
							onClick={() => setLanguage("en")}
						>
							{t("language.en")}
						</button>
					</div>
				</div>
			</div>
			<div className="mx-auto mt-10 mb-0 max-w-[1200px] border-t border-[rgba(250,249,245,0.1)] pt-5 text-sm leading-[1.55]">
				<ul>
					<li><a href="https://github.com/meorionel/file-delivery-locker-worker" className="hover:border-b border-[rgba(250,249,245,0.1)]">Open Source</a></li>
				</ul>
			</div>
		</div>
	);
}
