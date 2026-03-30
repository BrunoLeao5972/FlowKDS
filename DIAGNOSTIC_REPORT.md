# KDS Order Integration Diagnostic Report
**Generated:** March 29, 2026

## 1. ORDER CREATION FLOW

### Frontend (src/contexts/OrderContext.tsx)
```
User Action → addOrder() function
  ↓
POST ${API_BASE}/orders
  - Headers: { 'Content-Type': 'application/json', 'x-kds-token': token }
  - Body: { number, customerName, items, observations, cookId }
  ↓
Response parsed and normalized (date conversion)
  ↓
printOrderTicket() triggered
  ↓
Socket.io listeners wait for 'orders:created' event
```

### Backend (server/index.js)
```
POST /orders request received
  ↓
Authentication via authMiddleware (line 546):
  - Checks 'x-kds-token' header OR Authorization header
  - AUTH_ENABLED=true (enforcement required)
  - Returns 401 if unauthorized
  ↓
Route handler (line 1073):
  - Validates: number required, items[] required
  - Creates order object with all fields
  - await Order.create(order) — MongoDB persistence
  ↓ (if successful)
  - HTTP 201 response sent to client
  - io.emit('orders:created', toISO(order)) broadcast to all connected sockets
  ↓
Socket.io event listeners (OrderContext.tsx):
  - 'orders:created': Adds new order to state, plays sound
  - Updates UI with live order
```

---

## 2. IDENTIFIED ISSUES & BOTTLENECKS

### **CRITICAL ISSUE #1: Route Definition Order** ⚠️
**Location:** server/index.js, lines 1068-1073

**Problem:**
```javascript
// Static file serving (line 1068-1070)
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get('*', (req, res) => {  // ← Catches ALL remaining GET requests
    res.sendFile(path.join(DIST, 'index.html'));
  });
}
// Then POST /orders defined AFTER static middleware (line 1073)
app.post('/orders', asyncHandler(async (req, res) => {
```

**Impact:** 
- While POST requests shouldn't be caught by `app.get('*')`, the routing order is unconventional
- Better practice: Define API routes BEFORE static file serving

**Recommendation:** 
Move all API routes (including `app.use('/orders', authMiddleware)` and `app.post('/orders', ...)`) BEFORE the static file serving block.

---

### **ISSUE #2: Missing Error Logging in Order Creation** ⚠️
**Location:** server/index.js, line 1073-1108

**Problem:**
```javascript
app.post('/orders', asyncHandler(async (req, res) => {
  // ... validation ...
  await Order.create(order);  // ← Can fail silently
  res.status(201).json(toISO(order));  // Sends response
  io.emit('orders:created', toISO(order));  // Emits event AFTER response
}));
```

**Missing:** 
- No console logging of successful order creation
- No error details if Order.create() fails
- No verification that socket.io emit completes

