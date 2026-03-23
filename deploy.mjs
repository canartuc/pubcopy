import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createInterface } from "readline";

const CONFIG_FILE = ".deploy.json";

async function getVaultPath() {
  if (existsSync(CONFIG_FILE)) {
    const config = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
    if (config.vaultPath && existsSync(config.vaultPath)) {
      return config.vaultPath;
    }
    console.log("Saved vault path not found. Let's set a new one.");
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question("Obsidian vault path: ", resolve);
  });
  rl.close();

  const vaultPath = answer.trim();
  if (!existsSync(vaultPath)) {
    console.error(`Path does not exist: ${vaultPath}`);
    process.exit(1);
  }

  writeFileSync(CONFIG_FILE, JSON.stringify({ vaultPath }, null, 2) + "\n");
  console.log(`Saved to ${CONFIG_FILE}`);
  return vaultPath;
}

const vaultPath = await getVaultPath();
const dest = join(vaultPath, ".obsidian", "plugins", "pubcopy");

mkdirSync(dest, { recursive: true });

for (const file of ["main.js", "manifest.json", "styles.css"]) {
  copyFileSync(file, join(dest, file));
}

console.log(`Deployed to ${dest}`);
