// Petit stockage JSON sur disque, dans le dossier data/ à la racine du projet.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const writes = new Set(); // écritures en cours, toutes stores confondues

// Attend la fin de toutes les écritures en cours (avant d'arrêter le bot).
export async function flushStores() {
  while (writes.size) await Promise.allSettled([...writes]);
}

export function jsonStore(name) {
  const file = path.join(dataDir, `${name}.json`);
  let data = null;
  let loading = null;
  let writing = Promise.resolve();

  // Un seul chargement partagé : deux appels simultanés reçoivent le même objet
  // (sinon chacun aurait sa copie, et les modifications de l'un seraient perdues).
  function load() {
    loading ??= (async () => {
      try {
        data = JSON.parse(await readFile(file, 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT') console.warn(`⚠️ data/${name}.json illisible, on repart de zéro :`, err.message);
        data = {};
      }
      return data;
    })();
    return loading;
  }

  // Écriture atomique (fichier temporaire puis renommage), une à la fois.
  function save() {
    writing = writing
      .then(async () => {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(`${file}.tmp`, JSON.stringify(data, null, 2));
        await rename(`${file}.tmp`, file);
      })
      .catch((err) => console.error(`⚠️ Impossible d'écrire data/${name}.json :`, err.message));
    const current = writing;
    writes.add(current);
    current.finally(() => writes.delete(current));
    return writing;
  }

  return { load, save };
}
