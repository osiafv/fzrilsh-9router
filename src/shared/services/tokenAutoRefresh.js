// Token Auto-Refresh Service: proactively refresh OAuth tokens before expiry
import cron from "node-cron";
import { getSettings, updateSettings, getProviderConnections, updateProviderConnection } from "@/lib/localDb";
import { refreshProviderCredentials, shouldRefreshCredentials } from "open-sse/services/oauthCredentialManager.js";

// Refresh threshold: 20% of token lifetime remaining
const REFRESH_THRESHOLD_PERCENT = 0.2;

// Assume 1 hour lifetime for tokens without expiry
const ASSUMED_LIFETIME_MS = 3600000; // 1 hour

// Batching: process 10% of accounts per tick
const BATCH_PERCENT = 0.1;

// Rate limiting: delay between individual refreshes
const REFRESH_DELAY_MS = 100;

// Survive Next.js hot reload
const g = global.__tokenAutoRefresh ??= {
  cronJob: null,
  running: false,
};

/**
 * Calculate if a connection needs refresh based on 20% threshold
 * - With expiresAt: refresh when 20% lifetime remaining
 * - No expiresAt: assume 1h lifetime, refresh after 48 minutes (80% of 1h)
 */
function needsRefresh(connection, nowMs = Date.now()) {
  if (!connection.refreshToken) return false;

  const expiresAt = connection.expiresAt || connection.tokenExpiresAt;
  
  if (expiresAt) {
    // Case 1: Has expiry time → calculate 20% threshold
    const expiresAtMs = new Date(expiresAt).getTime();
    if (!Number.isFinite(expiresAtMs)) return false;
    
    // Calculate token lifetime and threshold
    const lastRefreshAt = connection.lastRefreshAt || connection.updatedAt || connection.createdAt;
    const lastRefreshMs = new Date(lastRefreshAt).getTime();
    
    if (!Number.isFinite(lastRefreshMs)) {
      // Can't determine lifetime, use simple threshold
      return nowMs >= expiresAtMs - (ASSUMED_LIFETIME_MS * REFRESH_THRESHOLD_PERCENT);
    }
    
    const lifetime = expiresAtMs - lastRefreshMs;
    const threshold = lifetime * REFRESH_THRESHOLD_PERCENT;
    
    // Refresh when remaining time <= 20% of lifetime
    return nowMs >= expiresAtMs - threshold;
  } else {
    // Case 2: No expiresAt → assume 1h lifetime, apply 20% threshold
    // Refresh after 48 minutes (80% of 1h = 20% buffer remaining)
    const lastRefreshAt = connection.lastRefreshAt || connection.updatedAt || connection.createdAt;
    const lastRefreshMs = new Date(lastRefreshAt).getTime();
    
    if (!Number.isFinite(lastRefreshMs)) return false;
    
    const timeSinceRefresh = nowMs - lastRefreshMs;
    return timeSinceRefresh > (ASSUMED_LIFETIME_MS * (1 - REFRESH_THRESHOLD_PERCENT));
  }
}

/**
 * Calculate urgency score (lower = more urgent)
 * Accounts closest to expiry are processed first
 */
function getUrgencyScore(connection, nowMs = Date.now()) {
  const expiresAt = connection.expiresAt || connection.tokenExpiresAt;
  
  if (expiresAt) {
    const expiresAtMs = new Date(expiresAt).getTime();
    if (Number.isFinite(expiresAtMs)) {
      return expiresAtMs - nowMs; // Lower = expires sooner
    }
  }
  
  // No expiry → use time since last refresh
  const lastRefreshAt = connection.lastRefreshAt || connection.updatedAt || connection.createdAt;
  const lastRefreshMs = new Date(lastRefreshAt).getTime();
  
  if (Number.isFinite(lastRefreshMs)) {
    return -(nowMs - lastRefreshMs); // Negative = older refresh = more urgent
  }
  
  return 0;
}

/**
 * Refresh a single connection
 */
