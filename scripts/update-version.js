/**
 * Script para sincronizar versão do package.json com src/lib/version.ts
 * Executado automaticamente após npm version
 */
const fs = require('fs');
const path = require('path');

const packageJson = require('../package.json');
const version = packageJson.version;

const versionFile = path.join(__dirname, '..', 'src', 'lib', 'version.ts');
const content = `/** Versão atual do Flow KDS - SemVer: MAJOR.MINOR.PATCH */
export const APP_VERSION = '${version}';
`;

fs.writeFileSync(versionFile, content, 'utf8');
console.log(`✅ Versão sincronizada: ${version}`);
