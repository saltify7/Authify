import type { FrontendSDK } from "../types";
import { JSONCompatible } from "@caido/sdk-frontend/src/types/utils";

// Define the structure of our unified storage
interface AuthifyStorage {
  "authify-auth-headers"?: string;
  "authify-selected-scope"?: string;
  "authify-project-scopes"?: Array<[string, string]>; // Array of [projectId, scopeId] tuples
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

  // Save selected scope to storage (project-specific)
  async saveSelectedScope(scope: string, projectId: string): Promise<void> {
    const currentStorage = await this.getAllStorage();
    
    // Initialize project-scopes array if it doesn't exist
    if (!currentStorage["authify-project-scopes"]) {
      currentStorage["authify-project-scopes"] = [];
    }
    
    // Check if project ID exists and overwrite, otherwise add new tuple
    const existingIndex = currentStorage["authify-project-scopes"].findIndex(([pid]) => pid === projectId);
    if (existingIndex !== -1) {
      currentStorage["authify-project-scopes"][existingIndex] = [projectId, scope];
    } else {
      currentStorage["authify-project-scopes"].push([projectId, scope]);
    }
    
    await this.saveAllStorage(currentStorage);
    console.log(`Saved scope ${scope} for project ${projectId}`);
  }

  // Load selected scope from storage (project-specific)
  async loadSelectedScope(projectId: string): Promise<string | null> {
    const storage = await this.getAllStorage();
    const projectScopes = storage["authify-project-scopes"];
    
    if (projectScopes && Array.isArray(projectScopes)) {
      const tuple = projectScopes.find(([pid]) => pid === projectId);
      if (tuple && tuple[1]) {
        console.log(`Loaded scope ${tuple[1]} for project ${projectId}`);
        return tuple[1];
      }
    }
    return null;
  }

  // Clear selected scope from storage (project-specific)
  async clearSelectedScope(projectId: string): Promise<void> {
    const currentStorage = await this.getAllStorage();
    
    if (currentStorage["authify-project-scopes"]) {
      currentStorage["authify-project-scopes"] = currentStorage["authify-project-scopes"].filter(([pid]) => pid !== projectId);
      await this.saveAllStorage(currentStorage);
      console.log(`Cleared scope for project ${projectId}`);
    }
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
