import { AutomationSettingsModel } from "@/models/AutomationSettings";
import { DEFAULT_AUTOMATION_SETTINGS } from "@/lib/automations";

// Un réglage absent du schéma (ou rangé dans le mauvais bloc) est effacé à
// l'enregistrement par Mongoose : il reviendrait toujours à sa valeur par défaut.
describe("réglages des automatisations — schéma", () => {
  const paths = Object.keys(AutomationSettingsModel.schema.paths);
  it.each(Object.entries(DEFAULT_AUTOMATION_SETTINGS))("le réglage %s est au premier niveau du schéma, avec chacun de ses champs", (key, value) => {
    for (const field of Object.keys(value as object)) {
      expect(paths.some(p => p === `${key}.${field}`)).toBe(true);
    }
  });
});
