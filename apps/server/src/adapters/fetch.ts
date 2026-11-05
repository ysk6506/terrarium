/** The `fetch` the adapters use; tests hand in a fake, so no test reaches a real server. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
