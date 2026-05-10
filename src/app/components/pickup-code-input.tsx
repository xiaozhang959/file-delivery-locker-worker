"use client";

import {
	type ClipboardEvent,
	type KeyboardEvent,
	useRef,
} from "react";
import { PICKUP_CODE_LENGTH, normalizePickupCode } from "./locker-format";

export function PickupCodeInput({ onChange, value }: { onChange: (value: string) => void; value: string }) {
	const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
	const chars = Array.from({ length: PICKUP_CODE_LENGTH }, (_, index) => value[index] ?? "");

	function focusBox(index: number) {
		window.requestAnimationFrame(() => inputRefs.current[index]?.focus());
	}

	function updateFrom(index: number, rawValue: string) {
		const nextInput = normalizePickupCode(rawValue);
		const nextChars = [...chars];

		if (!nextInput) {
			nextChars[index] = "";
			onChange(nextChars.join(""));
			return;
		}

		for (let offset = 0; offset < nextInput.length && index + offset < PICKUP_CODE_LENGTH; offset += 1) {
			nextChars[index + offset] = nextInput[offset];
		}

		onChange(nextChars.join("").slice(0, PICKUP_CODE_LENGTH));
		focusBox(Math.min(index + nextInput.length, PICKUP_CODE_LENGTH - 1));
	}

	function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
		if (event.key === "Backspace" && !chars[index] && index > 0) {
			event.preventDefault();
			const nextChars = [...chars];
			nextChars[index - 1] = "";
			onChange(nextChars.join(""));
			focusBox(index - 1);
			return;
		}

		if (event.key === "ArrowLeft" && index > 0) {
			event.preventDefault();
			focusBox(index - 1);
			return;
		}

		if (event.key === "ArrowRight" && index < PICKUP_CODE_LENGTH - 1) {
			event.preventDefault();
			focusBox(index + 1);
		}
	}

	function handlePaste(index: number, event: ClipboardEvent<HTMLInputElement>) {
		const pastedCode = normalizePickupCode(event.clipboardData.getData("text"));
		if (!pastedCode) {
			return;
		}

		event.preventDefault();
		updateFrom(index, pastedCode);
	}

	return (
		<div className="field pickup-code-field flex flex-col gap-2">
			<span id="pickup-code-label">取件码</span>
			<div aria-labelledby="pickup-code-label" className="grid grid-cols-6 gap-2" role="group">
				{chars.map((char, index) => (
					<input
						className="min-w-0 p-0 text-center"
						aria-label={`取件码第 ${index + 1} 位`}
						autoCapitalize="characters"
						autoComplete={index === 0 ? "one-time-code" : "off"}
						inputMode="text"
						key={index}
						maxLength={1}
						pattern="[A-Za-z0-9]"
						ref={(element) => {
							inputRefs.current[index] = element;
						}}
						type="text"
						value={char}
						onChange={(event) => updateFrom(index, event.target.value)}
						onKeyDown={(event) => handleKeyDown(index, event)}
						onPaste={(event) => handlePaste(index, event)}
					/>
				))}
			</div>
		</div>
	);
}
