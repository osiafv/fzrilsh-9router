/**
 * CodeBuddy AI (International) usage handler
 *
 * Scoped to the "codebuddy-int" provider specifically — international version.
 *
 * Quota lives behind WorkBuddy billing endpoint. Response structure is similar
 * to codebuddy-cn (Tencent billing format) with nested data.Response.Data.Accounts[].
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { parseResetTime } from "./shared.js";

const PROVIDER_ID = "codebuddy-int";
const USAGE_URL = "https://www.workbuddy.ai/billing/meter/get-user-resource";

// Prefer the *Precise string fields (exact), fall back to the numeric ones.
function num(precise, plain) {
  const n = Number(precise ?? plain);
  return Number.isFinite(n) ? n : 0;
}

export async function getCodeBuddyIntUsage(accessToken, apiKey, providerSpecificData, proxyOptions = null) {
  const token = accessToken || apiKey;
  if (!token) {
    return { message: "CodeBuddy AI credential not available." };
  }

  try {
    const body = {
      PageNumber: 1,
      PageSize: 200,
      ProductCode: "p_tcaca",
      Status: [0, 3],
      PackageCodes: [
        "TCACA_code_001_PqouKr6QWV",
        "TCACA_code_002_AkiJS3ZHF5",
        "TCACA_code_006_DbXS0lrypC",
        "TCACA_code_007_nzdH5h4Nl0",
        "TCACA_code_003_FAnt7lcmRT",
        "TCACA_code_008_cfWoLwvjU4",
        "TCACA_code_009_0XmEQc2xOf",
      ],
      PackageEndTimeRangeBegin: "2026-01-01 00:00:00",
      PackageEndTimeRangeEnd: "2127-12-31 23:59:59",
    };

    const res = await proxyAwareFetch(USAGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }, proxyOptions);

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      return { message: `WorkBuddy billing API error: ${res.status} ${errorText.slice(0, 200)}` };
    }

    const data = await res.json();
    if (data.code !== 0) {
      return { message: `WorkBuddy billing error: ${data.msg || "Unknown error"}` };
    }

    const accounts = data?.data?.Response?.Data?.Accounts || [];
    if (accounts.length === 0) {
      return { message: "No active packages found", quotas: {} };
    }

    // Aggregate all packages into a single credit quota
    let totalUsed = 0;
    let totalRemaining = 0;
    let totalSize = 0;
    let earliestResetAt = null;
    let planName = "CodeBuddy AI";

    for (const acc of accounts) {
      const remain = num(acc.CapacityRemainPrecise, acc.CapacityRemain);
      const used = num(acc.CapacityUsedPrecise, acc.CapacityUsed);
      const size = num(acc.CapacitySizePrecise, acc.CapacitySize);

      totalUsed += used;
      totalRemaining += remain;
      totalSize += size;

      // Use CycleEndTime for resetAt
      const cycleEnd = parseResetTime(acc.CycleEndTime);
      if (cycleEnd) {
        const cycleEndDate = new Date(cycleEnd);
        if (!earliestResetAt || cycleEndDate < new Date(earliestResetAt)) {
          earliestResetAt = cycleEnd;
        }
      }

      // Use the first package name as the plan name
      if (acc.PackageName && planName === "CodeBuddy AI") {
        planName = acc.PackageName;
      }
    }

    return {
      plan: planName,
      quotas: {
        credit: {
          used: totalUsed,
          total: totalSize,
          remaining: totalRemaining,
          resetAt: earliestResetAt ? new Date(earliestResetAt).toISOString() : null,
          unlimited: false,
        },
      },
    };
  } catch (err) {
    return { message: `Failed to fetch WorkBuddy usage: ${err.message}`, quotas: {} };
  }
}
