"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export default function SearchBox({ placeholder }: { placeholder: string }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams(params.toString());
      if (q) p.set("q", q);
      else p.delete("q");
      if (p.toString() !== params.toString()) router.replace(`${path}?${p}`);
    }, 300);
    return () => clearTimeout(t);
  }, [q, params, path, router]);
  return (
    <input className="input max-w-xs" type="search" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
  );
}
