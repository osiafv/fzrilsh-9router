"use client";

import { useState, useEffect } from "react";
import Card from "@/shared/components/Card";
import QuotaProgressBar from "../../usage/components/ProviderLimits/QuotaProgressBar";
import { parseQuotaData, calculatePercentage } from "../../usage/components/ProviderLimits/utils";

export default function ProviderQuotaCard({ providerId }) {
  const [quotaData, setQuotaData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchQuota = async () => {
    try {
      setLoading(true);
      setError(null);

      const connectionsRes = await fetch(`/api/providers/client?provider=${providerId}`);
      if (!connectionsRes.ok) {
        throw new Error("Failed to fetch connections");
      }

      const connectionsData = await connectionsRes.json();
      const providerConnections = (connectionsData.connections || []).filter(
        (c) => c.isActive !== false
      );

      if (providerConnections.length === 0) {
        setQuotaData({ message: "No active connections for this provider" });
        return;
      }

      const allQuotas = [];

      for (const connection of providerConnections) {
        try {
          const quotaRes = await fetch(`/api/usage/${connection.id}`);
          
          if (!quotaRes.ok) {
            if (quotaRes.status === 404) continue;
            console.warn(`Failed to fetch quota for connection ${connection.id}:`, quotaRes.status);
            continue;
          }

          const data = await quotaRes.json();
          if (data.message) continue;

          const parsed = parseQuotaData(providerId, data);
          
          if (parsed && parsed.length > 0) {
            allQuotas.push({
              connection,
              quotas: parsed,
            });
          }
        } catch (err) {
          console.warn(`Error fetching quota for connection ${connection.id}:`, err);
        }
      }
      
      if (allQuotas.length === 0) {
        setQuotaData({ message: "No quota data available for this provider" });
        return;
      }
      
      setQuotaData({ connections: allQuotas });
    } catch (err) {
      console.error("Error fetching quota:", err);
      setError(err.message || "Failed to load quota data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuota();
  }, [providerId]);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await fetchQuota();
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <Card padding="md" className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Quota Status</h2>
          <span className="material-symbols-outlined text-[20px] text-text-muted animate-spin">
            refresh
          </span>
        </div>
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="h-4 bg-black/5 dark:bg-white/5 rounded animate-pulse" />
            <div className="h-2 bg-black/5 dark:bg-white/5 rounded animate-pulse" />
          </div>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card padding="md" className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Quota Status</h2>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
            title="Refresh quota"
          >
            <span
              className={`material-symbols-outlined text-[20px] text-text-muted ${
                refreshing ? "animate-spin" : ""
              }`}
            >
              refresh
            </span>
          </button>
        </div>
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
          <div className="flex items-start gap-2">
            <span className="material-symbols-outlined text-red-500 text-[20px]">
              error
            </span>
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        </div>
      </Card>
    );
  }

  if (quotaData?.message) {
    return (
      <Card padding="md" className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Quota Status</h2>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
            title="Refresh quota"
          >
            <span
              className={`material-symbols-outlined text-[20px] text-text-muted ${
                refreshing ? "animate-spin" : ""
              }`}
            >
              refresh
            </span>
          </button>
        </div>
        <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <div className="flex items-start gap-2">
            <span className="material-symbols-outlined text-blue-500 text-[20px]">
              info
            </span>
            <p className="text-sm text-blue-600 dark:text-blue-400">
              {quotaData.message}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  if (!quotaData?.connections || quotaData.connections.length === 0) {
    return null;
  }

  return (
    <Card padding="md" className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Quota Status</h2>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
          title="Refresh quota"
        >
          <span
            className={`material-symbols-outlined text-[20px] text-text-muted ${
              refreshing ? "animate-spin" : ""
            }`}
          >
            refresh
          </span>
        </button>
      </div>

      <div className="space-y-6">
        {quotaData.connections.map((item, connIndex) => {
          const connection = item.connection;
          const connectionLabel = connection.name || connection.email || connection.displayName || `Connection ${connIndex + 1}`;
          
          return (
            <div key={connection.id} className="space-y-3">
              {quotaData.connections.length > 1 && (
                <div className="flex items-center gap-2 text-sm text-text-muted">
                  <span className="material-symbols-outlined text-[16px]">account_circle</span>
                  <span className="font-medium">{connectionLabel}</span>
                </div>
              )}
              <div className="space-y-4">
                {item.quotas.map((quota, quotaIndex) => {
                  const percentage = calculatePercentage(quota.used, quota.total);
                  const unlimited = quota.total === 0 || quota.total === null;

                  return (
                    <QuotaProgressBar
                      key={`${connection.id}-${quota.name}-${quotaIndex}`}
                      label={quota.name}
                      used={quota.used}
                      total={quota.total}
                      percentage={percentage}
                      unlimited={unlimited}
                      resetTime={quota.resetAt}
                      recurring={quota.recurring !== false}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
