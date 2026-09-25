import { mockProvider } from "./mock";
import { openRouter } from "./openrouter";
import type { Provider } from "./types";

export function providerMode(): "live" | "mock" {
  return process.env.PROVIDER_MODE === "live" ? "live" : "mock";
}

export function getProvider(): Provider {
  return providerMode() === "live" ? openRouter : mockProvider;
}

export { ProviderError } from "./types";
