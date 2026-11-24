import { en, type LocaleKey } from "@/locales";
import { t } from "@/lib/i18n";

/** `key` in this page's language when the server sent the same English `key` holds, else `text` as the server sent it. */
function sameEnglish(key: string, text: string): string {
  return Object.hasOwn(en, key) && en[key as LocaleKey] === text ? t(key as LocaleKey) : text;
}

export const appSettingLabel = (settingId: string, label: string) => sameEnglish(`appSetting.${settingId}`, label);

export const credentialLabel = (target: string, label: string) => sameEnglish(`secretCard.target.${target}.label`, label);

/** A key card's description opens with its target's English description; what follows is already in the conversation's language. */
export function credentialDescription(target: string, description: string): string {
  const key = `secretCard.target.${target}.description`;
  const english = Object.hasOwn(en, key) ? en[key as LocaleKey] : undefined;
  return english && description.startsWith(english) ? `${t(key as LocaleKey)}${description.slice(english.length)}` : description;
}

export function credentialPlaceholder(target: string, label: string, placeholder: string | undefined): string | undefined {
  if (placeholder !== `Paste your ${label}`) return placeholder;
  const shown = credentialLabel(target, label);
  return shown === label ? placeholder : t("secretCard.pasteYour", { label: shown });
}
