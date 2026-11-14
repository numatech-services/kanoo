/**
 * Fuseau des tests : Africa/Niamey, comme l'application (next.config.mjs,
 * instrumentation.ts). Posé ici, dans le processus parent, avant le lancement
 * des workers : un `process.env.TZ = …` écrit dans un fichier de test ne
 * touche qu'une copie de l'environnement et laisse le fuseau du système
 * (UTC sur la CI). Un TZ explicite reste respecté.
 */
module.exports = () => {
  if (!process.env.TZ || !process.env.TZ.trim()) process.env.TZ = "Africa/Niamey";
};
