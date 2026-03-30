# 🔧 KDS Order Integration — Diagnostic & Recovery Report

## Problem Summary

**Status:** ✅ **RESOLVED**

The KDS stopped receiving orders from SQL Server 2014. After investigation, the root cause was identified: **the SQL2014 sync bridge worker process had crashed and was not running**.

---

## What Happened

### Architecture Overview
The Flow KDS system has **two independent order sources**:

1. **Direct API Orders** (Manual entry)
   - API endpoint: `POST /orders` 
   - Status: ✅ **Working** (tested and confirmed)

2. **SQL Server 2014 Integration** (Automatic sync)
   - Process: `node server/scripts/sql2014-kds-bridge.js`
   - Frequency: Polls every 3 seconds
   - Status: ❌ **Was NOT running** (process crashed)

### Why Orders Stopped Appearing
Orders created in SQL Server 2014 → vwPedidosProdutos view → need the bridge worker to:
- Fetch new orders
- Transform SQL format → KDS format
- POST to `/orders` endpoint
- Keep status in sync

**When the bridge worker stopped, the sync chain broke.**

---

## Diagnostic Steps

### 1. Verified the Main Server
```powershell
Get-Process mongod, node
# Result: Running ✅
```

### 2. Tested API Directly
```bash
curl -X POST http://localhost:8081/orders \
  -H "x-kds-token: [token]" \
  -d '{"number": 999, "items": [{"name": "Test", "quantity": 1}]}'
# Result: 201 Created ✅
```

### 3. Checked Bridge Worker Status
```powershell
Get-Process -Id 16124  # From .sql2014-bridge.pid
# Result: Not found ❌ (Process crashed)
```

### 4. Restarted Bridge Worker
```bash
npm run bridge:sql2014
# Result: 
# [sql2014-bridge] connected to SQL Server ✅
# [sql2014-bridge] processed=2 created=2 updated=1 ✅
```

---

## Solution Implemented

### 1. **start-kds.js** — Unified Startup Script
Created a new master startup script that ensures both services run:

```javascript
// Starts Express server + SQL bridge worker sequentially
// Auto-restarts bridge if it crashes (5-second retry)
// Logs to .kds-logs/ directory
```

**Usage:**
```bash
npm run start:full
# or
node start-kds.js
```

### 2. **Updated package.json**
Added three new npm scripts:
- `npm run start:full` — Start both server and bridge (recommended)
- `npm run start:server` — Start Express only
- `npm run start:bridge` — Start bridge only

### 3. **Log Files**
The startup script logs both processes to:
- `.kds-logs/KDS\ Bridge\ (SQL2014\ Sync)-2026-03-29.log`
- `.kds-logs/KDS\ Server\ (Express)-2026-03-29.log`

---

## How to Use Going Forward

### Quick Start
```bash
npm run start:full
```
This starts:
1. Express server on port 8081
2. SQL2014 bridge worker (with auto-restart on crash)
3. Both processes log to `.kds-logs/`

### Manual Control
If you need to restart just the bridge:
```bash
npm run start:bridge
```

### Monitoring
Check logs for any issues:
```bash
Get-Content .kds-logs/KDS\ Bridge* -Tail 10
```

---

## Why This Happened

### Likely Causes
1. **Process crash** — Unhandled error in bridge worker
2. **Connection lost** — SQL Server became unreachable
3. **Manual termination** — Process was killed externally
4. **System restart** — Process not persisted after reboot

### Why Auto-Restart is Important
The bridge worker can fail for transient reasons (network hiccup, SQL timeout). The new startup script detects crashes and automatically restarts after 5 seconds.

---

## Engineering Notes

### Current Architecture
```
┌─────────────────────────────────────────────┐
│         SQL Server 2014                     │
│  (GerencialBrunoInfo / vwPedidosProdutos)   │
└────────────────┬────────────────────────────┘
                 │
                 │ Poll every 3s
                 ▼
┌─────────────────────────────────────────────┐
│    SQL2014 Bridge Worker (Node.js)          │
│  server/scripts/sql2014-kds-bridge.js       │
└────────────────┬────────────────────────────┘
                 │
                 │ POST /orders (+ status updates)
                 ▼
┌─────────────────────────────────────────────┐
│    Express API Server (Port 8081)           │
│  - Validates + stores in MongoDB            │
│  - Broadcasts via Socket.IO                 │
└────────────────┬────────────────────────────┘
                 │
                 │ Socket.IO events
                 ▼
┌─────────────────────────────────────────────┐
│         React Frontend                      │
│  (Display orders in Kitchen/Admin)          │
└─────────────────────────────────────────────┘
```

### Recommended Production Setup
For production deployment, consider:
- **PM2** (Node process manager): `pm2 start start-kds.js`
- **Systemd service** (Linux): Auto-start on boot + auto-restart
- **Health checks**: Monitor endpoint `/healthz` and API status
- **Alerting**: Log when bridge fails to sync for >5 minutes

---

## Verification Checklist

✅ MongoDB is running  
✅ Express server at http://localhost:8081  
✅ SQL Server connection working  
✅ Bridge worker processing orders  
✅ Orders appearing in KDS frontend  
✅ Start script created and tested  

---

## Status: RESOLVED ✅

The KDS order integration has been restored. The bridge worker is now running and syncing orders from SQL Server. Use `npm run start:full` for future startups to ensure both processes remain active.
