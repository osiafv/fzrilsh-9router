import { NextResponse } from "next/server";
import { getProviderConnections, getAvailableConnectionsForApiKey } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// GET /api/connections/available?apiKeyId=xxx
// Returns connections available for allocation to a specific API key
// (unassigned connections + connections already assigned to this key)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const apiKeyId = searchParams.get("apiKeyId");

    let connections;
    if (apiKeyId) {
      // Get connections available for this specific API key
      connections = await getAvailableConnectionsForApiKey(apiKeyId, { isActive: true });
    } else {
      // Get all unassigned connections
      connections = await getProviderConnections({ isActive: true, assignedToApiKeyId: null });
    }

    // Group by provider for easier UI rendering
    const grouped = connections.reduce((acc, conn) => {
      if (!acc[conn.provider]) acc[conn.provider] = [];
      acc[conn.provider].push({
        id: conn.id,
        provider: conn.provider,
        name: conn.name || conn.email || conn.id,
        displayName: conn.displayName || conn.name || conn.email || conn.id,
        email: conn.email,
        authType: conn.authType,
        assignedToApiKeyId: conn.assignedToApiKeyId,
      });
      return acc;
    }, {});

    return NextResponse.json({ connections, grouped });
  } catch (error) {
    console.log("Error fetching available connections:", error);
    return NextResponse.json(
      { error: "Failed to fetch connections" },
      { status: 500 }
    );
  }
}
