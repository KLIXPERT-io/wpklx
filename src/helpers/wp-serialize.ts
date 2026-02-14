import { Window } from "happy-dom";
import type { BlockInstance } from "@wordpress/blocks";

let initialized = false;
let rawHandler: (options: { HTML: string }) => BlockInstance[];
let serializeFn: (blocks: BlockInstance[]) => string;

async function init(): Promise<void> {
  if (initialized) return;

  const window = new Window({ url: "https://localhost" });
  Object.assign(globalThis, {
    document: window.document,
    window,
    DOMParser: window.DOMParser,
    Node: window.Node,
    HTMLElement: window.HTMLElement,
    MutationObserver: window.MutationObserver,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    getComputedStyle: window.getComputedStyle.bind(window),
    navigator: window.navigator,
    CustomEvent: window.CustomEvent,
  });

  const blocks = await import("@wordpress/blocks");
  const blockLibrary = await import("@wordpress/block-library");

  rawHandler = blocks.rawHandler;
  serializeFn = blocks.serialize;
  blockLibrary.registerCoreBlocks();

  initialized = true;
}

/**
 * Convert raw HTML into WordPress Gutenberg block HTML.
 */
export async function serializeToBlocks(html: string): Promise<string> {
  await init();
  const blocks = rawHandler({ HTML: html });
  return serializeFn(blocks);
}
