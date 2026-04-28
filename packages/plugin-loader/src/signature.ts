import type { PluginSignatureStatus } from "@b_be_bee/plugin-sdk/manifest"

export interface SignatureVerifier {
  verify: (input: { checksum: string; pluginId: string; signature: string }) => Promise<boolean>
}

export const verifyPluginSignature = async (
  input: { checksum: string; pluginId: string; signature: string },
  verifier?: SignatureVerifier,
): Promise<PluginSignatureStatus> => {
  if (!input.signature) return "unverified"
  if (!verifier) return "unverified"
  return (await verifier.verify(input)) ? "verified" : "blocked"
}
