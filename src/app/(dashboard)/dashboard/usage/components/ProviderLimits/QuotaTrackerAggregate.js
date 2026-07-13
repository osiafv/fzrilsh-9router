"use client";

import PropTypes from "prop-types";
import Card from "@/shared/components/Card";
import ProviderIcon from "@/shared/components/ProviderIcon";

function formatNumber(num) {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toFixed(0);
}

function formatResourceLabel(resourceType) {
  // Handle special cases
  const specialLabels = {
    "0": "Credit",
    "agentic_request": "Agentic Request",
    "code_completion": "Code Completion",
    "code_scan": "Code Scan",
    "chat": "Chat",
  };

  if (specialLabels[resourceType]) {
    return specialLabels[resourceType];
  }

  // Default: replace underscores with spaces and title case
  return resourceType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function ProgressBar({ used, total, label, unlimited }) {
  if (unlimited) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-medium text-text-main">{label}</span>
          <span className="text-xs text-text-muted">Unlimited</span>
        </div>
        <div className="h-2 w-full rounded-full bg-green-500/20">
          <div className="h-full w-full rounded-full bg-green-500" />
        </div>
      </div>
    );
  }

  const percentage = total > 0 ? (used / total) * 100 : 0;
  const remaining = Math.max(0, total - used);

  let barColor = "bg-green-500";
  if (percentage >= 90) barColor = "bg-red-500";
  else if (percentage >= 70) barColor = "bg-amber-500";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-text-main truncate">{label}</span>
        <div className="flex items-baseline gap-2 text-xs shrink-0">
          <span className="text-text-muted">{formatNumber(used)} / {formatNumber(total)}</span>
          <span className={`font-medium ${percentage >= 90 ? "text-red-500" : percentage >= 70 ? "text-amber-500" : "text-green-500"}`}>
            {percentage.toFixed(1)}%
          </span>
        </div>
      </div>
      <div className="h-2 w-full rounded-full bg-black/5 dark:bg-white/5">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${Math.min(100, percentage)}%` }}
        />
      </div>
      <div className="flex justify-between text-[11px] text-text-muted">
        <span>Used: {formatNumber(used)}</span>
        <span>Remaining: {formatNumber(remaining)}</span>
      </div>
    </div>
  );
}

ProgressBar.propTypes = {
  used: PropTypes.number.isRequired,
  total: PropTypes.number.isRequired,
  label: PropTypes.string.isRequired,
  unlimited: PropTypes.bool,
};

export default function QuotaTrackerAggregate({ connections, quotaData, providerFilter }) {
  // Group connections by provider
  const providerGroups = {};

  connections.forEach(conn => {
    const provider = conn.provider;
    if (!providerGroups[provider]) {
      providerGroups[provider] = {
        connections: [],
        quotas: {},
      };
    }
    providerGroups[provider].connections.push(conn);
  });

  // Aggregate quota per provider
  Object.entries(providerGroups).forEach(([provider, group]) => {
    const resourceAggregates = {};

    group.connections.forEach(conn => {
      const quota = quotaData[conn.id];
      if (!quota?.quotas) return;

      Object.entries(quota.quotas).forEach(([resourceType, resourceQuota]) => {
        if (!resourceAggregates[resourceType]) {
          resourceAggregates[resourceType] = {
            used: 0,
            total: 0,
            unlimited: resourceQuota.unlimited || false,
            count: 0,
          };
        }

        if (!resourceQuota.unlimited) {
          resourceAggregates[resourceType].used += resourceQuota.used || 0;
          resourceAggregates[resourceType].total += resourceQuota.total || 0;
        }
        resourceAggregates[resourceType].count += 1;
      });
    });

    providerGroups[provider].quotas = resourceAggregates;
  });

  // Filter out providers with no quota data
  const providersWithQuota = Object.entries(providerGroups).filter(
    ([, group]) => Object.keys(group.quotas).length > 0
  );

  if (providersWithQuota.length === 0) {
    return null; // No quota data to show
  }

  // Adjust grid columns based on number of providers
  let gridClass = "grid gap-4";
  if (providersWithQuota.length === 1) {
    gridClass += " grid-cols-1"; // Full width for single provider
  } else if (providersWithQuota.length === 2) {
    gridClass += " grid-cols-1 lg:grid-cols-2"; // 2 columns on large screens
  } else {
    gridClass += " grid-cols-1 lg:grid-cols-2 xl:grid-cols-3"; // 3 columns on xl screens
  }

  return (
    <div className={gridClass}>
      {providersWithQuota.map(([provider, group]) => {
        const totalConnections = group.connections.length;
        const connectionsWithQuota = group.connections.filter(
          conn => quotaData[conn.id]?.quotas && Object.keys(quotaData[conn.id].quotas).length > 0
        ).length;

        return (
          <Card key={provider}>
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ProviderIcon
                    src={`/providers/${provider}.png`}
                    alt={provider}
                    size={24}
                    className="size-6 rounded object-contain"
                    fallbackText={provider.slice(0, 2).toUpperCase()}
                  />
                  <h3 className="text-sm font-semibold text-text-main capitalize">{provider}</h3>
                </div>
                <div className="flex items-center gap-3 text-xs text-text-muted">
                  <span>{connectionsWithQuota} / {totalConnections} connections</span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4">
                {Object.entries(group.quotas).map(([resourceType, data]) => (
                  <ProgressBar
                    key={resourceType}
                    label={formatResourceLabel(resourceType)}
                    used={data.used}
                    total={data.total}
                    unlimited={data.unlimited}
                  />
                ))}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

QuotaTrackerAggregate.propTypes = {
  connections: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      provider: PropTypes.string.isRequired,
    })
  ).isRequired,
  quotaData: PropTypes.object.isRequired,
  providerFilter: PropTypes.string,
};
