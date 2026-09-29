import { viduProvider } from "./vidu.mjs";
import { runwayProvider } from "./runway.mjs";
import { seedanceProvider } from "./seedance.mjs";
import { veoProvider } from "./veo.mjs";
import { omniProvider } from "./omni.mjs";
import { hedraProvider } from "./hedra.mjs";

const providerList = [viduProvider, runwayProvider, seedanceProvider, veoProvider, omniProvider, hedraProvider];
const providers = new Map(providerList.map(provider => [provider.id, provider]));

export function getProvider(id = "vidu") {
  const provider = providers.get(id);
  if (!provider) { const error = new Error(`未対応のプロバイダーです: ${id}`); error.status = 400; throw error; }
  return provider;
}

export function listProviders(env) {
  return providerList.map(provider => ({
    id: provider.id,
    name: provider.name,
    configured: provider.configured(env),
    envKey: provider.envKey,
    models: provider.models,
    cancelStates: provider.cancelStates || [],
    extension: provider.extension || null,
    notes: provider.notes || "",
    referenceNotes: provider.referenceNotes || ""
  }));
}
