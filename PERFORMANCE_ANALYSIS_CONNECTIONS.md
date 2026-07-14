# Performance Analysis: Connection & Quota Loading
**Date**: 2026-07-14  
**Issue**: Severe performance degradation on production server with 2000+ connections  
**Affected Pages**: `/dashboard/endpoint`, `/dashboard/quota`

---

## Executive Summary

Halaman `/dashboard/endpoint` dan `/dashboard/quota` mengalami bottleneck performa saat load data API keys dengan allocated connections dan quota mereka. Root cause: **N+1 query pattern** di client-side yang fetch 2k+ connections berulang kali + **serial external API calls** untuk setiap connection.

**Current Performance** (10 API keys, 50 allocated connections per key, 2k total connections):
- 20,000+ connection records parsed (10 keys × 2k connections)
- 500+ external provider API calls (10 keys × 50 connections)
- Load time: 30-60+ seconds (serial HTTP calls)

**Target Performance** (with recommended solution):
- 1 aggregation query
- 0-50 external API calls (cached)
- Load time: <2 seconds

---

## Current Architecture Analysis

### 1. Bottleneck: `/dashboard/endpoint` - Credit Bar Feature

**File**: `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js`  
**Lines**: 287-371

#### Algorithm Flow:
```javascript
// Line 287-301: fetchData()
const keysRes = await fetch("/api/keys");
const keys = keysData.keys || [];
keys.forEach(key => fetchKeyQuota(key.id)); // ❌ N calls

// Line 305-371: fetchKeyQuota(keyId) - called PER KEY
const connRes = await fetch('/api/connections?isActive=true'); // ❌ Fetches ALL 2k connections
const allocatedConns = connData.connections.filter(c => c.assignedToApiKeyId === keyId); // Client-side filter

// Fetch quota for EACH allocated connection
const quotaPromises = allocatedConns.map(conn =>
  fetch(`/api/usage/${conn.id}`) // ❌ External API call per connection
    .then(r => r.ok ? r.json() : null)
);
const quotasData = await Promise.all(quotaPromises);

// Aggregate
let totalUsed = 0, totalLimit = 0;
quotasData.forEach(quotaData => {
  const credit = quotaData.quotas.credit || quotaData.quotas["0"];
  totalUsed += credit.used || 0;
  totalLimit += credit.total || 0;
});
```

#### Complexity Analysis:
- **Time Complexity**: `O(N × C + N × M × T_ext)`
  - `N` = number of API keys (10)
  - `C` = total connections (2000)
  - `M` = avg allocated connections per key (50)
  - `T_ext` = external API call latency (100-3000ms)
- **Space Complexity**: `O(N × C)` - stores 2k connections N times in memory
- **Network Calls**: 
  - Connections fetch: `N` calls (10 × 2k = 20k records)
  - Quota fetch: `N × M` calls (10 × 50 = 500 external APIs)

#### Problem Patterns:
1. **N+1 Query Anti-Pattern**: Fetch connections N times instead of once
2. **Client-Side Filtering**: 2k records parsed in browser, not DB-indexed query
3. **Serial External Calls**: Each `/api/usage/${id}` hits provider APIs (GitHub, Claude, etc.)
4. **No Caching**: Every page load repeats all external calls
5. **Redundant Data Transfer**: Full connection objects transferred when only need IDs + quota

---

### 2. Bottleneck: `/api/usage/[connectionId]` Endpoint

**File**: `src/app/api/usage/[connectionId]/route.js`  
**Lines**: 122-191

#### Algorithm Flow:
```javascript
// GET /api/usage/[connectionId]
const connection = await getProviderConnectionById(connectionId); // DB query: O(1) indexed

// OAuth: refresh token if expired
if (isOAuth) {
  await refreshAndUpdateCredentials(connection); // 1-3s per provider
}

// External API call
let usage = await getUsageForProvider(connection, proxyOptions); // ❌ HTTP call to provider
```

