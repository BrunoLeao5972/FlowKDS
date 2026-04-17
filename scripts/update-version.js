/**
 * Script para sincronizar versão do package.json com src/lib/version.ts
 * Executado automaticamente após npm version
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;

const versionFile = path.join(__dirname, '..', 'src', 'lib', 'version.ts');
const content = `/** Versão atual do FOX KDS - SemVer: MAJOR.MINOR.PATCH */
export const APP_VERSION = '${version}';
`;

fs.writeFileSync(versionFile, content, 'utf8');
console.log(`✅ Versão sincronizada: ${version}`);
