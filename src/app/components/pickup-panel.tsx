"use client";

import type { FormEvent } from "react";
import { formatBytes, formatTime, normalizePickupCode } from "./locker-format";
import type { Delivery, TextPreview } from "./locker-types";
import { Mini } from "./mini";
import { PickupCodeInput } from "./pickup-code-input";

const statusText: Record<Delivery["status"], string> = {
	available: "可取件",
	deleted: "已撤回",
	depleted: "次数已用尽",
	expired: "已过期",
};

type PickupPanelProps = {
	busy: boolean;
	delivery: Delivery | null;
	pickupCode: string;
	textPreview: TextPreview | null;
	onCopy: (value: string) => void;
	onDownloadStarted: () => void;
	onPickupCodeChange: (value: string) => void;
	onSubmit: (event?: FormEvent<HTMLFormElement>) => void;
};

export function PickupPanel({
	busy,
	delivery,
	pickupCode,
	textPreview,
	onCopy,
	onDownloadStarted,
	onPickupCodeChange,
	onSubmit,
}: PickupPanelProps) {
	return (
		<form className="panel panel-dark flex items-center justify-center flex-col gap-5 h-full" onSubmit={onSubmit}>
			<div className="w-full">
				<h2>取件</h2>
				<p className="panel-copy">输入取件码查看文件状态</p>
			</div>
			<PickupCodeInput value={pickupCode} onChange={onPickupCodeChange} />
			<button
				className="secondary-button inline-flex min-h-10 items-center justify-center gap-[9px] rounded-lg px-5 text-sm leading-none font-medium no-underline"
				disabled={busy}
				type="submit"
			>
				<span aria-hidden="true">⌕</span>
				{busy ? "查询中" : "查询文件"}
			</button>

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
							label="剩余"
							value={`${
								delivery.kind === "text" && textPreview ? textPreview.remainingDownloads : delivery.remainingDownloads
							}/${delivery.maxDownloads}`}
						/>
						<Mini label="过期" value={formatTime(delivery.expiresAt)} />
					</div>
					{delivery.kind === "text" ? (
						delivery.status === "available" ? (
							<div className="text-preview flex flex-col gap-3">
								<div className="flex items-center justify-between gap-3">
									<span>文本预览</span>
									{typeof textPreview?.remainingDownloads === "number" && <small>剩余 {textPreview.remainingDownloads} 次</small>}
								</div>
								<pre>{textPreview?.text ?? "正在读取文本..."}</pre>
								<button
									className="secondary-button inline-flex min-h-10 items-center justify-center gap-[9px] rounded-lg px-5 text-sm leading-none font-medium no-underline"
									disabled={!textPreview}
									type="button"
									onClick={() => textPreview && onCopy(textPreview.text)}
								>
									<span aria-hidden="true">⧉</span>
									复制文本
								</button>
							</div>
						) : null
					) : (
							<a
								className="primary-button inline-flex min-h-10 items-center justify-center gap-[9px] rounded-lg px-5 text-sm leading-none font-medium no-underline"
								aria-disabled={delivery.status !== "available"}
								href={
									delivery.status === "available"
										? `/api/deliveries/${encodeURIComponent(normalizePickupCode(pickupCode))}/download`
										: undefined
								}
								onClick={() => window.setTimeout(onDownloadStarted, 1200)}
							>
								<span aria-hidden="true">↓</span>
								下载文件
							</a>
					)}
				</div>
			)}
		</form>
	);
}