#### External API Calls (from `open-sse/services/usage.js`):
Each `getUsageForProvider()` calls:
- **GitHub**: `api.github.com/copilot_internal/...`
- **Claude**: `api.anthropic.com/v1/...`
- **Codex**: `api.openai.com/v1/...`
- **Gemini, Kiro, others**: respective provider APIs

**Latency per call**: 100-3000ms (depends on provider, network, rate limits)

#### Problems:
1. **External Dependency**: Each request = real HTTP call (no cache)
2. **Token Refresh Overhead**: OAuth refresh can take 1-3s
3. **Serial Execution**: Quota fetches run one-by-one (Promise.all helps but still limited)
4. **Rate Limiting**: Providers may throttle requests → slower response

---

### 3. Bottleneck: `/dashboard/quota` Page

**File**: `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js`  
**Lines**: 499-521

#### Algorithm Flow:
```javascript
// Mount: fetch paginated connections
const visibleConnections = await fetchConnections(page); // Paginated (20-100 connections)

// Fetch quota for EACH connection
await Promise.all(
  visibleConnections.map(conn => fetchQuota(conn.id, conn.provider)) // ❌ M external API calls
);
```

#### Complexity:
- **Time**: `O(M × T_ext)` where M = page size (20-100)
- **Network Calls**: M external API calls per page load

#### Problems:
- Same `/api/usage/[id]` bottleneck
- Auto-refresh every 60s (line 584) = repeated external calls
- With 2k connections / 20 per page = 100 pages × 20 calls = 2000 external calls to browse all

---

## Performance Metrics

### Current State (2k connections, 10 API keys, 50 allocated each):

| Metric | `/dashboard/endpoint` | `/dashboard/quota` (page 1, 20 conns) |
|--------|----------------------|----------------------------------------|
| **HTTP Requests** | 11 (1 keys + 10 connections + 500 quota) | 21 (1 connections + 20 quota) |
| **Data Transferred** | ~5-10 MB (20k connection records) | ~200 KB |
| **External API Calls** | 500 | 20 |
| **Time (serial, 500ms avg)** | 250 seconds | 10 seconds |
| **Time (Promise.all, 10 parallel)** | 25 seconds | 1 second |
| **Browser Memory** | ~50 MB (duplicate data) | ~5 MB |

**Observed**: "lemot banget" di production → consistent with 25s+ load time

---

## Recommended Solutions

### ✅ Solution 1: Server-Side Batch Aggregation Endpoint (PRIMARY)

**Approach**: Create `/api/keys/credits` that aggregates quota server-side

#### Implementation:
```javascript
// NEW: src/app/api/keys/credits/route.js
export async function GET(request) {
  // 1. Fetch only assigned connections (indexed query)
  const connections = await getProviderConnections({ 
    assignedToApiKeyId: { not: null } // ponytail: custom filter, not in current schema
  });
  
  // 2. Group by API key
  const grouped = connections.reduce((acc, conn) => {
    if (!acc[conn.assignedToApiKeyId]) acc[conn.assignedToApiKeyId] = [];
    acc[conn.assignedToApiKeyId].push(conn);
    return acc;
  }, {});
  
  // 3. Aggregate quota per key (use cached data, not fresh API calls)
  const result = {};
  for (const [keyId, conns] of Object.entries(grouped)) {
    let totalUsed = 0, totalLimit = 0;
    
    for (const conn of conns) {
      // Check cache first (localStorage/Redis)
      const cached = getQuotaCache(conn.id);
      if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) { // 5min TTL
        const credit = cached.quotas?.credit || cached.quotas?.["0"];
        if (credit) {
          totalUsed += credit.used || 0;
          totalLimit += credit.total || 0;
        }
      }
      // ponytail: no fresh API call here - use stale data or skip
    }
    
    if (totalLimit > 0) {
      result[keyId] = { used: totalUsed, total: totalLimit };
    }
  }
  
  return Response.json(result);
}
```

