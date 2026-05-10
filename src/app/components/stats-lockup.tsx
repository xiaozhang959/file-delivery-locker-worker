import { formatCount } from "./locker-format";
import type { SiteStats } from "./locker-types";

export function StatsLockup({ stats }: { stats: SiteStats | null }) {
	return (
		<div className="stats-lockup" aria-label="站点统计">
			<StatCounter label="UPLOAD" value={stats?.uploadCount} />
			<StatCounter label="DOWNLOAD" value={stats?.downloadCount} />
		</div>
	);
}

function StatCounter({ label, value }: { label: string; value?: number }) {
	return (
		<div className="stat-counter">
			<span>{label}</span>
			<strong>{typeof value === "number" ? formatCount(value) : "0"}</strong>
		</div>
	);
}
