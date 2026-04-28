export class PluginError extends Error {
    code;
    retryable;
    detail;
    constructor(code, message, options) {
        super(message);
        this.name = "PluginError";
        this.code = code;
        this.retryable = options?.retryable;
        this.detail = options?.detail;
    }
}
const requiredMusicSourceMethods = [
    "init",
    "login",
    "logout",
    "getSession",
    "getCurrentUser",
    "getHots",
    "getUserLibrary",
    "search",
    "trackToAudioPlayInfos",
    "getPersonAudioAsserts",
    "getAudioPlayInfo",
];
const capabilityMethods = {
    audioPlayInfo: ["trackToAudioPlayInfos", "getAudioPlayInfo"],
    auth: ["login", "logout", "getSession", "getCurrentUser"],
    collectionDetail: ["getCollectionDetail"],
    collectionTracks: ["getCollectionTracks"],
    cookieAuth: ["login", "logout", "getSession", "getCurrentUser"],
    hots: ["getHots"],
    lyrics: ["getLyrics"],
    personAudioAssets: ["getPersonAudioAsserts"],
    qualitySelect: ["getAvailableQualities"],
    search: ["search"],
    userLibrary: ["getUserLibrary"],
};
const isObject = (value) => {
    return Boolean(value) && typeof value === "object";
};
const hasFunction = (value, key) => {
    return typeof value[key] === "function";
};
export const isMusicSourceCapabilities = (value) => {
    if (!isObject(value))
        return false;
    return Object.keys(capabilityMethods).every((key) => typeof value[key] === "boolean");
};
export const isMusicSourcePlugin = (value) => {
    if (!isObject(value))
        return false;
    const meta = value.meta;
    if (!isObject(meta))
        return false;
    if (!Array.isArray(meta.pluginTypes) ||
        meta.pluginTypes.length !== 1 ||
        meta.pluginTypes[0] !== "music-source") {
        return false;
    }
    if (typeof meta.id !== "string" || typeof meta.name !== "string" || typeof meta.version !== "string") {
        return false;
    }
    if (!isMusicSourceCapabilities(value.capabilities))
        return false;
    return requiredMusicSourceMethods.every((method) => hasFunction(value, method));
};
export const assertMusicSourcePlugin = (value, manifest) => {
    if (!isObject(value)) {
        throw new PluginError("INVALID_RESPONSE", "Music source plugin must export an object.");
    }
    if (!isMusicSourcePlugin(value)) {
        throw new PluginError("INVALID_RESPONSE", "Music source plugin must provide meta, capabilities, and required music source methods.");
    }
    if (manifest) {
        if (manifest.type !== "music-source") {
            throw new PluginError("INVALID_RESPONSE", "Music source plugin manifest type must be music-source.");
        }
        if (value.meta.id !== manifest.id || value.meta.version !== manifest.version) {
            throw new PluginError("INVALID_RESPONSE", "Music source plugin meta id and version must match the manifest.");
        }
    }
    const capabilities = value.capabilities;
    for (const [capability, methods] of Object.entries(capabilityMethods)) {
        if (!capabilities[capability])
            continue;
        const missing = methods.filter((method) => !hasFunction(value, method));
        if (missing.length > 0) {
            throw new PluginError("INVALID_RESPONSE", `Music source capability ${capability} requires methods: ${missing.join(", ")}.`);
        }
    }
};
export const validateMusicSourcePlugin = (value, manifest) => {
    assertMusicSourcePlugin(value, manifest);
    return value;
};