#### Client-side update:
```javascript
// EndpointPageClient.js - replace fetchKeyQuota loop
const fetchAllKeyQuotas = async () => {
  const res = await fetch('/api/keys/credits'); // ❌ 1 call, not N
  const credits = await res.json();
  
  setKeyQuotas(credits); // Set all at once
};

// In fetchData()
await fetchAllKeyQuotas(); // Instead of: keys.forEach(key => fetchKeyQuota(key.id))
```

#### Benefits:
- **Network Calls**: 1 instead of 511 (10 connections + 500 quota)
- **Time Complexity**: `O(C + M)` instead of `O(N × C + N × M × T_ext)`
- **Data Transfer**: <100 KB instead of ~10 MB
- **Load Time**: <1s instead of 25s+

#### Tradeoffs:
- Uses cached quota data (5min stale) instead of fresh
- Add when: need real-time quota → implement WebSocket updates or Redis pub/sub

---

### ✅ Solution 2: Hoist Connections Fetch (QUICK WIN)

**Approach**: Fetch connections ONCE, share across all keys

#### Implementation:
```javascript
// EndpointPageClient.js - line 287
const fetchData = async () => {
  const [keysRes, connsRes] = await Promise.all([
    fetch("/api/keys"),
    fetch("/api/connections?isActive=true") // ❌ Fetch ONCE
  ]);
  
  const keys = (await keysRes.json()).keys || [];
  const allConnections = (await connsRes.json()).connections || [];
  
  setKeys(keys);
  
  // Fetch quota for each key (still N × M calls, but no redundant connection fetch)
  keys.forEach(key => fetchKeyQuotaWithConnections(key.id, allConnections));
};

// Update fetchKeyQuota to accept connections param
const fetchKeyQuotaWithConnections = async (keyId, allConnections) => {
  const allocatedConns = allConnections.filter(c => c.assignedToApiKeyId === keyId);
  // ... rest same
};
```

#### Benefits:
- **Network Calls**: 1 connections fetch instead of 10
- **Data Transfer**: 2k records × 1 = ~500 KB instead of 5 MB
- **Time Saved**: ~1-2 seconds (remove 9 redundant fetches)

#### Tradeoffs:
- Still makes N × M external quota calls (500 calls)
- Partial fix only - combine with Solution 3

---

### ✅ Solution 3: Redis Cache Layer (SCALABLE)

**Approach**: Cache quota results with TTL

#### Implementation:
```javascript
// src/lib/cache/quotaCache.js (NEW)
import { createClient } from 'redis';

const redis = createClient({ url: process.env.REDIS_URL });
const QUOTA_TTL = 5 * 60; // 5 minutes

export async function getCachedQuota(connectionId) {
  const key = `quota:${connectionId}`;
  const cached = await redis.get(key);
  return cached ? JSON.parse(cached) : null;
}

export async function setCachedQuota(connectionId, quota) {
  const key = `quota:${connectionId}`;
  await redis.setEx(key, QUOTA_TTL, JSON.stringify(quota));
}

// Update /api/usage/[connectionId]/route.js
export async function GET(request, { params }) {
  const { connectionId } = await params;
  
  // Check cache
  const cached = await getCachedQuota(connectionId);
  if (cached) return Response.json(cached);
  
  // Fetch fresh (existing logic)
  const connection = await getProviderConnectionById(connectionId);
  const usage = await getUsageForProvider(connection, proxyOptions);
  
  // Cache result
  await setCachedQuota(connectionId, usage);
  
  return Response.json(usage);
}
```

#### Benefits:
- **Cache Hit Rate**: ~90% for repeated requests (5min window)
- **External API Calls**: 50 instead of 500 (10% cache miss)
- **Load Time**: 2-3s instead of 25s (cache hits return instantly)

