"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  Bold,
  Italic,
  Heading,
  List,
  Link2,
  Image as ImageIcon,
  MousePointerClick,
  User,
  Loader2,
  Baseline,
} from "lucide-react";
import { MERGE_FIELDS, wrapEmailHtml } from "@/lib/email-template";
import { uploadOutreachImage } from "@/app/actions/outreach";

/** Renders email HTML in an isolated iframe so it looks like the real inbox. */
export function EmailPreview({ innerHtml }: { innerHtml: string }) {
  return (
    <iframe
      title="Email preview"
      sandbox=""
      className="h-[520px] w-full rounded-lg border border-[#d8e4e4] bg-white"
      srcDoc={wrapEmailHtml(innerHtml || "<p style='color:#8aa0a0'>Nothing to preview yet.</p>")}
    />
  );
}

const CHIP_STYLE =
  "display:inline-block;padding:1px 8px;margin:0 1px;border-radius:9999px;background:#e0f7f8;color:#0e7d82;font-weight:600;font-size:0.9em;";

const BUTTON_STYLE =
  "display:inline-block;background:#7de8eb;color:#0e1b1b;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:10px;";

/** Text-colour swatches offered in the toolbar (email-safe, on-brand). */
const TEXT_COLORS: { label: string; value: string }[] = [
  { label: "Default", value: "#1a2b2b" },
  { label: "Teal", value: "#0e7d82" },
  { label: "Slate", value: "#5a7272" },
  { label: "Blue", value: "#1d4ed8" },
  { label: "Green", value: "#059669" },
  { label: "Red", value: "#dc2626" },
  { label: "Black", value: "#000000" },
];

export type RichEmailEditorHandle = {
  getHtml: () => string;
};

/**
 * Lightweight WYSIWYG editor for outreach emails. Dependency-free
 * (contentEditable + execCommand) — enough for formatting, images, CTA
 * buttons and personalisation pills, without pulling in a heavy editor.
 *
 * Uncontrolled: seeded once from `initialHtml`; the parent remounts it via a
 * React `key` to load a different template. Every edit is pushed up through
 * `onChange` so the parent can preview/save/send. Call `getHtml()` via ref
 * before save/send to capture the latest contentEditable value.
 */
export const RichEmailEditor = forwardRef<
  RichEmailEditorHandle,
  {
    initialHtml: string;
    onChange: (html: string) => void;
    onError?: (message: string) => void;
  }
