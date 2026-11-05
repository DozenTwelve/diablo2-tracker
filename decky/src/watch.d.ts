export type Check = { files: number; ms: number; wasm?: number };
export function startWatching(): void;
export function stopWatching(): void;
export function lastCheck(): Check | null;
export function onCheck(fn: (check: Check) => void): () => void;
export const lang: string;
