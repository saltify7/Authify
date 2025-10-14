import type { FrontendSDK } from "../types";
import { JSONCompatible } from "@caido/sdk-frontend/src/types/utils";

// Define the structure of our unified storage
interface AuthifyStorage {
  "authify-auth-headers"?: string; // Legacy global auth headers (deprecated)
  "authify-selected-scope"?: string; // Legacy global scope (deprecated)
  "authify-project-scopes"?: Array<[string, string]>; // Array of [projectId, scopeId] tuples
  "authify-project-auth-headers"?: Array<[string, string]>; // Array of [projectId, authHeaders] tuples
  "authify-match-replace-rules"?: Array<{
    id: string;
    match: string;
    replace: string;
    enabled: boolean;
  }>; // Legacy global match & replace rules (deprecated)
  "authify-project-match-replace-rules"?: Array<[string, Array<{
    id: string;
    match: string;
    replace: string;
    enabled: boolean;
  }>]>; // Array of [projectId, rules] tuples
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

  // Save auth headers to storage (project-specific)
  async saveProjectAuthHeaders(authHeaders: string, projectId: string): Promise<void> {
    const currentStorage = await this.getAllStorage();
    
    // Initialize project-auth-headers array if it doesn't exist
    if (!currentStorage["authify-project-auth-headers"]) {
      currentStorage["authify-project-auth-headers"] = [];
    }
    
    // Check if project ID exists and overwrite, otherwise add new tuple
    const existingIndex = currentStorage["authify-project-auth-headers"].findIndex(([pid]) => pid === projectId);
    if (existingIndex !== -1) {
      currentStorage["authify-project-auth-headers"][existingIndex] = [projectId, authHeaders];
    } else {
      currentStorage["authify-project-auth-headers"].push([projectId, authHeaders]);
    }
    
    await this.saveAllStorage(currentStorage);
    console.log(`Saved auth headers for project ${projectId}`);
  }

  // Load auth headers from storage (project-specific)
  async loadProjectAuthHeaders(projectId: string): Promise<string | null> {
    const storage = await this.getAllStorage();
    const projectAuthHeaders = storage["authify-project-auth-headers"];
    
    if (projectAuthHeaders && Array.isArray(projectAuthHeaders)) {
      const tuple = projectAuthHeaders.find(([pid]) => pid === projectId);
      if (tuple && tuple[1]) {
        console.log(`Loaded auth headers for project ${projectId}`);
        return tuple[1];
      }
    }
    return null;
  }

  // Clear auth headers from storage (project-specific)
  async clearProjectAuthHeaders(projectId: string): Promise<void> {
    const currentStorage = await this.getAllStorage();
    
    if (currentStorage["authify-project-auth-headers"]) {
      currentStorage["authify-project-auth-headers"] = currentStorage["authify-project-auth-headers"].filter(([pid]) => pid !== projectId);
      await this.saveAllStorage(currentStorage);
      console.log(`Cleared auth headers for project ${projectId}`);
    }
  }

  // Save match & replace rules to storage (project-specific)
  async saveProjectMatchReplaceRules(rules: Array<{
    id: string;
    match: string;
    replace: string;
    enabled: boolean;
  }>, projectId: string): Promise<void> {
    const currentStorage = await this.getAllStorage();
    
    // Initialize project-match-replace-rules array if it doesn't exist
    if (!currentStorage["authify-project-match-replace-rules"]) {
      currentStorage["authify-project-match-replace-rules"] = [];
    }
    
    // Check if project ID exists and overwrite, otherwise add new tuple
    const existingIndex = currentStorage["authify-project-match-replace-rules"].findIndex(([pid]) => pid === projectId);
    if (existingIndex !== -1) {
      currentStorage["authify-project-match-replace-rules"][existingIndex] = [projectId, rules];
    } else {
      currentStorage["authify-project-match-replace-rules"].push([projectId, rules]);
    }
    
    await this.saveAllStorage(currentStorage);
    console.log(`Saved match & replace rules for project ${projectId}`);
  }

  // Load match & replace rules from storage (project-specific)
  async loadProjectMatchReplaceRules(projectId: string): Promise<Array<{
    id: string;
    match: string;
    replace: string;
    enabled: boolean;
  }> | null> {
    const storage = await this.getAllStorage();
    const projectRules = storage["authify-project-match-replace-rules"];
    
    if (projectRules && Array.isArray(projectRules)) {
      const tuple = projectRules.find(([pid]) => pid === projectId);
      if (tuple && tuple[1]) {
        console.log(`Loaded match & replace rules for project ${projectId}`);
        return tuple[1];
      }
    }
    return null;
  }

  // Clear match & replace rules from storage (project-specific)
  async clearProjectMatchReplaceRules(projectId: string): Promise<void> {
    const currentStorage = await this.getAllStorage();
    
    if (currentStorage["authify-project-match-replace-rules"]) {
      currentStorage["authify-project-match-replace-rules"] = currentStorage["authify-project-match-replace-rules"].filter(([pid]) => pid !== projectId);
      await this.saveAllStorage(currentStorage);
      console.log(`Cleared match & replace rules for project ${projectId}`);
    }
  }

  // Remove a key from storage
  async remove(key: keyof AuthifyStorage): Promise<void> {
    const currentStorage = await this.getAllStorage();
    delete currentStorage[key];
    await this.saveAllStorage(currentStorage);
    console.log(`Removed ${key} from sdk.storage`);
  }

  // Save match & replace rules to storage
  async saveMatchReplaceRules(rules: Array<{
    id: string;
    match: string;
    replace: string;
    enabled: boolean;
  }>): Promise<void> {
    const currentStorage = await this.getAllStorage();
    currentStorage["authify-match-replace-rules"] = rules;
    await this.saveAllStorage(currentStorage);
    console.log("Saved match & replace rules to sdk.storage");
  }

  // Load match & replace rules from storage
  async loadMatchReplaceRules(): Promise<Array<{
    id: string;
    match: string;
    replace: string;
    enabled: boolean;
  }> | null> {
    const storage = await this.getAllStorage();
    const rules = storage["authify-match-replace-rules"];
    if (rules && Array.isArray(rules)) {
      console.log("Loaded match & replace rules from sdk.storage");
      return rules;
    }
    return null;
  }

  // Load all settings at once (useful for initialization)
  async loadAllSettings(): Promise<{
    authHeaders: string | null;
    selectedScope: string | null;
    matchReplaceRules: Array<{
      id: string;
      match: string;
      replace: string;
      enabled: boolean;
    }> | null;
  }> {
    const storage = await this.getAllStorage();
    
    return {
      authHeaders: storage["authify-auth-headers"] || null,
      selectedScope: storage["authify-selected-scope"] || null,
      matchReplaceRules: storage["authify-match-replace-rules"] || null
    };
  }

  // Load project-specific settings
  async loadProjectSettings(projectId: string): Promise<{
    authHeaders: string | null;
    selectedScope: string | null;
    matchReplaceRules: Array<{
      id: string;
      match: string;
      replace: string;
      enabled: boolean;
    }> | null;
  }> {
    const [authHeaders, selectedScope, matchReplaceRules] = await Promise.all([
      this.loadProjectAuthHeaders(projectId),
      this.loadSelectedScope(projectId),
      this.loadProjectMatchReplaceRules(projectId)
    ]);
    
    return {
      authHeaders,
      selectedScope,
      matchReplaceRules
    };
  }
}