>(function RichEmailEditor({ initialHtml, onChange, onError }, ref) {
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [menu, setMenu] = useState<"none" | "merge" | "image" | "color">("none");

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== initialHtml) {
      editorRef.current.innerHTML = initialHtml;
    }
    // Seed once on mount; parent remounts (via key) to change templates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = useCallback(() => {
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  }, [onChange]);

  useImperativeHandle(
    ref,
    () => ({
      getHtml: () => editorRef.current?.innerHTML ?? "",
    }),
    [],
  );

  const saveSelection = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  }, []);

  const restoreSelection = useCallback(() => {
    editorRef.current?.focus();
    const sel = window.getSelection();
    if (sel && savedRange.current) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
  }, []);

  const exec = useCallback(
    (command: string, value?: string) => {
      restoreSelection();
      document.execCommand(command, false, value);
      emit();
    },
    [restoreSelection, emit],
  );

  const insertHtml = useCallback(
    (html: string) => {
      restoreSelection();
      document.execCommand("insertHTML", false, html);
      emit();
    },
    [restoreSelection, emit],
  );

  const toggleHeading = useCallback(() => {
    restoreSelection();
    // formatBlock toggles the block tag; go H2 <-> P.
    const anchor = window.getSelection()?.anchorNode as HTMLElement | null;
    const inHeading = anchor?.parentElement?.closest("h2");
    document.execCommand("formatBlock", false, inHeading ? "p" : "h2");
    emit();
  }, [restoreSelection, emit]);

  const insertLink = useCallback(() => {
    const url = window.prompt("Link URL (https://…)");
    if (!url) return;
    exec("createLink", url.trim());
  }, [exec]);

  const insertButton = useCallback(() => {
    const label = window.prompt("Button text", "Book a demo");
    if (!label) return;
    const url = window.prompt("Button link (https://…)", "https://wisecall.io");
    if (!url) return;
    insertHtml(
      `<div style="margin:20px 0;"><a href="${url.trim()}" style="${BUTTON_STYLE}">${label.trim()}</a></div><p><br/></p>`,
    );
  }, [insertHtml]);

  const insertMerge = useCallback(
    (token: string, label: string) => {
      insertHtml(`<span data-merge="${token}" contenteditable="false" style="${CHIP_STYLE}">${label}</span>&nbsp;`);
      setMenu("none");
    },
    [insertHtml],
  );

  const applyColor = useCallback(
    (color: string) => {
      // Emit <span style="color:…"> (email-safe) rather than deprecated <font>.
      restoreSelection();
      document.execCommand("styleWithCSS", false, "true");
      document.execCommand("foreColor", false, color);
      emit();
      setMenu("none");
    },
    [restoreSelection, emit],
  );

  const insertImageUrl = useCallback(() => {
    const url = window.prompt("Image URL (https://…)");
    setMenu("none");
    if (!url) return;
    insertHtml(
      `<img src="${url.trim()}" alt="" style="max-width:100%;height:auto;border-radius:10px;display:block;margin:12px 0;" /><p><br/></p>`,
    );
  }, [insertHtml]);

  const onPickFile = useCallback(
    async (file: File) => {
      setMenu("none");
      setUploading(true);
      const fd = new FormData();
      fd.append("file", file);
      const res = await uploadOutreachImage(fd);
      setUploading(false);
      if (!res.ok) {
        onError?.(res.error);
        return;
      }
      insertHtml(
        `<img src="${res.data.url}" alt="" style="max-width:100%;height:auto;border-radius:10px;display:block;margin:12px 0;" /><p><br/></p>`,
      );
    },
    [insertHtml, onError],
  );

  const toolBtn =
    "inline-flex h-8 w-8 items-center justify-center rounded-md text-[#0e1b1b] hover:bg-[#e8efef]";

  return (
    <div className="rounded-lg border border-[#d8e4e4] bg-white">
      <div className="flex flex-wrap items-center gap-1 border-b border-[#e8efef] px-2 py-1.5">
        <button type="button" title="Bold" className={toolBtn} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("bold")}>
          <Bold className="h-4 w-4" />
        </button>
        <button type="button" title="Italic" className={toolBtn} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("italic")}>
          <Italic className="h-4 w-4" />
        </button>
        <button type="button" title="Heading" className={toolBtn} onMouseDown={(e) => e.preventDefault()} onClick={toggleHeading}>
          <Heading className="h-4 w-4" />
        </button>
        <button type="button" title="Bulleted list" className={toolBtn} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("insertUnorderedList")}>
          <List className="h-4 w-4" />
        </button>
        <button type="button" title="Link" className={toolBtn} onMouseDown={(e) => e.preventDefault()} onClick={insertLink}>
          <Link2 className="h-4 w-4" />
        </button>
        <div className="relative">
          <button
            type="button"
            title="Text colour"
            className={toolBtn}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setMenu(menu === "color" ? "none" : "color")}
          >
            <Baseline className="h-4 w-4" />
          </button>
          {menu === "color" && (
            <div className="absolute z-20 mt-1 w-44 rounded-lg border border-[#d8e4e4] bg-white p-2 shadow-lg">
              <div className="grid grid-cols-4 gap-1.5">
                {TEXT_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    title={c.label}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyColor(c.value)}
                    className="h-7 w-7 rounded-md border border-[#d8e4e4]"
                    style={{ background: c.value }}
                  />
                ))}
              </div>
              <label className="mt-2 flex items-center gap-2 text-xs font-semibold text-[#0e1b1b]">
                <input
                  type="color"
                  className="h-6 w-6 cursor-pointer rounded border border-[#d8e4e4] bg-white p-0"
                  onMouseDown={(e) => e.preventDefault()}
                  onChange={(e) => applyColor(e.target.value)}
                />
                Custom…
              </label>
            </div>
          )}
        </div>
        <span className="mx-1 h-5 w-px bg-[#e8efef]" />
        <div className="relative">
          <button
            type="button"
            title="Insert image"
            className={toolBtn}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setMenu(menu === "image" ? "none" : "image")}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
          </button>
          {menu === "image" && (
            <div className="absolute z-20 mt-1 w-44 rounded-lg border border-[#d8e4e4] bg-white p-1 shadow-lg">
              <button
                type="button"
                className="block w-full rounded-md px-3 py-2 text-left text-sm text-[#0e1b1b] hover:bg-[#f4f7f7]"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
              >
                Upload from computer
              </button>
              <button
                type="button"
                className="block w-full rounded-md px-3 py-2 text-left text-sm text-[#0e1b1b] hover:bg-[#f4f7f7]"
                onMouseDown={(e) => e.preventDefault()}
                onClick={insertImageUrl}
              >
                Paste image URL
              </button>
            </div>
          )}
        </div>
        <button type="button" title="Call-to-action button" className={toolBtn} onMouseDown={(e) => e.preventDefault()} onClick={insertButton}>
          <MousePointerClick className="h-4 w-4" />
        </button>
        <span className="mx-1 h-5 w-px bg-[#e8efef]" />
        <div className="relative">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setMenu(menu === "merge" ? "none" : "merge")}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold text-[#0e7d82] hover:bg-[#e0f7f8]"
          >
            <User className="h-4 w-4" /> Personalise
          </button>
          {menu === "merge" && (
            <div className="absolute z-20 mt-1 w-52 rounded-lg border border-[#d8e4e4] bg-white p-1 shadow-lg">
              {MERGE_FIELDS.map((f) => (
                <button
                  key={f.token}
                  type="button"
                  className="block w-full rounded-md px-3 py-2 text-left text-sm text-[#0e1b1b] hover:bg-[#f4f7f7]"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertMerge(f.token, f.label)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onBlur={saveSelection}
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
        className="min-h-[280px] max-w-none px-4 py-3 text-[15px] leading-relaxed text-[#1a2b2b] focus:outline-none [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-xl [&_h2]:font-black [&_a]:text-[#0e7d82] [&_a]:underline [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_p]:my-2"
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onPickFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
});
