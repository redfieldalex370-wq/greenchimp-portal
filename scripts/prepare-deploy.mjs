import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const deployDir = path.join(rootDir, 'dist');
const apiDist = path.join(rootDir, 'apps', 'api', 'dist');
const webDist = path.join(rootDir, 'apps', 'web', 'dist');

if (!fs.existsSync(apiDist) || !fs.existsSync(webDist)) {
  throw new Error('Compila API y web antes de preparar el despliegue.');
}

fs.rmSync(deployDir, { recursive: true, force: true });
fs.mkdirSync(deployDir, { recursive: true });
fs.cpSync(apiDist, deployDir, { recursive: true });
fs.cpSync(webDist, path.join(deployDir, 'web'), { recursive: true });

console.log('Despliegue preparado en dist/ (API + web).');
