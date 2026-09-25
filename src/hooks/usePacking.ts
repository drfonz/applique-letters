import { useEffect, useRef, useState } from "react";
import type { NestItem, NestOptions, NestResult } from "@/lib/nest";
import type { NestRequest, NestResponse } from "@/lib/nest.worker";
import type { LetterTemplate } from "@/lib/templates";

export interface PackingState {
  result: NestResult | null;
  /** The templates the result refers to (the input may have moved on while optimising). */
  templates: LetterTemplate[];
  running: boolean;
  error: string | null;
}

/**
 * Runs the plate optimiser in a Web Worker so the page stays responsive. A new request
 * terminates any search still in progress; intermediate best results stream in as it runs.
 */
export function usePacking(templates: LetterTemplate[], items: NestItem[], options: NestOptions, delay = 250): PackingState {
  const [state, setState] = useState<PackingState>({ result: null, templates: [], running: false, error: null });
  const workerRef = useRef<Worker | null>(null);
  const idRef = useRef(0);
  const key = JSON.stringify({ options, items, t: templates.map((t) => [t.char, t.width, t.height, t.area]) });

  useEffect(() => {
    if (items.length === 0) {
      workerRef.current?.terminate();
      workerRef.current = null;
      setState({ result: null, templates, running: false, error: null });
      return;
    }
    setState((s) => ({ ...s, running: true, error: null }));
    const timer = setTimeout(() => {
      workerRef.current?.terminate();
      const worker = new Worker(new URL("../lib/nest.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      const id = ++idRef.current;
      worker.onmessage = (e: MessageEvent<NestResponse>) => {
        const msg = e.data;
        if (msg.id !== idRef.current) return;
        if (msg.type === "error") setState((s) => ({ ...s, running: false, error: msg.message }));
        else setState({ result: msg.result, templates, running: msg.type === "progress", error: null });
        if (msg.type !== "progress") {
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
        }
      };
      worker.onerror = (e) => setState((s) => ({ ...s, running: false, error: e.message || "The optimiser crashed" }));
      const request: NestRequest = {
        id,
        shapes: templates.map((t) => ({ regions: t.regions })),
        items,
        options,
      };
      worker.postMessage(request);
    }, delay);
    return () => clearTimeout(timer);
  }, [key]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  return state;
}
