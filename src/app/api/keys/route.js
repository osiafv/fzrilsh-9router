import { NextResponse } from "next/server";
import { getApiKeys, createApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";

export const dynamic = "force-dynamic";

// GET /api/keys - List API keys
export async function GET() {
  try {
    const keys = await getApiKeys();
    return NextResponse.json({ keys });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request) {
  try {
    const body = await request.json();
    const {
      name,
      tokenLimit,
      requestLimit,
      resetPeriod,
      customResetDays,
      scopeType,
      allowedModels,
      allowedCombos,
    } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();

    const options = {
      tokenLimit: tokenLimit !== undefined ? tokenLimit : null,
      requestLimit: requestLimit !== undefined ? requestLimit : null,
      resetPeriod: resetPeriod || 'monthly',
      customResetDays: customResetDays || null,
      scopeType: scopeType || 'global',
      allowedModels: allowedModels || null,
      allowedCombos: allowedCombos || null,
    };

    const apiKey = await createApiKey(name, machineId, options);

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
      tokenLimit: apiKey.tokenLimit,
      requestLimit: apiKey.requestLimit,
      tokensUsed: apiKey.tokensUsed,
      requestsUsed: apiKey.requestsUsed,
      resetPeriod: apiKey.resetPeriod,
      customResetDays: apiKey.customResetDays,
      resetAt: apiKey.resetAt,
      scopeType: apiKey.scopeType,
      allowedModels: apiKey.allowedModels,
      allowedCombos: apiKey.allowedCombos,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