async function refreshConnection(connection) {
  try {
    const refreshed = await refreshProviderCredentials(
      connection.provider,
      connection,
      console
    );
    
    if (!refreshed || typeof refreshed !== "object") {
      return { success: false, error: "No refreshed credentials returned" };
    }
    
    // Check for unrecoverable errors (token structure from oauthCredentialManager)
    if (refreshed.error && refreshed.unrecoverable) {
      return { success: false, error: refreshed.error, unrecoverable: true };
    }
    
    // Update connection with new tokens
    const updates = {
      ...refreshed,
      lastRefreshAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    await updateProviderConnection(connection.id, updates);
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Main tick function - called every 10 minutes by cron
 */
export async function runTokenAutoRefreshTick() {
  if (g.running) {
    console.log("[TokenAutoRefresh] Previous tick still running, skipping");
    return;
  }
  
  g.running = true;
  
  const stats = {
    accountsChecked: 0,
    accountsRefreshed: 0,
    successCount: 0,
    failureCount: 0,
  };
  
  try {
    // Check if service is enabled
    const settings = await getSettings();
    if (!settings.tokenAutoRefresh?.enabled) {
      console.log("[TokenAutoRefresh] Service disabled, skipping tick");
      return;
    }
    
    // Get all OAuth connections with refresh tokens
    const allConnections = await getProviderConnections();
    const oauthConnections = allConnections.filter(
      c => c.authType === "oauth" && c.refreshToken && c.isActive !== false
    );
    
    stats.accountsChecked = oauthConnections.length;
    
    if (oauthConnections.length === 0) {
      console.log("[TokenAutoRefresh] No OAuth connections found");
      await updateSettings({
        tokenAutoRefresh: {
          ...settings.tokenAutoRefresh,
          lastRunAt: new Date().toISOString(),
          lastRunStats: stats,
        },
      });
      return;
    }
    
    // Filter connections needing refresh
    const nowMs = Date.now();
    const needingRefresh = oauthConnections.filter(c => needsRefresh(c, nowMs));
    
    if (needingRefresh.length === 0) {
      console.log(`[TokenAutoRefresh] Checked ${stats.accountsChecked} accounts, none need refresh`);
      await updateSettings({
        tokenAutoRefresh: {
          ...settings.tokenAutoRefresh,
          lastRunAt: new Date().toISOString(),
          lastRunStats: stats,
        },
      });
      return;
    }
    
    // Sort by urgency (most urgent first)
    needingRefresh.sort((a, b) => getUrgencyScore(a, nowMs) - getUrgencyScore(b, nowMs));
    
    // Take 10% batch
    const batchSize = Math.max(1, Math.ceil(needingRefresh.length * BATCH_PERCENT));
    const batch = needingRefresh.slice(0, batchSize);
    
    console.log(
      `[TokenAutoRefresh] Processing ${batch.length} of ${needingRefresh.length} accounts needing refresh (${stats.accountsChecked} total)`
    );
    
    // Process batch with delays
    for (const connection of batch) {
      stats.accountsRefreshed++;
      
      const result = await refreshConnection(connection);
      
      if (result.success) {
        stats.successCount++;
        console.log(`[TokenAutoRefresh] ✓ ${connection.provider}:${connection.id} (${connection.email || connection.name || "unknown"})`);
      } else {
        stats.failureCount++;
        console.warn(
          `[TokenAutoRefresh] ✗ ${connection.provider}:${connection.id} (${connection.email || connection.name || "unknown"}): ${result.error}`
        );
      }
      
      // Rate limiting: delay between refreshes
      if (batch.length > 1) {
        await new Promise(resolve => setTimeout(resolve, REFRESH_DELAY_MS));
      }
    }
    
    console.log(
      `[TokenAutoRefresh] Tick complete: ${stats.successCount} succeeded, ${stats.failureCount} failed`
    );
    
    // Update settings with stats
    await updateSettings({
      tokenAutoRefresh: {
        ...settings.tokenAutoRefresh,
        lastRunAt: new Date().toISOString(),
        lastRunStats: stats,
      },
    });
  } catch (error) {
    console.error("[TokenAutoRefresh] Tick error:", error.message || String(error));
    
    // Still update stats on error
    try {
      const settings = await getSettings();
      await updateSettings({
        tokenAutoRefresh: {
          ...settings.tokenAutoRefresh,
          lastRunAt: new Date().toISOString(),
          lastRunStats: stats,
        },
      });
    } catch (updateError) {
      console.error("[TokenAutoRefresh] Failed to update stats:", updateError.message);
    }
  } finally {
    g.running = false;
  }
}

/**
 * Start the token auto-refresh scheduler
 * Runs every 10 minutes at :00, :10, :20, :30, :40, :50
 */
export function startTokenAutoRefresh() {
  if (g.cronJob) {
    console.log("[TokenAutoRefresh] Scheduler already running");
    return;
  }
  
  console.log("[TokenAutoRefresh] Starting scheduler (every 10 minutes)");
  
  // Schedule: */10 * * * * = every 10 minutes at :00, :10, :20, :30, :40, :50
  g.cronJob = cron.schedule("*/10 * * * *", () => {
    runTokenAutoRefreshTick().catch(error => {
      console.error("[TokenAutoRefresh] Cron tick failed:", error.message || String(error));
    });
  });
  
  // Run first tick immediately (don't wait 10 minutes)
  runTokenAutoRefreshTick().catch(error => {
    console.error("[TokenAutoRefresh] Initial tick failed:", error.message || String(error));
  });
}

/**
 * Stop the token auto-refresh scheduler (for testing/cleanup)
 */
export function stopTokenAutoRefresh() {
  if (g.cronJob) {
    g.cronJob.stop();
    g.cronJob = null;
    console.log("[TokenAutoRefresh] Scheduler stopped");
  }
}
