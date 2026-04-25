import {Person} from "./common";

export interface PluginSessionCredentials {
    cookie?: string;
    token?: string;
    refreshToken?: string;
    headers?: Record<string, string>;
    expiresAt?: number | null;
    userId?: string | null;
    username?: string | null;
}

export interface PluginSession {
    pluginId: string;
    isLoggedIn: boolean;
    credentials?: PluginSessionCredentials;
    user?: Person  | null;
    updatedAt: number;
}