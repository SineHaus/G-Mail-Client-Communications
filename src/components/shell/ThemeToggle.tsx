"use client";
import Icon from "./icons";
import { applyTheme, useLocalPref } from "./local-pref";

type Pref = "light" | "dark" | "auto";

/** Light / Dark / Auto (follows the device). Remembered on this device. */
export default function ThemeToggle() {
  const [pref, setPref] = useLocalPref<Pref>("terg-theme", "auto");
  const pick = (p: Pref) => {
    setPref(p);
    applyTheme(p);
  };
  const opts: { p: Pref; label: string; icon: "sun" | "moon" | "auto" }[] = [
    { p: "light", label: "Light", icon: "sun" },
    { p: "dark", label: "Dark", icon: "moon" },
    { p: "auto", label: "Auto", icon: "auto" },
  ];
  return (
    <div className="t-seg theme" role="group" aria-label="Light or dark">
      {opts.map((o) => (
        <button key={o.p} type="button" aria-pressed={pref === o.p} onClick={() => pick(o.p)} title={o.label}>
          <Icon name={o.icon} />
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}
