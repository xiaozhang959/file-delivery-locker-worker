import {
	MAX_FILE_SIZE,
	MAX_TEXT_SIZE,
	contentDisposition,
	createCode,
	getCloudflareBindings,
	getContentType,
	getSafeFileName,
	hashCode,
	json,
	parseDeliveryKind,
	parseContentLength,
	parseExpiryHours,
	parseMaxDownloads,
	requireSiteAuth,
} from "@/lib/locker";

export async function POST(request: Request) {
	const unauthorized = await requireSiteAuth(request);
	if (unauthorized) {
		return unauthorized;
	}

	const { db, bucket } = await getCloudflareBindings();
	if (!db || !bucket) {
		return json({ error: "Cloudflare bindings are not available." }, 500);
	}

	const fileName = getSafeFileName(request);
	if (!fileName) {
		return json({ error: "Missing x-file-name header." }, 400);
	}

	const size = parseContentLength(request);
	if (size === null) {
		return json({ error: "Missing or invalid content-length header." }, 411);
	}

	const deliveryKind = parseDeliveryKind(request);
	if (deliveryKind === null) {
		return json({ error: "Invalid x-delivery-kind header." }, 400);
	}

	const maxSize = deliveryKind === "text" ? MAX_TEXT_SIZE : MAX_FILE_SIZE;
	if (size > maxSize) {
		if (deliveryKind === "text") {
			return json({ error: "Text is larger than 256 KB." }, 413);
		}

		return json({ error: "File is larger than 100 MB." }, 413);
	}

	if (!request.body) {
		return json({ error: "Missing file body." }, 400);
	}

	const expiryHours = parseExpiryHours(request);
	if (expiryHours === null) {
		return json({ error: "Invalid x-expires-in-hours header." }, 400);
	}

	const maxDownloads = parseMaxDownloads(request);
	if (maxDownloads === null) {
		return json({ error: "Invalid x-max-downloads header." }, 400);
	}

	const id = crypto.randomUUID();
	const createdAt = Date.now();
	const expiresAt = createdAt + expiryHours * 60 * 60 * 1000;
	const objectKey = `deliveries/${createdAt}/${id}`;
	const pickupCode = createCode(6);
	const manageCode = createCode(16);
	const contentType = deliveryKind === "text" ? "text/plain;charset=utf-8" : getContentType(request);
	let pipePromise: Promise<void> | undefined;

	try {
		const fixedLengthStream = new FixedLengthStream(size);
		pipePromise = request.body.pipeTo(fixedLengthStream.writable);

		await bucket.put(objectKey, fixedLengthStream.readable, {
			httpMetadata: {
				contentDisposition: contentDisposition(fileName),
				contentType,
			},
			customMetadata: {
				deliveryId: id,
				fileName,
			},
		});
		await pipePromise;

		await db
			.prepare(
				`INSERT INTO file_deliveries (
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
					created_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
			)
			.bind(
				id,
				objectKey,
				fileName,
				contentType,
				deliveryKind,
				size,
				await hashCode(pickupCode),
				await hashCode(manageCode),
				maxDownloads,
				expiresAt,
				createdAt,
			)
			.run();
	} catch (error) {
		await pipePromise?.catch(() => undefined);
		await bucket.delete(objectKey).catch(() => undefined);
		console.error(
			JSON.stringify({
				event: "delivery_create_failed",
				id,
				error: error instanceof Error ? error.message : "unknown",
			}),
		);
		return json({ error: "Unable to store this file." }, 500);
	}

	const origin = new URL(request.url).origin;
	const encodedPickupCode = encodeURIComponent(pickupCode);
	const pickupUrl =
		deliveryKind === "text"
			? `${origin}/?pickupCode=${encodedPickupCode}`
			: `${origin}/api/deliveries/${encodedPickupCode}/download`;

	return json(
		{
			id,
			pickupCode,
			manageCode,
			fileName,
			kind: deliveryKind,
			size,
			maxDownloads,
			expiresAt: new Date(expiresAt).toISOString(),
			pickupUrl,
			downloadUrl: pickupUrl,
		},
		201,
	);
}
