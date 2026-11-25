import { useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { SKINS, readSkinChoice, subscribeSkin, themeSkins, type SkinChoice } from "@/lib/skins";
import { chooseSkinChoice } from "@/lib/theme/runtime";
import { SettingRow } from "./SettingsPrimitives";

const themeRows = () => [
  { choice: "system", label: "settings.theme.system" },
  { choice: themeSkins().light, label: "settings.theme.light" },
  { choice: themeSkins().dark, label: "settings.theme.dark" },
] as const satisfies readonly { choice: SkinChoice; label: string }[];

export function useSkinChoice(): SkinChoice {
  return useSyncExternalStore(subscribeSkin, readSkinChoice, readSkinChoice);
}

export function ThemeRow({ simple = false }: { simple?: boolean }) {
  const choice = useSkinChoice();
  const rows = themeRows();
  const look = rows.some((theme) => theme.choice === choice) ? undefined : SKINS.find((skin) => skin.id === choice)?.name;
  return (
    <SettingRow
      title={t(simple ? "settings.theme.lightOrDark" : "settings.theme.title")}
      subtitle={look ? t("settings.theme.look", { name: look }) : simple ? undefined : t("settings.theme.subtitle")}
    >
      <div role="radiogroup" aria-label={t(simple ? "settings.theme.lightOrDark" : "settings.theme.title")} className={simple ? "inline-flex h-7 rounded-full bg-ink/[0.06] p-0.5" : "inline-flex rounded-full bg-inset p-0.5"}>
        {rows.map((theme) => (
          <button
            key={theme.choice}
            type="button"
            role="radio"
            aria-checked={choice === theme.choice}
            onClick={() => chooseSkinChoice(theme.choice)}
            className={simple
              ? cn("h-6 rounded-full px-2.5 text-[13px] transition-colors", choice === theme.choice ? "bg-ink/[0.12] text-ink" : "text-ink-secondary hover:text-ink")
              : cn("rounded-full px-3 py-1 text-[13px] font-medium transition-colors", choice === theme.choice ? "bg-raised text-ink shadow-sm" : "text-ink-secondary hover:text-ink")}
          >
            {t(simple && theme.choice === "system" ? "settings.simple.theme.system" : theme.label)}
          </button>
        ))}
      </div>
    </SettingRow>
  );
}
