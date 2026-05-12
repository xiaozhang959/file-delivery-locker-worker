import { cleanupPowArtifacts, getCloudflareBindings, json, redeemPickupPowChallenge, requireSiteAuth } from "@/lib/locker";

type RedeemBody = {
	token?: unknown;
	solutions?: unknown;
};

export async function POST(request: Request) {
	const unauthorized = await requireSiteAuth(request);
	if (unauthorized) {
		return unauthorized;
	}

	const { db, ctx } = await getCloudflareBindings();
	if (!db) {
		return json({ error: "Cloudflare bindings are not available." }, 500);
	}

	let body: RedeemBody;
	try {
		body = (await request.json()) as RedeemBody;
	} catch {
		return json({ success: false, error: "Invalid JSON body." }, 400);
	}

	if (typeof body.token !== "string" || !Array.isArray(body.solutions)) {
		return json({ success: false, error: "Invalid challenge response." }, 400);
	}

	const solutions = body.solutions.map((solution) => Number(solution));
	if (solutions.some((solution) => !Number.isFinite(solution))) {
		return json({ success: false, error: "Invalid challenge response." }, 400);
	}

	const result = await redeemPickupPowChallenge(body.token, solutions);
	ctx.waitUntil(cleanupPowArtifacts(db).catch((error) => console.warn(error)));

	if (!result.success) {
		return json({ success: false, error: result.message ?? "Challenge failed." }, 400);
	}

	return json({
		success: true,
		token: result.token,
		expires: result.expires,
	});
}
