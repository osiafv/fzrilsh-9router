import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, updateApiKey } from "@/lib/localDb";
import { requireDashboardAuth, unauthorizedResponse } from "@/lib/auth/requireDashboardAuth";

// GET /api/keys/[id] - Get single key
export async function GET(request, { params }) {
  const isAuthenticated = await requireDashboardAuth(request);
  if (!isAuthenticated) {
    return unauthorizedResponse();
  }

  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    return NextResponse.json({ key });
  } catch (error) {
    console.log("Error fetching key:", error);
    return NextResponse.json({ error: "Failed to fetch key" }, { status: 500 });
  }
}

// PUT /api/keys/[id] - Update key
export async function PUT(request, { params }) {
  const isAuthenticated = await requireDashboardAuth(request);
  if (!isAuthenticated) {
    return unauthorizedResponse();
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const {
      name,
      isActive,
      tokenLimit,
      requestLimit,
      tokensUsed,
      requestsUsed,
      resetPeriod,
      customResetDays,
      scopeType,
      allowedModels,
      allowedCombos,
    } = body;

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (tokenLimit !== undefined) updateData.tokenLimit = tokenLimit;
    if (requestLimit !== undefined) updateData.requestLimit = requestLimit;
    if (tokensUsed !== undefined) updateData.tokensUsed = tokensUsed;
    if (requestsUsed !== undefined) updateData.requestsUsed = requestsUsed;
    if (resetPeriod !== undefined) updateData.resetPeriod = resetPeriod;
    if (customResetDays !== undefined) updateData.customResetDays = customResetDays;
    if (scopeType !== undefined) updateData.scopeType = scopeType;
    if (allowedModels !== undefined) updateData.allowedModels = allowedModels;
    if (allowedCombos !== undefined) updateData.allowedCombos = allowedCombos;

    const updated = await updateApiKey(id, updateData);

    return NextResponse.json({ key: updated });
  } catch (error) {
    console.log("Error updating key:", error);
    return NextResponse.json({ error: "Failed to update key" }, { status: 500 });
  }
}

// DELETE /api/keys/[id] - Delete API key
export async function DELETE(request, { params }) {
  const isAuthenticated = await requireDashboardAuth(request);
  if (!isAuthenticated) {
    return unauthorizedResponse();
  }

  try {
    const { id } = await params;

    const deleted = await deleteApiKey(id);
    if (!deleted) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Key deleted successfully" });
  } catch (error) {
    console.log("Error deleting key:", error);
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}
