#!/usr/bin/env node
/**
 * Script de inicialização completa do KDS
 * A sincronização com o SQL2014 roda dentro do próprio servidor Express (server/services/sql2014Sync.js).
 */
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_DIR = path.join(__dirname, 'server');

const APP_NAME = 'FOX KDS';
const LOG_DIR = path.join(__dirname, '.kds-logs');
const children = [];

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function createLogStream(name) {
  const timestamp = new Date().toISOString().slice(0, 10);
  const logFile = path.join(LOG_DIR, `${name}-${timestamp}.log`);
  return fs.createWriteStream(logFile, { flags: 'a' });
}

function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

function startProcess(name, command, args, cwd = SERVER_DIR) {
  log(`Iniciando ${name}...`);

  const logStream = createLogStream(name);
  const child = spawn(command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: { ...process.env },
  });

  if (child.stdout) child.stdout.pipe(logStream);
  if (child.stderr) child.stderr.pipe(logStream);

  children.push(child);

  child.on('error', (err) => {
    log(`❌ Erro ao iniciar ${name}: ${err.message}`);
  });

  child.on('exit', (code) => {
    log(`⚠️ ${name} encerrado com código ${code}`);
  });

  return child;
}

function shutdown() {
  // Encerramento gracioso para evitar processos orfaos no Windows.
  log('Encerrando processos filhos...');
  children.forEach((child) => {
    if (!child.killed) child.kill('SIGINT');
  });
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function main() {
  log(`╔══════════════════════════════════════════════════════╗`);
  log(`║ ${'PROJETO KDS - A SUA COZINHA AINDA MAIS EFICIENTE 🦊'.padEnd(52)} ║`);
  log(`╚══════════════════════════════════════════════════════╝`);

  startProcess(
    'KDS Server (Express)',
    process.execPath,
    [path.join(SERVER_DIR, 'index.js')]
  );
}

main();