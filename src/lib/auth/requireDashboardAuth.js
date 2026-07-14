/**
 * Dashboard API Authentication Helper
 *
 * Checks if the request has valid dashboard authentication.
 * Respects the requireLogin setting for local development.
 */

import { cookies } from "next/headers";
import { getDashboardAuthSession } from "./dashboardSession.js";
import { getSettings } from "@/lib/localDb";

/**
 * Check if request is authenticated for dashboard API access
 * @param {Request} request - Next.js request object (optional, currently unused but kept for future use)
 * @returns {Promise<boolean>} - true if authenticated or auth disabled, false otherwise
 */
export async function requireDashboardAuth(request) {
  try {
    const settings = await getSettings();
    const requireLogin = settings.requireLogin !== false;

    // If requireLogin is false, allow access (local development mode)
    if (!requireLogin) {
      return true;
    }

    // Check for valid auth_token cookie and session
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value;
    const session = await getDashboardAuthSession(token);

    // Session must exist and be authenticated
    if (!session || !session.authenticated) {
      return false;
    }

    return true;
  } catch (error) {
    console.error("Auth check failed:", error);
    return false;
  }
}

/**
 * Helper to return 401 Unauthorized response
 */
export function unauthorizedResponse() {
  return new Response(
    JSON.stringify({ error: "Unauthorized - Dashboard authentication required" }),
    {
      status: 401,
      headers: { "Content-Type": "application/json" }
    }
  );
}
