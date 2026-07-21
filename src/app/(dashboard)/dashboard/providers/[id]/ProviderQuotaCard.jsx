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

      const connectionsRes = await fetch("/api/connections");
      if (!connectionsRes.ok) {
        throw new Error("Failed to fetch connections");
      }

      const connectionsData = await connectionsRes.json();
      const providerConnections = connectionsData.connections.filter(
        (c) => c.provider === providerId && c.isActive !== false
      );

      if (providerConnections.length === 0) {
        setQuotaData({ message: "No active connections for this provider" });
        return;
      }

      const quotaRes = await fetch(
        `/api/usage/${providerConnections[0].id}`
      );

      if (!quotaRes.ok) {
        if (quotaRes.status === 404) {
          setQuotaData({ message: "Quota tracking not available for this provider" });
          return;
        }
        throw new Error(`Failed to fetch quota: ${quotaRes.status}`);
      }

      const data = await quotaRes.json();
      const parsed = parseQuotaData(providerId, data);
      
      if (!parsed || parsed.length === 0) {
        setQuotaData({ message: "No quota data available for this provider" });
        return;
      }
      
      setQuotaData({ quotas: parsed });
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

  if (!quotaData?.quotas || quotaData.quotas.length === 0) {
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

      <div className="space-y-4">
        {quotaData.quotas.map((quota, index) => {
          const percentage = calculatePercentage(quota.used, quota.total);
          const unlimited = quota.total === 0 || quota.total === null;

          return (
            <QuotaProgressBar
              key={`${quota.name}-${index}`}
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
    </Card>
  );
}
