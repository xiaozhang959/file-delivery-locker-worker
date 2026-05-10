export type ApiErrorShape = {
	error?: string;
};

export async function readApiJson<T extends ApiErrorShape>(response: Response, fallbackError: string): Promise<T> {
	const text = await response.text();
	if (!text.trim()) {
		return { error: fallbackError } as T;
	}

	try {
		return JSON.parse(text) as T;
	} catch {
		return { error: fallbackError } as T;
	}
}
