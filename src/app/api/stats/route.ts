import { getCloudflareBindings, json, requireSiteAuth } from "@/lib/locker";

type StatsRow = {
	uploadCount: number;
	downloadCount: number;
};

export async function GET(request: Request) {
	const unauthorized = await requireSiteAuth(request);
	if (unauthorized) {
		return unauthorized;
	}

	const { db } = await getCloudflareBindings();
	if (!db) {
		return json({ error: "Cloudflare bindings are not available." }, 500);
	}

	let stats: StatsRow | null = null;
	try {
		stats = await db
			.prepare(
				`SELECT
					COUNT(*) AS uploadCount,
					COALESCE(SUM(download_count), 0) AS downloadCount
				FROM file_deliveries`,
			)
			.first<StatsRow>();
	} catch (error) {
		console.error(
			JSON.stringify({
				event: "stats_read_failed",
				error: error instanceof Error ? error.message : "unknown",
			}),
		);
		return json({ error: "Unable to read site stats." }, 500);
	}

	return json({
		uploadCount: Number(stats?.uploadCount ?? 0),
		downloadCount: Number(stats?.downloadCount ?? 0),
	});
}
