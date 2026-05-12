export type DeliveryKind = "file" | "text";

export type UploadResult = {
	id: string;
	pickupCode: string;
	manageCode: string;
	fileName: string;
	kind: DeliveryKind;
	size: number;
	maxDownloads: number;
	expiresAt: string;
	pickupUrl: string;
	downloadUrl: string;
};

export type Delivery = {
	id: string;
	fileName: string;
	contentType: string;
	kind: DeliveryKind;
	size: number;
	maxDownloads: number;
	downloadCount: number;
	remainingDownloads: number;
	expiresAt: string;
	createdAt: string;
	status: "available" | "expired" | "deleted" | "depleted";
};

export type DeliveryLookupResult = {
	delivery: Delivery;
	pickupAccessToken: string;
	pickupAccessExpiresAt: string;
};

export type ApiError = {
	error?: string;
};

export type TextPreview = {
	text: string;
	remainingDownloads: number;
};

export type SiteStats = {
	uploadCount: number;
	downloadCount: number;
};
