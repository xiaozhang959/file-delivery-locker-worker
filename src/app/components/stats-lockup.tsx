import { formatCount } from "./locker-format";
import type { SiteStats } from "./locker-types";
import { useI18n } from "../i18n";

export function StatsLockup({ stats }: { stats: SiteStats | null }) {
	const { t } = useI18n();

	return (
		<div className="stats-lockup" aria-label={t("site.description")}>
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
