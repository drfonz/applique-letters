import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import { SHAPES } from "@indigolabsltd/applique-core";
import { cn } from "@/lib/utils";
import { shapeTint } from "@/components/ShapePicker";

/**
 * The banner text box. Letters are typed as normal; shapes show as tokens that can be clicked
 * to remove them. The value stays a plain string, with each shape as its own character.
 */

const CHIP_CLASS =
  "mx-0.5 inline-flex h-8 cursor-pointer select-none items-center rounded-lg border bg-muted px-[5px] align-middle font-sans text-[19px] leading-none transition-colors hover:border-destructive/60";

/** Emoji variation selectors ride along after shapes typed on phones; the tokens replace them. */
const isSelector = (ch: string) => /[︎️]/.test(ch);

function chip(char: string): HTMLElement {
  const el = document.createElement("span");
  el.contentEditable = "false";
  el.dataset.shape = char;
  el.className = CHIP_CLASS;
  el.textContent = char;
  el.title = `Remove ${SHAPES[char].label.toLowerCase()}`;
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", el.title);
  const tint = shapeTint(char);
  if (tint) el.style.color = tint;
  return el;
}

/** Rebuild the editor's contents from a string. */
function render(el: HTMLElement, value: string) {
  const nodes: Node[] = [];
  let run = "";
  const flush = () => {
    if (run) nodes.push(document.createTextNode(run));
    run = "";
  };
  for (const ch of Array.from(value)) {
    if (SHAPES[ch]) {
      flush();
      nodes.push(chip(ch));
    } else if (!isSelector(ch)) run += ch;
  }
  flush();
  el.replaceChildren(...nodes);
}

/** Read the editor's contents back as a string. */
function serialise(node: Node): string {
  // Browsers type trailing spaces as non-breaking ones; selectors are dropped in favour of tokens.
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? "").replace(/\u00a0/g, " ").replace(/[\uFE0E\uFE0F]/g, "");
  }
  if (node instanceof HTMLElement && node.dataset.shape) return node.dataset.shape;
  // Elements and document fragments (from caret measurement) are the sum of their children.
  return Array.from(node.childNodes, serialise).join("");
}

/** True when typed or pasted text contains shapes that should become tokens. */
function hasLooseShapes(el: HTMLElement): boolean {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    // The glyph inside a token is already a token.
    acceptNode: (n) => (n.parentElement?.closest("[data-shape]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (Array.from(n.textContent ?? "").some((ch) => SHAPES[ch] || isSelector(ch))) return true;
  }
  return false;
}

/** Caret position as a count of UTF-16 units in the serialised value. */
function caretOffset(el: HTMLElement): number | null {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !el.contains(sel.focusNode)) return null;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.setEnd(sel.focusNode!, sel.focusOffset);
  return serialise(range.cloneContents()).length;
}

function placeCaret(el: HTMLElement, offset: number) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  let left = offset;
  for (const child of Array.from(el.childNodes)) {
    const len = serialise(child).length;
    if (child.nodeType === Node.TEXT_NODE && left <= len) {
      range.setStart(child, left);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    if (left < len || (left === len && child.nextSibling === null)) {
      range.setStartAfter(child);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    left -= len;
  }
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

interface BannerInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
}

export function BannerInput({ value, onChange, placeholder, className, style }: BannerInputProps) {
  const ref = useRef<HTMLDivElement>(null);
  // The value this editor last reported; anything else came from outside and needs drawing.
  const shown = useRef<string | null>(null);
  const composing = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || value === shown.current) return;
    render(el, value);
    shown.current = value;
  }, [value]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Keep it plain text: no bold, italics or other rich-text formatting.
    const block = (e: InputEvent) => {
      if (e.inputType.startsWith("format") || e.inputType === "insertParagraph") e.preventDefault();
    };
    el.addEventListener("beforeinput", block);
    return () => el.removeEventListener("beforeinput", block);
  }, []);

  const emit = () => {
    const el = ref.current!;
    const next = serialise(el);
    if (hasLooseShapes(el) || (next === "" && el.childNodes.length)) {
      const at = caretOffset(el);
      render(el, next);
      if (at !== null) placeCaret(el, at);
    }
    shown.current = next;
    onChange(next);
  };

  const removeChip = (target: EventTarget) => {
    const chipEl = target instanceof HTMLElement ? target.closest<HTMLElement>("[data-shape]") : null;
    if (!chipEl || !ref.current?.contains(chipEl)) return false;
    chipEl.remove();
    emit();
    return true;
  };

  return (
    <div className="relative">
      <div
        ref={ref}
        role="textbox"
        aria-label="Banner text"
        aria-multiline="false"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        onInput={() => {
          if (!composing.current) emit();
        }}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={() => {
          composing.current = false;
          emit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain").replace(/\s+/g, " ");
          document.execCommand("insertText", false, text);
        }}
        onDrop={(e) => e.preventDefault()}
        onMouseDown={(e) => {
          // Clicking a token removes it rather than moving the caret.
          if (removeChip(e.target)) e.preventDefault();
        }}
        className={cn(
          "min-h-[88px] whitespace-pre-wrap break-words rounded-[10px] border bg-background px-3.5 py-3 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30",
          className,
        )}
        style={style}
      />
      {!value && placeholder && (
        <div
          aria-hidden="true"
          className={cn("pointer-events-none absolute left-3.5 top-3 text-muted-foreground/60", className)}
          style={style}
        >
          {placeholder}
        </div>
      )}
    </div>
  );
}
