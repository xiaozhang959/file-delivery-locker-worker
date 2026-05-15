"use client";

import { useI18n } from "../i18n";

export default function AdminDisabled() {
	const { t } = useI18n();

	return (
		<main className="app-shell min-h-screen">
			<section className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col items-center justify-center px-5 py-16 sm:px-8">
				<div className="panel panel-feature flex w-[min(100%,460px)] flex-col gap-3">
					<h2>{t("admin.disabled")}</h2>
					<p className="panel-copy">{t("admin.configurePassword")}</p>
				</div>
			</section>
		</main>
	);
}
