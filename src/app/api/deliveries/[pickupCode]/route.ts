import {
	cleanupPowArtifacts,
	clearPickupPowFailure,
	createPickupAccessToken,
	type DeliveryRow,
	getCloudflareBindings,
	hashCode,
	isValidPickupCode,
	json,
	normalizePickupCode,
	recordPickupPowFailure,
	requireSiteAuth,
	serializeDelivery,
	validatePickupPowToken,
} from "@/lib/locker";

export async function GET(request: Request, context: { params: Promise<{ pickupCode: string }> }) {
	const unauthorized = await requireSiteAuth(request);
	if (unauthorized) {
		return unauthorized;
	}

	const { db, ctx } = await getCloudflareBindings();
	if (!db) {
		return json({ error: "Cloudflare bindings are not available." }, 500);
	}

	const powTokenStatus = await validatePickupPowToken(request.headers.get("x-cap-token"));
	if (powTokenStatus === "missing") {
		return json({ error: "Please complete the proof-of-work challenge." }, 428);
	}

	if (powTokenStatus === "invalid") {
		return json({ error: "Proof-of-work challenge is invalid or expired." }, 403);
	}

	const { pickupCode } = await context.params;
	const normalizedPickupCode = normalizePickupCode(pickupCode);
	const now = Date.now();
	if (!isValidPickupCode(pickupCode)) {
		await recordPickupPowFailure(db, request, now);
		return json({ error: "Invalid pickup code." }, 400);
	}

	const pickupCodeHash = await hashCode(normalizedPickupCode);
	const row = await db
		.prepare(
			`SELECT
				id,
				object_key,
				file_name,
				content_type,
				delivery_kind,
				size,
				pickup_code_hash,
				manage_code_hash,
				max_downloads,
				download_count,
				expires_at,
				created_at,
				deleted_at,
				deleted_reason
			FROM file_deliveries
			WHERE pickup_code_hash = ?`,
		)
		.bind(pickupCodeHash)
		.first<DeliveryRow>();

	if (!row) {
		await recordPickupPowFailure(db, request, now);
		return json({ error: "Delivery not found." }, 404);
	}

	await clearPickupPowFailure(db, request);
	const pickupAccess = await createPickupAccessToken(db, pickupCodeHash, now);
	ctx.waitUntil(cleanupPowArtifacts(db, now).catch((error) => console.warn(error)));

	return json({
		delivery: serializeDelivery(row, now),
		pickupAccessToken: pickupAccess.token,
		pickupAccessExpiresAt: pickupAccess.expiresAt,
	});
}
