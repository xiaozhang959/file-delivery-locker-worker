export function Mini({ label, value }: { label: string; value: string }) {
	return (
		<div className="mini-card rounded-lg px-3 py-2.5">
			<p>{label}</p>
			<strong className="mt-1 block">{value}</strong>
		</div>
	);
}
