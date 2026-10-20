import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'commands');

// Charge chaque fichier de assets/commands/ : il doit exporter `data` et `execute` (et `autocomplete` en option).
export async function loadCommands() {
  const commands = new Map();
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.js')).sort()) {
    const mod = await import(pathToFileURL(path.join(dir, file)).href);
    if (!mod.data || !mod.execute) {
      console.warn(`[commandes] ${file} ignoré : il manque "data" ou "execute"`);
      continue;
    }
    commands.set(mod.data.name, mod);
  }
  return commands;
}
