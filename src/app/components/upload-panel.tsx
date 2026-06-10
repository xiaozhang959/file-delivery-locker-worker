"use client";

import { useState } from "react";
import type { DragEvent, FormEvent } from "react";
import { useI18n } from "../i18n";
import { CodeBlock } from "./code-block";
import { PICKUP_CODE_LENGTH } from "./locker-format";
import type { DeliveryKind, UploadResult } from "./locker-types";

const expiryOptions = [
	{ labelKey: "common.forever", value: 0 },
	{ labelKey: "upload.expiry1Hour", value: 1 },
	{ labelKey: "upload.expiry24Hours", value: 24 },
	{ labelKey: "upload.expiry7Days", value: 168 },
] as const;

type UploadPanelProps = {
	busy: boolean;
	demoMode: boolean;
	deliveryMode: DeliveryKind;
	expiresInHours: number;
	maxDownloadsInput: string;
	maxDownloadsUnlimited: boolean;
	guestAccessEnabled: boolean;
	customPickupCode: string;
	selectedFileName: string | null;
	textContent: string;
	uploadBadge: string;
	uploadResult: UploadResult | null;
	onCopy: (value: string) => void;
	onCustomPickupCodeChange: (value: string) => void;
	onDeliveryModeChange: (mode: DeliveryKind) => void;
	onExpiresInHoursChange: (value: number) => void;
	onFileChange: (file: File | null) => void;
	onMaxDownloadsInputChange: (value: string) => void;
	onMaxDownloadsUnlimitedChange: (value: boolean) => void;
	onGuestAccessEnabledChange: (value: boolean) => void;
	onSubmit: (event: FormEvent<HTMLFormElement>) => void;
	onTextContentChange: (value: string) => void;
	onTextFileChange: (file: File | null) => void;
};

