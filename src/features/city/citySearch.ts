import type { City } from "@domain/city-types";
let worker: Worker | null = null,
  sequence = 0;
const pending = new Map<
  number,
  { resolve: (value: City[]) => void; reject: (error: Error) => void }
>();
/** The national catalog parses and scans off the main thread, only after a search. */
export function searchCityCatalog(query: string): Promise<City[]> {
  if (!worker) {
    worker = new Worker(new URL("./city-search.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({
      data,
    }: {
      data: { sequence: number; cities?: City[]; error?: string };
    }) => {
      const task = pending.get(data.sequence);
      if (!task) return;
      pending.delete(data.sequence);
      if (data.error) task.reject(new Error(data.error));
      else task.resolve(data.cities ?? []);
    };
    worker.onerror = () => {
      pending.forEach((task) =>
        task.reject(
          new Error("City search is unavailable. Retry your search."),
        ),
      );
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ sequence: id, query });
  });
}
