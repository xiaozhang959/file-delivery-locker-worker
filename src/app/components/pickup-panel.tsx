"use client";

import type { FormEvent } from "react";
import { useI18n } from "../i18n";
import { formatBytes, formatTime } from "./locker-format";
import type { Delivery, TextPreview } from "./locker-types";
import { Mini } from "./mini";
import { PickupCodeInput } from "./pickup-code-input";

function formatDownloadLimit(delivery: Delivery, textPreview: TextPreview | null, unlimitedLabel: string) {
	if (delivery.maxDownloads === 0) {
		return unlimitedLabel;
	}

	const remaining = delivery.kind === "text" && textPreview ? textPreview.remainingDownloads : delivery.remainingDownloads;
	return `${remaining ?? 0}/${delivery.maxDownloads}`;
}

type PickupPanelProps = {
	busy: boolean;
	delivery: Delivery | null;
	downloading: boolean;
	pickupCode: string;
	pickupAccessToken: string;
	powStatus: string;
	textPreview: TextPreview | null;
	onCopy: (value: string) => void;
	onDownload: () => void;
	onPickupCodeChange: (value: string) => void;
	onSubmit: (event?: FormEvent<HTMLFormElement>) => void;
};

export function PickupPanel({
	busy,
	delivery,
	downloading,
	pickupCode,
	pickupAccessToken,
	powStatus,
	textPreview,
	onCopy,
	onDownload,
	onPickupCodeChange,
	onSubmit,
}: PickupPanelProps) {
	const { locale, t } = useI18n();
	const statusText: Record<Delivery["status"], string> = {
		available: t("status.available"),
		deleted: t("status.deleted"),
		depleted: t("status.depleted"),
		expired: t("status.expired"),
	};

	return (
		<form className="panel panel-dark flex items-center justify-center flex-col gap-5 h-full" onSubmit={onSubmit}>
			<div className="w-full">
				<h2>{t("pickup.title")}</h2>
				<p className="panel-copy">{t("pickup.copy")}</p>
			</div>
			<PickupCodeInput value={pickupCode} onChange={onPickupCodeChange} />
			<button
				className="secondary-button inline-flex min-h-10 items-center justify-center gap-[9px] rounded-lg px-5 text-sm leading-none font-medium no-underline"
				disabled={busy}
				type="submit"
			>
				<span aria-hidden="true">⌕</span>
				{busy ? t("pickup.searching") : t("pickup.search")}
			</button>
			{powStatus && <p className="panel-copy m-0 text-center">{powStatus}</p>}

			{delivery && (
				<div className="delivery-box flex flex-col gap-4">
					<div className="flex items-start justify-between gap-4">
						<div className="min-w-0">
							<p className="truncate font-semibold">{delivery.fileName}</p>
							<p className="panel-copy">{formatBytes(delivery.size)}</p>
						</div>
						<span className="status-pill flex-none rounded-full px-2.5 py-[5px]">{statusText[delivery.status]}</span>
					</div>
					<div className="grid grid-cols-2 gap-3 text-sm">
						<Mini
							label={t("pickup.remaining")}
							value={formatDownloadLimit(delivery, textPreview, t("common.unlimited"))}
						/>
						<Mini label={t("pickup.expires")} value={formatTime(delivery.expiresAt, locale, t("common.forever"))} />
					</div>
					{delivery.kind === "text" ? (
						delivery.status === "available" ? (
							<div className="text-preview flex flex-col gap-3">
								<div className="flex items-center justify-between gap-3">
									<span>{t("pickup.preview")}</span>
									{textPreview && (
										<small>
											{textPreview.remainingDownloads === null
												? t("common.unlimited")
												: t("pickup.remainingTimes", { count: textPreview.remainingDownloads })}
										</small>
									)}
								</div>
								<pre>{textPreview?.text ?? t("pickup.loadingText")}</pre>
								<button
									className="secondary-button inline-flex min-h-10 items-center justify-center gap-[9px] rounded-lg px-5 text-sm leading-none font-medium no-underline"
									disabled={!textPreview}
									type="button"
									onClick={() => textPreview && onCopy(textPreview.text)}
								>
									<span aria-hidden="true">⧉</span>
									{t("pickup.copyText")}
								</button>
							</div>
						) : null
					) : (
							<button
								className="primary-button inline-flex min-h-10 items-center justify-center gap-[9px] rounded-lg px-5 text-sm leading-none font-medium no-underline"
								disabled={delivery.status !== "available" || !pickupAccessToken || downloading}
								type="button"
								onClick={onDownload}
							>
								<span aria-hidden="true">↓</span>
								{downloading ? t("pickup.downloading") : t("pickup.download")}
							</button>
					)}
				</div>
			)}
		</form>
	);
}
