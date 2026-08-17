"use client";

import { useRef, useState } from "react";
import type { Locale } from "@/lib/tenant/types";

const PLACEHOLDER: Record<Locale, string> = {
  tr: "Ne giymek istediğinizi yazın…",
  en: "Tell me what you're dressing for…",
  de: "Wofür möchten Sie sich anziehen?",
  it: "Per quale occasione ti vesti?",
};

export function Composer({
  disabled,
  onSend,
  locale,
}: {
  disabled: boolean;
  onSend: (text: string) => void;
  locale: Locale;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    setValue("");
    if (ref.current) ref.current.style.height = "auto";
    onSend(text);
  };

  return (
    <form
      className="rv-composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={ref}
        rows={1}
        value={value}
        disabled={disabled}
        placeholder={PLACEHOLDER[locale]}
        aria-label={PLACEHOLDER[locale]}
        onChange={(e) => {
          setValue(e.target.value);
          // Grow with the text: a two-line thought should not scroll inside a
          // one-line box on a phone.
          e.target.style.height = "auto";
          e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
        }}
        onKeyDown={(e) => {
          // Enter sends, Shift+Enter breaks the line — the convention every
          // messaging app has trained people on.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button type="submit" className="rv-send" disabled={disabled || !value.trim()} aria-label="Gönder">
        ↑
      </button>
    </form>
  );
}
