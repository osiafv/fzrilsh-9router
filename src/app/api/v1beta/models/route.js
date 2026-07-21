import { PROVIDER_MODELS } from "@/shared/constants/models";
import { getApiKeyRecord } from "@/sse/services/apiKeyLimits.js";

/**
 * Extract API key from request headers
 */
function extractApiKey(request) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  const apiKeyHeader = request.headers.get("x-api-key");
  if (apiKeyHeader) return apiKeyHeader;
  const googleApiKeyHeader = request.headers.get("x-goog-api-key");
  if (googleApiKeyHeader) return googleApiKeyHeader;
  const url = new URL(request.url);
  return url.searchParams.get("key") || null;
}

/**
 * Check if a Gemini-format model is allowed by API key restrictions
 */
function isModelAllowed(modelName, allowedModels) {
  if (allowedModels.length === 0) return true;

  if (allowedModels.includes(modelName)) return true;

  const match = modelName.match(/^models\/(.+)$/);
  if (match) {
    const path = match[1];
    if (allowedModels.includes(path)) return true;

    const parts = path.split('/');
    if (parts.length === 2) {
      const [provider, modelId] = parts;
      if (allowedModels.includes(modelId)) return true;
      if (allowedModels.includes(`${provider}/${modelId}`)) return true;
    } else if (parts.length === 1) {
      if (allowedModels.includes(parts[0])) return true;
    }
  }

  return false;
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * GET /v1beta/models - Gemini compatible models list
 * Returns models in Gemini API format
 * Filters by API key restrictions if present.
 */
export async function GET(request) {
  try {
    const apiKey = extractApiKey(request);
    let apiKeyRecord = null;
    
    if (apiKey) {
      apiKeyRecord = await getApiKeyRecord(apiKey);
    }

    const allowedModels = apiKeyRecord && apiKeyRecord.scopeType === 'restricted' && apiKeyRecord.allowedModels
      ? JSON.parse(apiKeyRecord.allowedModels)
      : [];

    const models = [];
    const seen = new Set();

    function addModel({ name, displayName, description, methods = ["generateContent"] }) {
      if (seen.has(name)) return;
      
      if (allowedModels.length > 0 && !isModelAllowed(name, allowedModels)) {
        return;
      }
      
      seen.add(name);
      models.push({
        name,
        displayName,
        description,
        supportedGenerationMethods: methods,
        inputTokenLimit: 128000,
        outputTokenLimit: 8192,
      });
    }
    
    for (const [provider, providerModels] of Object.entries(PROVIDER_MODELS)) {
      for (const model of providerModels) {
        addModel({
          name: `models/${provider}/${model.id}`,
          displayName: model.name || model.id,
          description: `${provider} model: ${model.name || model.id}`,
        });

        if (provider === "gemini") {
          addModel({
            name: `models/${model.id}`,
            displayName: model.name || model.id,
            description: `Gemini model: ${model.name || model.id}`,
            methods: ["generateContent", "streamGenerateContent"],
          });
        }
      }
    }

    return Response.json({ models });
  } catch (error) {
    console.log("Error fetching models:", error);
    return Response.json({ error: { message: error.message } }, { status: 500 });
  }
}
