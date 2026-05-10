"use client";

export function CodeBlock({
	label,
	onCopy,
	value,
	wide,
}: {
	label: string;
	onCopy: (value: string) => void;
	value: string;
	wide?: boolean;
}) {
	return (
		<div className={wide ? "code-block flex min-w-0 flex-col gap-[7px] sm:col-span-2" : "code-block flex min-w-0 flex-col gap-[7px]"}>
			<span>{label}</span>
			<button className="min-w-0" type="button" onClick={() => onCopy(value)} title={`复制${label}`}>
				{value}
			</button>
		</div>
	);
}