#### Tradeoffs:
- Requires Redis (add dependency)
- Quota data stale up to 5 minutes
- Add when: >100 connections or >10 quota fetches/min

---

### Solution 4: Progressive/Lazy Loading (UX PATTERN)

**Approach**: Don't load credits on mount, load on demand

#### Implementation:
```javascript
// EndpointPageClient.js
// Remove: keys.forEach(key => fetchKeyQuota(key.id))

// Add expand/hover trigger
<div 
  onMouseEnter={() => !keyQuotas[key.id] && fetchKeyQuota(key.id)}
  onClick={() => !keyQuotas[key.id] && fetchKeyQuota(key.id)}
>
  {/* Credit bar - show spinner until loaded */}
</div>
```

#### Benefits:
- **Initial Load**: 0 quota fetches (instant page render)
- **Load on Demand**: Only fetch what user views
- **Perceived Performance**: Page feels fast

#### Tradeoffs:
- Credit bars show "loading" until hovered
- UX change (user expects immediate data)

---

### Solution 5: Database-Level Aggregation (LONG-TERM)

**Approach**: Store pre-computed aggregates in `apiKeys` table

#### Schema Change:
```sql
-- Add to apiKeys table
ALTER TABLE apiKeys ADD COLUMN allocatedCreditUsed INTEGER DEFAULT 0;
ALTER TABLE apiKeys ADD COLUMN allocatedCreditTotal INTEGER DEFAULT 0;
ALTER TABLE apiKeys ADD COLUMN lastQuotaSync TEXT;
```

#### Update Logic:
```javascript
// When connection quota updates (webhook/polling)
async function syncApiKeyQuotas(apiKeyId) {
  const connections = await getProviderConnections({ assignedToApiKeyId: apiKeyId });
  
  let totalUsed = 0, totalLimit = 0;
  for (const conn of connections) {
    const quota = await getCachedQuota(conn.id);
    totalUsed += quota?.used || 0;
    totalLimit += quota?.total || 0;
  }
  
  await updateApiKey(apiKeyId, {
    allocatedCreditUsed: totalUsed,
    allocatedCreditTotal: totalLimit,
    lastQuotaSync: new Date().toISOString()
  });
}
```

#### Read Path:
```javascript
// EndpointPageClient.js
const fetchData = async () => {
  const keysRes = await fetch("/api/keys"); // Already includes credit fields
  const keys = keysData.keys || [];
  
  // No separate quota fetch needed!
  keys.forEach(key => {
    setKeyQuotas(prev => ({
      ...prev,
      [key.id]: {
        used: key.allocatedCreditUsed,
        total: key.allocatedCreditTotal,
        loading: false
      }
    }));
  });
};
```

#### Benefits:
- **Read Performance**: O(1) - just query `apiKeys` table
- **Network Calls**: 1 (just `/api/keys`)
- **Load Time**: <500ms
- **Scalability**: Works with 10k+ connections

#### Tradeoffs:
- Write amplification (update on every quota change)
- Eventual consistency (sync lag)
- More complex: need background job to keep fresh
- Add when: >1k connections or real-time not required

---

## Implementation Roadmap

### Phase 1: Quick Wins (1-2 hours)
1. **Hoist connections fetch** (Solution 2)
   - Modify `EndpointPageClient.js` lines 287-301
   - Test with 2k connections
   - Expected improvement: 20s → 18s

### Phase 2: Batch Aggregation (4-6 hours)
2. **Create `/api/keys/credits` endpoint** (Solution 1)
   - New file: `src/app/api/keys/credits/route.js`
   - Update `EndpointPageClient.js` to use batch endpoint
   - Add localStorage caching (5min TTL)
   - Test with 2k connections
   - Expected improvement: 18s → 2s

