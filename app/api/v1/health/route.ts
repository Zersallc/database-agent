import { isModelConfigured } from "@/lib/agent";
import { defineRoute } from "@/lib/api/handler";
import { providerHealth, providerWarnings } from "@/lib/providers";

export const runtime = "nodejs";

const API_VERSION = "1.0.0";

/**
 * Unauthenticated on purpose: this is what a load balancer and an on-call
 * engineer hit, and neither should need a workspace credential to find out
 * whether the service is up.
 *
 * It reports `degraded` rather than failing when a dependency is down — the
 * process is alive and can still serve the endpoints that do not need that
 * dependency, and returning 500 here would take a partially-working deployment
 * out of rotation entirely.
 */
export const GET = defineRoute({
  auth: false,
  handler: async () => {
    const providers = await providerHealth();
    const warnings = providerWarnings();

    const checks = [
      ...providers.map((provider) => ({
        name: provider.name,
        status: provider.ok ? ("ok" as const) : ("unavailable" as const),
        detail: `driver: ${provider.driver}`,
      })),
      {
        name: "model_provider",
        status: isModelConfigured() ? ("ok" as const) : ("degraded" as const),
        detail: isModelConfigured()
          ? "configured"
          : "ANTHROPIC_API_KEY is not set — runs return the setup notice instead of an answer.",
      },
      ...warnings.map((warning) => ({
        name: "configuration",
        status: "degraded" as const,
        detail: warning,
      })),
    ];

    return {
      body: {
        status: checks.every((check) => check.status === "ok") ? "ok" : "degraded",
        version: API_VERSION,
        checks,
      },
    };
  },
});
