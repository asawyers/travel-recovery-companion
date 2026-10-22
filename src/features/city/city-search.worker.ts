import type { City } from "@domain/city-types";
type SearchMessage = { sequence: number; query: string };
const worker = self as unknown as {
  onmessage: ((event: MessageEvent<SearchMessage>) => void) | null;
  postMessage: (value: {
    sequence: number;
    cities?: City[];
    error?: string;
  }) => void;
};
let catalog: Promise<typeof import("@domain/city-catalog")> | null = null;
worker.onmessage = async ({ data }) => {
  try {
    catalog ??= import("@domain/city-catalog");
    const module = await catalog;
    worker.postMessage({
      sequence: data.sequence,
      cities: module.searchCities(data.query, 8),
    });
  } catch {
    catalog = null;
    worker.postMessage({
      sequence: data.sequence,
      error: "City search is unavailable. Retry your search.",
    });
  }
};
