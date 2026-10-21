// Petit stockage JSON sur disque, dans le dossier data/ à la racine du projet.
//
// Les fichiers sont chiffrés au repos (AES-256-GCM) avec la clé DATA_KEY du fichier .env
// (64 caractères hexadécimaux). Un ancien fichier en clair est relu puis réécrit chiffré.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const writes = new Set(); // écritures en cours, toutes stores confondues

// Clé de chiffrement : null si DATA_KEY est absente ou invalide (vérifié au démarrage par index.js).
export function dataKey() {
  const hex = process.env.DATA_KEY?.trim();
  return hex && /^[0-9a-f]{64}$/i.test(hex) ? Buffer.from(hex, 'hex') : null;
}

function requireKey() {
  const key = dataKey();
  if (!key) throw new Error('DATA_KEY manquante ou invalide dans .env (64 caractères hexadécimaux)');
  return key;
}

function encrypt(text) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', requireKey(), iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
}

// Renvoie { data, plain } : plain = true si le fichier était encore en clair.
function decrypt(raw) {
  const parsed = JSON.parse(raw);
  if (parsed?.v !== 1 || !parsed.iv || !parsed.tag || typeof parsed.data !== 'string') return { data: parsed, plain: true };
  const decipher = createDecipheriv('aes-256-gcm', requireKey(), Buffer.from(parsed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
  const text = Buffer.concat([decipher.update(Buffer.from(parsed.data, 'base64')), decipher.final()]).toString('utf8');
  return { data: JSON.parse(text), plain: false };
}

// Chiffre tous les fichiers JSON de data/ encore en clair (hors data/cache/, qui ne contient que des images).
export async function encryptPlainStores() {
  const files = await readdir(dataDir, { recursive: true }).catch(() => []);
  let count = 0;
  for (const rel of files) {
    if (!rel.endsWith('.json') || rel.startsWith(`cache${path.sep}`)) continue;
    const raw = await readFile(path.join(dataDir, rel), 'utf8').catch(() => null);
    try {
      if (raw === null || JSON.parse(raw)?.v === 1) continue;
    } catch {
      continue; // fichier abîmé : load() le mettra de côté quand il sera utilisé
    }
    await jsonStore(rel.slice(0, -'.json'.length).split(path.sep).join('/')).load(); // relu puis réécrit chiffré
    count++;
  }
  await flushStores();
  if (count) console.log(`🔐 ${count} fichier(s) de data/ chiffré(s)`);
}

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
      requireKey(); // sans clé, on n'ouvre rien (et on ne met surtout pas les fichiers de côté)
      let raw;
      try {
        raw = await readFile(file, 'utf8');
      } catch (err) {
        if (err.code !== 'ENOENT') console.warn(`⚠️ data/${name}.json illisible, on repart de zéro :`, err.message);
        return (data = {});
      }
      let plain;
      try {
        ({ data, plain } = decrypt(raw));
      } catch (err) {
        // Mauvaise clé ou fichier abîmé : on ne l'écrase pas, pour pouvoir le récupérer avec la bonne clé.
        await rename(file, `${file}.illisible-${Date.now()}`).catch(() => {});
        console.warn(`⚠️ data/${name}.json indéchiffrable (mis de côté), on repart de zéro :`, err.message);
        return (data = {});
      }
      if (plain) save(); // ancien fichier en clair : réécrit chiffré
      return data;
    })();
    return loading;
  }

  // Écriture atomique (fichier temporaire puis renommage), une à la fois.
  function save() {
    writing = writing
      .then(async () => {
        await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        await writeFile(`${file}.tmp`, encrypt(JSON.stringify(data)), { mode: 0o600 });
        await rename(`${file}.tmp`, file);
      })
      .catch((err) => console.error(`⚠️ Impossible d'écrire data/${name}.json :`, err.message));
    const current = writing;
    writes.add(current);
    current.finally(() => writes.delete(current));
    return writing;
  }

  // Efface le fichier et les données en mémoire.
  function remove() {
    data = {};
    loading = Promise.resolve(data);
    writing = writing.then(() => rm(file, { force: true })).catch(() => {});
    return writing;
  }

  return { load, save, remove };
}