### Phase 3: Caching Layer (1-2 days)
3. **Add Redis cache** (Solution 3)
   - Install Redis (optional dependency)
   - Create `src/lib/cache/quotaCache.js`
   - Update `/api/usage/[connectionId]` to use cache
   - Monitor cache hit rate
   - Expected improvement: 2s → <1s (cached), reduce external API calls 90%

### Phase 4: Database Optimization (3-5 days)
4. **Materialized aggregates** (Solution 5)
   - Add columns to `apiKeys` table (schema version bump)
   - Background job to sync quotas (cron/webhook)
   - Update read path to use pre-computed values
   - Expected improvement: <1s → <500ms

---

## Recommended Immediate Action

**Start with Phase 1 + Phase 2**:

1. **Hoist connections fetch** → immediate 10% improvement, 30 min work
2. **Batch aggregation endpoint** → 90% improvement, 4 hours work

**Total effort**: ~5 hours  
**Expected result**: 25s → <2s load time

Phase 3 (Redis) and Phase 4 (materialized views) are **optional** - add only if:
- User base grows >100 API keys
- External API rate limits become issue
- Need <1s load time guarantee

---

## Testing Strategy

### Performance Benchmark Script:
```javascript
// tests/performance/quota-loading.test.js
async function benchmarkQuotaLoading(numKeys, numConnectionsPerKey) {
  const start = Date.now();
  
  // Simulate current approach
  for (let i = 0; i < numKeys; i++) {
    const conns = await fetch('/api/connections?isActive=true');
    const allocated = conns.filter(c => c.assignedToApiKeyId === keyIds[i]);
    
    await Promise.all(
      allocated.map(c => fetch(`/api/usage/${c.id}`))
    );
  }
  
  const elapsed = Date.now() - start;
  console.log(`Current: ${elapsed}ms`);
  
  // Compare with batch endpoint
  const start2 = Date.now();
  await fetch('/api/keys/credits');
  const elapsed2 = Date.now() - start2;
  console.log(`Batch: ${elapsed2}ms`);
  
  console.log(`Improvement: ${((elapsed - elapsed2) / elapsed * 100).toFixed(1)}%`);
}

// Run: benchmarkQuotaLoading(10, 50)
```

### Regression Tests:
```javascript
// Ensure aggregated data matches individual fetches
test('batch credits match individual quota fetches', async () => {
  const batchRes = await fetch('/api/keys/credits');
  const batch = await batchRes.json();
  
  for (const keyId of Object.keys(batch)) {
    const manualTotal = await computeManualTotal(keyId);
    expect(batch[keyId].used).toBeCloseTo(manualTotal.used, 0);
    expect(batch[keyId].total).toBeCloseTo(manualTotal.total, 0);
  }
});
```

---

## Monitoring & Metrics

Track these metrics post-deployment:

1. **Page Load Time**:
   - Target: <2s for `/dashboard/endpoint`
   - Measure: `performance.timing.loadEventEnd - navigationStart`

2. **API Response Time**:
   - `/api/keys/credits`: <500ms
   - `/api/usage/[id]`: <2s (with cache), <5s (without)

3. **Cache Hit Rate** (if Redis implemented):
   - Target: >80%
   - Alert if: <60% (indicates cache TTL too short or high write rate)

4. **External API Calls**:
   - Current: 500+ per page load
   - Target: <50 per page load
   - Alert if: >100 (cache miss spike)

---

## Conclusion

Root cause: **N+1 query + serial external API calls**

Best fix: **Server-side batch aggregation** (Solution 1 + 2)
- 1 HTTP call instead of 511
- <2s load time instead of 25s+
- Works today, scales to 10k+ connections

Next-level: **Redis cache** (Solution 3)
- 90% cache hit rate
- <1s load time
- Reduces provider API load

Future-proof: **Materialized aggregates** (Solution 5)
- <500ms load time
- Zero external calls on read
- Requires background sync job

**Implementation priority**: Phase 1 + 2 now, Phase 3 when >500 connections, Phase 4 when >5k connections.