export function UploadPanel({
	busy,
	demoMode,
	deliveryMode,
	expiresInHours,
	maxDownloadsInput,
	maxDownloadsUnlimited,
	guestAccessEnabled,
	customPickupCode,
	selectedFileName,
	textContent,
	uploadBadge,
	uploadResult,
	onCopy,
	onCustomPickupCodeChange,
	onDeliveryModeChange,
	onExpiresInHoursChange,
	onFileChange,
	onMaxDownloadsInputChange,
	onMaxDownloadsUnlimitedChange,
	onGuestAccessEnabledChange,
	onSubmit,
	onTextContentChange,
	onTextFileChange,
}: UploadPanelProps) {
	const { t } = useI18n();
	const [isDragActive, setIsDragActive] = useState(false);

	function hasDroppableData(event: DragEvent<HTMLElement>) {
		if (demoMode) {
			return false;
		}

		return (
			event.dataTransfer.types.includes("Files") ||
			(deliveryMode === "text" && event.dataTransfer.types.includes("text/plain"))
		);
	}

	function handlePanelDragOver(event: DragEvent<HTMLFormElement>) {
		if (!hasDroppableData(event)) {
			return;
		}

		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
		setIsDragActive(true);
	}

	function handlePanelDragLeave(event: DragEvent<HTMLFormElement>) {
		if (event.currentTarget === event.target || !event.currentTarget.contains(event.relatedTarget as Node | null)) {
			setIsDragActive(false);
		}
	}

	function handlePanelDrop(event: DragEvent<HTMLFormElement>) {
		if (!hasDroppableData(event)) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		setIsDragActive(false);

		const droppedFile = event.dataTransfer.files.item(0);
		if (droppedFile) {
			if (deliveryMode === "text") {
				onTextFileChange(droppedFile);
				return;
			}

			onFileChange(droppedFile);
			return;
		}

		const droppedText = event.dataTransfer.getData("text/plain");
		if (deliveryMode === "text" && droppedText) {
			onTextContentChange(droppedText);
		}
	}

	return (
		<form
			className={`panel panel-feature flex flex-col gap-6 ${isDragActive ? "is-drag-active" : ""}`}
			onDragLeave={handlePanelDragLeave}
			onDragOver={handlePanelDragOver}
			onDrop={handlePanelDrop}
			onSubmit={onSubmit}
		>
			<div className="flex items-center justify-between gap-4">
				<div>
					<h2>{t("upload.title")}</h2>
					<p className="panel-copy">
						{demoMode
							? t("upload.demoCopy")
							: deliveryMode === "text"
								? t("upload.textCopy")
								: selectedFileName ?? t("upload.fileCopy")}
					</p>
				</div>
				<span className="badge-coral inline-flex w-fit items-center">{uploadBadge}</span>
			</div>

			<div className="w-full">
				<div className="mode-switch-row inline-flex min-h-11 w-fit items-center justify-center self-center">
					<span className={deliveryMode === "file" ? "active" : undefined}>{t("upload.modeFile")}</span>
					<button
						type="button"
						className="mode-switch inline-flex h-7 w-[54px] items-center p-0 mx-2"
						role="switch"
						aria-checked={deliveryMode === "text"}
						aria-label={t("upload.switchKind")}
						disabled={demoMode}
						onClick={() => onDeliveryModeChange(deliveryMode === "text" ? "file" : "text")}
					>
						<span className="switch-track relative block h-7 w-[54px] rounded-full" aria-hidden="true">
							<span className="switch-thumb absolute top-1 left-1 h-5 w-5 rounded-full" />
						</span>
					</button>
					<span className={deliveryMode === "text" ? "active" : undefined}>{t("upload.modeText")}</span>
				</div>
			</div>

			{deliveryMode === "text" ? (
				<div className={`text-dropzone field flex flex-col gap-3 ${isDragActive ? "is-drag-active" : ""}`}>
					<textarea
						className="h-[230px] w-full resize-none"
						disabled={demoMode}
						value={textContent}
						onChange={(event) => onTextContentChange(event.target.value)}
						placeholder={t("upload.textPlaceholder")}
					/>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<span className="text-dropzone-hint">{t("upload.dropTextFile")}</span>
						<label className="secondary-button inline-flex min-h-9 cursor-pointer items-center justify-center rounded-lg px-4 text-sm font-medium">
							<input
								accept=".txt,.md,.csv,.json,.log,.xml,.yml,.yaml,text/*,application/json"
								className="sr-only"
								disabled={demoMode}
								type="file"
								onChange={(event) => {
									onTextFileChange(event.target.files?.[0] ?? null);
									event.currentTarget.value = "";
								}}
							/>
							{t("upload.chooseTextFile")}
						</label>
					</div>
				</div>
			) : (
				<label className={`dropzone flex min-h-[230px] flex-col items-center justify-center gap-2.5 ${demoMode ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}>
					<input
						className="sr-only"
						disabled={demoMode}
						type="file"
						onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
					/>
					<span className="text-4xl">+</span>
					<span className="font-medium">{demoMode ? t("upload.demoNoUpload") : t("upload.chooseFile")}</span>
				</label>
			)}

			<div className="grid gap-4 sm:grid-cols-2">
				<label className="field flex flex-col gap-2 sm:col-span-2">
					<span>{t("upload.customPickupCode")}</span>
					<input
						autoComplete="off"
						className="h-[42px] w-full"
						disabled={demoMode}
						inputMode="text"
						maxLength={PICKUP_CODE_LENGTH}
						placeholder={t("upload.customPickupCodePlaceholder")}
						spellCheck={false}
						type="text"
						value={customPickupCode}
						onChange={(event) => onCustomPickupCodeChange(event.target.value)}
					/>
					<small>{t("upload.customPickupCodeHint")}</small>
				</label>
				<label className="field flex flex-col gap-2">
					<span>{t("upload.expiry")}</span>
					<select
						className="h-[42px] w-full"
						disabled={demoMode}
						value={expiresInHours}
						onChange={(event) => onExpiresInHoursChange(Number(event.target.value))}
					>
						{expiryOptions.map((option) => (
							<option key={option.value} value={option.value}>
								{t(option.labelKey)}
							</option>
						))}
					</select>
				</label>
				<label className="field flex flex-col gap-2">
					<span>{t("upload.downloadLimit")}</span>
					<div className="flex min-h-[42px] items-center gap-3">
						<input
							className="h-[42px] min-w-0 flex-1"
							disabled={demoMode || maxDownloadsUnlimited}
							type="number"
							value={maxDownloadsInput}
							onChange={(event) => onMaxDownloadsInputChange(event.target.value)}
						/>
						<label className="inline-flex h-[42px] flex-none items-center gap-2 text-sm">
							<input
								checked={maxDownloadsUnlimited}
								disabled={demoMode}
								type="checkbox"
								onChange={(event) => onMaxDownloadsUnlimitedChange(event.target.checked)}
							/>
							<span>{t("upload.unlimitedTimes")}</span>
						</label>
					</div>
				</label>
			</div>

			<label className="field inline-flex min-h-[42px] items-start gap-3">
				<input
					checked={guestAccessEnabled}
					className="mt-1"
					disabled={demoMode}
					type="checkbox"
					onChange={(event) => onGuestAccessEnabledChange(event.target.checked)}
				/>
				<span className="flex flex-col gap-1">
					<span>{t("upload.guestAccess")}</span>
					<small>{t("upload.guestAccessHint")}</small>
				</span>
			</label>

			<button
				className="primary-button inline-flex min-h-10 items-center justify-center gap-[9px] rounded-lg px-5 text-sm leading-none font-medium no-underline"
				disabled={busy || demoMode}
				type="submit"
			>
				<span aria-hidden="true">↑</span>
				{demoMode ? t("upload.demoReadonly") : busy ? t("upload.uploading") : t("upload.submit")}
			</button>

			{uploadResult && (
				<div className="grid grid-cols-1 gap-3 border-t border-[rgba(20,20,19,0.08)] pt-[18px] sm:grid-cols-2">
					<CodeBlock label={t("upload.pickupCode")} value={uploadResult.pickupCode} onCopy={onCopy} />
					<CodeBlock label={t("upload.manageCode")} value={uploadResult.manageCode} onCopy={onCopy} />
					<CodeBlock label={t("upload.pickupUrl")} value={uploadResult.pickupUrl} onCopy={onCopy} wide />
					{uploadResult.guestDownloadUrl && (
						<CodeBlock label={t("upload.guestDownloadUrl")} value={uploadResult.guestDownloadUrl} onCopy={onCopy} wide />
					)}
				</div>
			)}
		</form>
	);
}
