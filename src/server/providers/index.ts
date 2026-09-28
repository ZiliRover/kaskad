import { mockProvider } from "./mock";
import { openRouter } from "./openrouter";
import type { Provider } from "./types";

export function providerMode(): "live" | "mock" {
  return process.env.PROVIDER_MODE?.trim() === "live" ? "live" : "mock";
}

/** Model vendors unreachable from this server's region, from BLOCKED_VENDORS ("google,x-ai"). */
export function blockedVendors(): string[] {
  return (process.env.BLOCKED_VENDORS ?? "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
}

export function getProvider(): Provider {
  return providerMode() === "live" ? openRouter : mockProvider;
}

export { ProviderError } from "./types";
