/// <reference lib="webworker" />
import { nest, type NestItem, type NestOptions, type NestResult, type NestShape } from "./nest";

export interface NestRequest {
  id: number;
  shapes: NestShape[];
  items: NestItem[];
  options: NestOptions;
}

export type NestResponse =
  | { id: number; type: "progress"; result: NestResult }
  | { id: number; type: "done"; result: NestResult }
  | { id: number; type: "error"; message: string };

self.onmessage = (event: MessageEvent<NestRequest>) => {
  const { id, shapes, items, options } = event.data;
  try {
    let last = 0;
    const result = nest(shapes, items, options, (best) => {
      const now = performance.now();
      if (now - last > 120) {
        last = now;
        self.postMessage({ id, type: "progress", result: best } satisfies NestResponse);
      }
    });
    self.postMessage({ id, type: "done", result } satisfies NestResponse);
  } catch (e) {
    self.postMessage({ id, type: "error", message: e instanceof Error ? e.message : String(e) } satisfies NestResponse);
  }
};
