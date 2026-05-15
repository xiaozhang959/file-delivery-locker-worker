import {
	MAX_FILE_SIZE,
	MAX_TEXT_SIZE,
	contentDisposition,
	createCode,
	createUniquePickupCode,
	deleteStoredObjectIfUnreferenced,
	findReusableStoredObject,
	getCloudflareBindings,
	getContentType,
	getRequestSource,
	getSafeFileName,
	hashContentBytes,
	hashManageCode,
	json,
	parseDeliveryKind,
	parseContentLength,
	parseExpiryHours,
	parseMaxDownloads,
	recordDeliveryEvent,
	requireCsrf,
	requireWritableMode,
	requireSiteAuth,
} from "@/lib/locker";

export async function POST(request: Request) {
	const readonly = await requireWritableMode();
	if (readonly) {
		return readonly;
	}

	const unauthorized = await requireSiteAuth(request);
	if (unauthorized) {
		return unauthorized;
	}

	const csrf = await requireCsrf(request, "site");
	if (csrf) {
		return csrf;
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
	const expiresAt = expiryHours === 0 ? 0 : createdAt + expiryHours * 60 * 60 * 1000;
	const objectKey = `deliveries/${createdAt}/${id}`;
	const pickup = await createUniquePickupCode(db);
	const manageCode = createCode(16);
	const contentType = deliveryKind === "text" ? "text/plain;charset=utf-8" : getContentType(request);
	const source = getRequestSource(request);
	let uploadedStorageKey: string | null = null;

	try {
		const body = await request.arrayBuffer();
		if (body.byteLength !== size) {
			return json({ error: "Request body length does not match content-length." }, 400);
		}

		const contentHash = await hashContentBytes(body);
		const reusableStorageKey = await findReusableStoredObject(db, bucket, contentHash, size, createdAt);
		const storageKey = reusableStorageKey ?? objectKey;

		if (!reusableStorageKey) {
			await bucket.put(storageKey, body, {
				httpMetadata: {
					contentDisposition: contentDisposition(fileName),
					contentType,
				},
				customMetadata: {
					contentHash,
					deliveryId: id,
					fileName,
				},
			});
			uploadedStorageKey = storageKey;
		}

		await db
			.prepare(
				`INSERT INTO file_deliveries (
					id,
					object_key,
					storage_key,
					file_name,
					content_type,
					delivery_kind,
					size,
					content_hash,
					pickup_code_hash,
					manage_code_hash,
					max_downloads,
					download_count,
					expires_at,
					created_at,
					upload_ip,
					upload_user_agent,
					upload_browser,
					upload_os,
					upload_device,
					upload_country,
					upload_region,
					upload_city
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				id,
				objectKey,
				storageKey,
				fileName,
				contentType,
				deliveryKind,
				size,
				contentHash,
				pickup.hash,
				await hashManageCode(manageCode),
				maxDownloads,
				expiresAt,
				createdAt,
				source.ip,
				source.userAgent,
				source.browser,
				source.os,
				source.device,
				source.country,
				source.region,
				source.city,
			)
			.run();
		await recordDeliveryEvent(db, {
			deliveryId: id,
			action: "upload",
			actor: "user",
			source,
			nextMaxDownloads: maxDownloads,
			nextDownloadCount: 0,
			createdAt,
		});
	} catch (error) {
		if (uploadedStorageKey) {
			await deleteStoredObjectIfUnreferenced(db, bucket, uploadedStorageKey).catch(() => undefined);
		}
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
	const encodedPickupCode = encodeURIComponent(pickup.code);
	const pickupUrl = `${origin}/?pickupCode=${encodedPickupCode}`;

	return json(
		{
			id,
			pickupCode: pickup.code,
			manageCode,
			fileName,
			kind: deliveryKind,
			size,
			maxDownloads,
			expiresAt: expiresAt === 0 ? null : new Date(expiresAt).toISOString(),
			pickupUrl,
			downloadUrl: pickupUrl,
		},
		201,
	);
}
