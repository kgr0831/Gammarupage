import { copyFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

if (process.env.GITHUB_ACTIONS !== "true") process.exit(0);

const outputRoot = path.resolve(process.cwd(), "out");
let aliasCount = 0;

await addFlightAliases(outputRoot);
await writeFile(path.join(outputRoot, ".nojekyll"), "", "utf8");

console.log(`Prepared GitHub Pages output with ${aliasCount} client-navigation aliases.`);

async function addFlightAliases(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const target = path.join(directory, entry.name);
    if (entry.name.startsWith("__next.")) {
      const files = await collectFiles(target);
      for (const file of files) {
        const relative = path.relative(directory, file);
        const alias = path.join(directory, relative.split(path.sep).join("."));
        await copyFile(file, alias);
        aliasCount += 1;
      }
      continue;
    }
    await addFlightAliases(target);
  }
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(target) : [target];
  }));
  return nested.flat();
}
