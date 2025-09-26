import type { FrontendSDK } from "../types";
import { JSONCompatible } from "@caido/sdk-frontend/src/types/utils";

// Define the structure of our unified storage
interface AuthifyStorage {
  "authify-auth-headers"?: string;
  "authify-selected-scope"?: string;
}

// Storage utility functions using Caido SDK storage API
export class StorageManager {
  private sdk: FrontendSDK;

  constructor(sdk: FrontendSDK) {
    this.sdk = sdk;
  }

  // Get all current storage data
  private async getAllStorage(): Promise<AuthifyStorage> {
    try {
      const data = await this.sdk.storage.get();
      if (data && typeof data === 'object') {
        return data as AuthifyStorage;
      }
      return {};
    } catch (error) {
      console.warn("Could not load storage data:", error);
      return {};
    }
  }

  // Save all storage data
  private async saveAllStorage(storageData: AuthifyStorage): Promise<void> {
    try {
      const jsonCompatibleData = storageData as JSONCompatible<AuthifyStorage>;
      await this.sdk.storage.set(jsonCompatibleData);
      console.log("Saved all settings to sdk.storage");
    } catch (error) {
      console.warn("Could not save settings to sdk.storage:", error);
    }
  }

  // Save auth headers to storage
  async saveAuthHeaders(headers: string): Promise<void> {
    const currentStorage = await this.getAllStorage();
    currentStorage["authify-auth-headers"] = headers;
    await this.saveAllStorage(currentStorage);
    console.log("Saved auth headers to sdk.storage");
  }

  // Load auth headers from storage
  async loadAuthHeaders(): Promise<string | null> {
    const storage = await this.getAllStorage();
    const headers = storage["authify-auth-headers"];
    if (headers && typeof headers === 'string') {
      console.log("Loaded auth headers from sdk.storage");
      return headers;
    }
    return null;
  }

  // Save selected scope to storage
  async saveSelectedScope(scope: string): Promise<void> {
    const currentStorage = await this.getAllStorage();
    currentStorage["authify-selected-scope"] = scope;
    await this.saveAllStorage(currentStorage);
    console.log("Saved selected scope to sdk.storage:", scope);
  }

  // Load selected scope from storage
  async loadSelectedScope(): Promise<string | null> {
    const storage = await this.getAllStorage();
    const scope = storage["authify-selected-scope"];
    if (scope && typeof scope === 'string') {
      console.log("Loaded selected scope from sdk.storage:", scope);
      return scope;
    }
    return null;
  }

  // Clear selected scope from storage
  async clearSelectedScope(): Promise<void> {
    const currentStorage = await this.getAllStorage();
    delete currentStorage["authify-selected-scope"];
    await this.saveAllStorage(currentStorage);
    console.log("Cleared selected scope from sdk.storage");
  }

  // Remove a key from storage
  async remove(key: keyof AuthifyStorage): Promise<void> {
    const currentStorage = await this.getAllStorage();
    delete currentStorage[key];
    await this.saveAllStorage(currentStorage);
    console.log(`Removed ${key} from sdk.storage`);
  }

  // Load all settings at once (useful for initialization)
  async loadAllSettings(): Promise<{
    authHeaders: string | null;
    selectedScope: string | null;
  }> {
    const storage = await this.getAllStorage();
    
    return {
      authHeaders: storage["authify-auth-headers"] || null,
      selectedScope: storage["authify-selected-scope"] || null
    };
  }
}
