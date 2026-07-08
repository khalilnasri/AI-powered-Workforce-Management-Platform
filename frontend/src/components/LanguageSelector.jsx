import { useLanguage } from "../i18n/LanguageContext";

/**
 * Sprachwahl DE / EN / FR — für Profil-Tab der Mitarbeiter-App.
 */
export function LanguageSelector({ classPrefix = "mb-lang" }) {
  const { locale, setLocale, t } = useLanguage();

  const options = [
    { id: "de", label: t("lang.de") },
    { id: "en", label: t("lang.en") },
    { id: "fr", label: t("lang.fr") },
  ];

  return (
    <div className={`${classPrefix}-wrap`}>
      <span className={`${classPrefix}-label`}>{t("profile.language")}</span>
      <div className={`${classPrefix}-options`} role="group" aria-label={t("profile.language")}>
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`${classPrefix}-btn${locale === opt.id ? ` ${classPrefix}-btn--active` : ""}`}
            onClick={() => setLocale(opt.id)}
            aria-pressed={locale === opt.id}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