**Recommendation:**
```javascript
try {
  const created = await Order.create(order);
  console.log(`[ORDER CREATED] ID: ${order.id}, #${order.number}`);
  res.status(201).json(toISO(created));
  io.emit('orders:created', toISO(created));
} catch (err) {
  console.error('[ORDER CREATE ERROR]', {
    error: err.message,
    orderNumber: number,
    details: err
  });
  throw err;
}
```

---

### **ISSUE #3: Authentication Required but No Bypass for Development** ⚠️
**Location:** server/.env

**Current Setting:**
```
AUTH_ENABLED=true
AUTH_USERNAME=Admin
AUTH_PASSWORD=masterkey
```

**Impact:**
- ALL order creation requests MUST include valid token (`x-kds-token` header)
- If frontend login fails or token expires, NO orders can be created
- No fallback mechanism for local testing

**Troubleshooting Path:**
1. Check if frontend successfully obtained token via `/auth/login`
2. Verify token is included in POST request to `/orders`
3. Check if token is expired (TTL_HOURS=12)

---

### **ISSUE #4: MongoDB Connection String Hardset** ⚠️
**Location:** server/.env

**Configuration:**
```
MONGODB_URI=mongodb://127.0.0.1:27017/kds
```

**Potential Failures:**
1. MongoDB service not running on 127.0.0.1:27017
2. Database `kds` doesn't exist (MongoDB will create it, but connection fails first)
3. Network/firewall blocking connection to localhost:27017
4. MongoDB timeout (5000ms) if server is slow

**Check Connection:**
```bash
# Server logs on startup should show:
# "MongoDB connected (127.0.0.1/kds)"
```

---

### **ISSUE #5: Socket.io Event Not Reaching Frontend** ⚠️
**Location:** src/contexts/OrderContext.tsx, lines 295+

**Sequence:**
1. Socket.io connection established with `transports: ['websocket']`
2. Backend emits: `io.emit('orders:created', order)`
3. Frontend listener: `socket.on('orders:created', (o: Order) => { ... })`

**Potential Failures:**
- Socket connection not established (check browser console)
- Token auth failed for socket connection (line 313-321 in OrderContext.tsx)
- WebSocket blocked by firewall/proxy
- Event data format mismatch (dates not being normalized correctly)

---

## 3. RECENT MODIFICATIONS RISK ASSESSMENT

### No TODO/FIXME Comments Found
- Searched entire server/ directory: **0 matches for TODO/FIXME**
- Suggests code is stable OR comments removed in recent cleanup

### Configuration Changes Risk
The `.env` file has SQL2014 bridge settings:
```
SQL2014_INITIAL_SYNC_AT=2026-03-28T00:00:00.000Z  ← Recent date!
```
This suggests SaaS sync worker may be active. Check if this is competing with order creation.

---

## 4. IMMEDIATE DIAGNOSTIC STEPS

### Step 1: Verify Backend is Running
```bash
curl http://localhost:8081/healthz
# Should respond with 200 OK
```

### Step 2: Check MongoDB Connection
Look for this log message on server startup:
```
MongoDB connected (127.0.0.1/kds)
```

### Step 3: Verify Authentication
```bash
# Get auth token
curl -X POST http://localhost:8081/auth/login \
  -H "Authorization: Basic QWRtaW46bWFzdGVya2V5" \
  # (Basic auth for Admin:masterkey)
# Should return: { "token": "...", "enabled": true, "permissions": [...] }
```

### Step 4: Test Order Creation Directly
```bash
curl -X POST http://localhost:8081/orders \
  -H "Content-Type: application/json" \
  -H "x-kds-token: [TOKEN_FROM_STEP_3]" \
  -d '{"number": 1, "items": [{"name": "Test", "quantity": 1}]}'
# Should return 201 with order object
```

### Step 5: Monitor Browser Console
- Check for fetch errors (401, 500, network)
- Check for socket.io connection errors
- Check Network tab for POST /orders requests

---

## 5. RECOMMENDED FIXES (PRIORITY ORDER)

### Priority 1: Add Comprehensive Logging
- [ ] Log every POST /orders request entry/exit
- [ ] Log MongoDB create operations  
- [ ] Log socket.io emissions
- [ ] Capture and log any errors with full stack trace

### Priority 2: Reorganize Routes for Clarity
- [ ] Move API routes (`app.use('/orders', authMiddleware)` + all routes) **BEFORE** static file serving
- [ ] Add explicit error handling with meaningful messages

### Priority 3: Add Development Mode Support
- [ ] Option to disable AUTH_ENABLED for local testing
- [ ] Toggle for MongoDB connection debugging
- [ ] Socket.io debug mode

### Priority 4: Add Health Checks
- [ ] `/health` endpoint reporting MongoDB status
- [ ] `/health` endpoint reporting Socket.io listeners count
- [ ] Frontend error boundary for failed orders

---

## 6. SUMMARY TABLE

| Component | Status | Risk | Notes |
|-----------|--------|------|-------|
| **MongoDB Connection** | ✓ Configured | MEDIUM | Check if service running |
| **Authentication** | ✓ Enabled | HIGH | Token required; no fallback |
| **Route Definitions** | ✓ Present | MEDIUM | Order matters; improve clarity |
| **Error Handling** | ✓ Present | HIGH | Silent failures; need logging |
| **Socket.io Setup** | ✓ Configured | MEDIUM | Check browser console |
| **Frontend Listeners** | ✓ Configured | LOW | Properly normalized |
| **Order Schema** | ✓ Defined | LOW | All fields present |

---

## 7. NEXT STEPS

1. **Check server logs** for any error messages during startup
2. **Verify MongoDB is running**: `mongosh` or check mongo service
3. **Test POST /orders directly** using curl command above
4. **Check browser DevTools** (Network + Console tabs) for any 401/500 errors
5. **Enable debug logging** in server/index.js for POST /orders handler
6. **Monitor Socket.io connection** - check if `socket connected` logs appear

**If orders still don't appear after verification, likely causes:**
- Authentication token invalid or expired
- MongoDB not running or connection failed
- Socket.io connection not established
- Frontend login failed and no token generated
