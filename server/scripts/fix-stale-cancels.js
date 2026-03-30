require('dotenv').config();

// Cancelar pedidos que estão como 'received' no estado mas que já foram cancelados no SQL
const KDS_API_BASE = (process.env.KDS_API_BASE || 'http://127.0.0.1:8081').replace(/\/$/, '');
const user = process.env.KDS_AUTH_USERNAME || '';
const pass = process.env.KDS_AUTH_PASSWORD || '';
const auth = Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');

async function patchStatus(kdsId, status) {
  const url = `${KDS_API_BASE}/orders/${encodeURIComponent(kdsId)}/status`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PATCH ${kdsId} failed: ${res.status} ${body}`);
  }
  return res.json();
}

async function run() {
  // Pedidos que deveriam estar cancelados mas estão como 'received'
  const toFix = [
    { externalId: '100006276', kdsId: '843646b8-563b-46bf-949d-2881ea63ed60' },
    { externalId: '100006277', kdsId: 'd8ba46a9-d9e5-4b22-b2af-542603073225' },
  ];

  for (const { externalId, kdsId } of toFix) {
    try {
      await patchStatus(kdsId, 'cancelled');
      console.log(`OK: externalId=${externalId} kdsId=${kdsId} → cancelled`);
    } catch (e) {
      console.error(`ERRO: externalId=${externalId}: ${e.message}`);
    }
  }

  // Corrigir também o state file para refletir o status real
  const fs = require('fs');
  const path = require('path');
  const stateFile = path.resolve(__dirname, '.sql2014-bridge-state.json');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  state.lastStatusByExternalId['100006276'] = 'cancelled';
  state.lastStatusByExternalId['100006277'] = 'cancelled';
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
  console.log('State file atualizado: 100006276 e 100006277 → cancelled');
}

run().catch(console.error);
