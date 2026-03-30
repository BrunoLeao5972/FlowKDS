#!/usr/bin/env node
/**
 * Script de inicialização completa do KDS
 * Inicia tanto o servidor Express quanto o worker de sincronização SQL2014
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SERVER_DIR = path.join(__dirname, 'server');
require('dotenv').config({ path: path.join(SERVER_DIR, '.env') });

const APP_NAME = 'Flow KDS';
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
    stdio: ['ignore', logStream, logStream],
    detached: false,
    env: { ...process.env },
  });

  children.push(child);

  child.on('error', (err) => {
    log(`❌ Erro ao iniciar ${name}: ${err.message}`);
  });

  child.on('exit', (code) => {
    log(`⚠️ ${name} encerrado com código ${code}`);
    if (name.includes('Bridge')) {
      log('Tentando reiniciar em 5 segundos...');
      setTimeout(() => startProcess(name, command, args, cwd), 5000);
    }
  });

  return child;
}

function shutdown() {
  log('Encerrando processos filhos...');
  children.forEach((child) => {
    if (!child.killed) child.kill('SIGINT');
  });
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function main() {
  log(`╔════════════════════════════════════════╗`);
  log(`║ ${APP_NAME.padEnd(38)} ║`);
  log(`║ Sistema completo com Sync SQL2014      ║`);
  log(`╚════════════════════════════════════════╝`);

  startProcess(
    'KDS Server (Express)',
    process.execPath,
    [path.join(SERVER_DIR, 'index.js')]
  );

  setTimeout(() => {
    startProcess(
      'KDS Bridge (SQL2014 Sync)',
      process.execPath,
      [path.join(SERVER_DIR, 'scripts', 'sql2014-kds-bridge.js')]
    );
  }, 2000);
}

main();