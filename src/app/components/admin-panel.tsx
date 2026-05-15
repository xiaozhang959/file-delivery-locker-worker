"use client";

import type { FormEvent } from "react";
import { useI18n } from "../i18n";

type AdminPanelProps = {
	busy: boolean;
	manageCode: string;
	onManageCodeChange: (value: string) => void;
	onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function AdminPanel({ busy, manageCode, onManageCodeChange, onSubmit }: AdminPanelProps) {
	const { t } = useI18n();

	return (
		<form className="panel admin-panel flex flex-col gap-5 w-full" onSubmit={onSubmit}>
			<div>
				<h2>{t("admin.manageTitle")}</h2>
				<p className="panel-copy">{t("admin.manageCopy")}</p>
			</div>
			<label className="field flex flex-col gap-2">
				<span>{t("admin.manageCode")}</span>
				<input
					className="h-[42px] w-full"
					autoCapitalize="characters"
					value={manageCode}
					onChange={(event) => onManageCodeChange(event.target.value.toUpperCase())}
					placeholder={t("admin.managePlaceholder")}
				/>
			</label>
			<button
				className="danger-button inline-flex min-h-10 items-center justify-center gap-[9px] rounded-lg px-5 text-sm leading-none font-medium no-underline"
				disabled={busy}
				type="submit"
			>
				<span aria-hidden="true">×</span>
				{busy ? t("admin.revoking") : t("admin.revokeFile")}
			</button>
		</form>
	);
}
