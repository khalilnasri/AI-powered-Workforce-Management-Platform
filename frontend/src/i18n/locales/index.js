import de from "./de";
import en from "./en";
import fr from "./fr";

export const LOCALES = ["de", "en", "fr"];
export const DEFAULT_LOCALE = "de";

export const messages = { de, en, fr };

export function translate(locale, key) {
  const parts = key.split(".");
  let node = messages[locale] ?? messages[DEFAULT_LOCALE];
  for (const part of parts) {
    node = node?.[part];
  }
  if (node != null && typeof node === "string") return node;
  // Fallback Deutsch
  let fallback = messages[DEFAULT_LOCALE];
  for (const part of parts) {
    fallback = fallback?.[part];
  }
  return typeof fallback === "string" ? fallback : key;
}

/** BCP-47 locale tag for Intl / toLocaleDateString */
export function localeDateTag(locale) {
  return { de: "de-DE", en: "en-GB", fr: "fr-FR" }[locale] ?? "de-DE";
}
