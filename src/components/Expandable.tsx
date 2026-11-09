"use client";
import { useState } from "react";

/** Plain-text block clamped to a few lines with a "Show more" toggle. */
export default function Expandable({ text, lines = 6, className = "" }: { text: string; lines?: number; className?: string }) {
  const [open, setOpen] = useState(false);
  const long = text.split("\n").length > lines || text.length > lines * 90;
  return (
    <div className={className}>
      <div
        className="text-sm leading-relaxed whitespace-pre-wrap break-words"
        style={open || !long ? undefined : { display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden" }}
      >
        {text || <span className="text-stone-400 italic">(empty)</span>}
      </div>
      {long && (
        <button onClick={() => setOpen(!open)} className="mt-1 text-xs font-medium text-brand-700 hover:underline">
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
