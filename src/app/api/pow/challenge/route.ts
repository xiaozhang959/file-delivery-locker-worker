import { cleanupPowArtifacts, createPickupPowChallenge, getCloudflareBindings, json, requireSiteAuth } from "@/lib/locker";

export async function POST(request: Request) {
	const unauthorized = await requireSiteAuth(request);
	if (unauthorized) {
		return unauthorized;
	}

	const { db, ctx } = await getCloudflareBindings();
	if (!db) {
		return json({ error: "Cloudflare bindings are not available." }, 500);
	}

	const { challenge, token, expires, difficulty } = await createPickupPowChallenge(db, request);
	ctx.waitUntil(cleanupPowArtifacts(db).catch((error) => console.warn(error)));

	return json({
		challenge,
		token,
		expires,
		difficulty: {
			failureCount: difficulty.failureCount,
			challengeCount: difficulty.challengeCount,
			challengeSize: difficulty.challengeSize,
			challengeDifficulty: difficulty.challengeDifficulty,
		},
	});
}
