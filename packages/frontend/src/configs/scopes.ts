import { ref, type Ref } from "vue";
import { useSDK } from "@/plugins/sdk";
import { StorageManager } from "@/utils/storage";

export class ScopesManager {
  private sdk: ReturnType<typeof useSDK>;
  private storage: StorageManager;
  
  // Workspace scopes state
  public workspaceScopes = ref<Array<{label: string, value: string}>>([]);
  public selectedScope = ref<string | undefined>(undefined);

  constructor(sdk: ReturnType<typeof useSDK>, storage: StorageManager) {
    this.sdk = sdk;
    this.storage = storage;
  }

  // Function to refresh scopes (can be called manually or on project change)
  async refreshScopes() {
    console.log("Refreshing scopes");
    try {
      // Store the current selected scope before refreshing
      const currentScope = this.selectedScope.value;
      
      // Reload workspace scopes
      await this.loadWorkspaceScopes();
      
      // If the previously selected scope no longer exists, clear it from storage
      if (currentScope && currentScope !== this.selectedScope.value) {
        await this.clearStoredScope();
        console.log("Cleared stored scope because it no longer exists");
      }
      
      // Return a flag to indicate that traffic should be cleared
      return { shouldClearTraffic: false };
      
    } catch (error) {
      console.warn("Error refreshing scopes:", error);
      this.sdk.window.showToast("Failed to refresh scopes", { variant: "error" });
      return { shouldClearTraffic: false };
    }
  }

  // Save selected scope to storage
  async saveSelectedScope() {
    const result = await this.sdk.backend.getCurrentProjectId();
    if (result.kind === "Ok") {
      await this.storage.saveSelectedScope(this.selectedScope.value || '', result.value);
    } else {
      console.warn("Could not get project ID for scope storage:", result.error);
    }
  }

  // Clear stored scope from storage
  async clearStoredScope() {
    const result = await this.sdk.backend.getCurrentProjectId();
    if (result.kind === "Ok") {
      await this.storage.clearSelectedScope(result.value);
    } else {
      console.warn("Could not get project ID for scope clearing:", result.error);
    }
  }

  // Function to load workspace scopes
  async loadWorkspaceScopes() {
    try {
        
      // Wait for 100ms before getting workspace scopes
      await new Promise((resolve) => setTimeout(resolve, 100));
      const scopes = await this.sdk.scopes?.getScopes?.() || [];

      // Add "Unset Scope" as the first option
      this.workspaceScopes.value = [
        { label: 'Unset Scope', value: '' },
        ...scopes.map((scope: any) => ({
          label: scope.name || scope.id || scope,
          value: scope.id || scope
        }))
      ];


      // Get current project ID and load project-specific scope
      const result = await this.sdk.backend.getCurrentProjectId();
      if (result.kind === "Ok") {
        const storedScope = await this.storage.loadSelectedScope(result.value);
        if (storedScope !== null) {
          // Verify the stored scope still exists in the available scopes
          const scopeExists = this.workspaceScopes.value.some(scope => scope.value === storedScope);
          if (scopeExists) {
            this.selectedScope.value = storedScope;
            console.log("Restored previously selected scope:", storedScope);
          } else {
            // Stored scope no longer exists, default to "Unset Scope"
            this.selectedScope.value = '';
            console.log("Previously selected scope no longer exists, defaulting to 'Unset Scope'");
            this.sdk.window.showToast("Previously selected scope no longer available", { variant: "warning" });
          }
        } else {
          // No stored scope, default to "Unset Scope"
          this.selectedScope.value = '';
        }
      } else {
        console.warn("Could not get project ID for scope loading:", result.error);
        // No project ID available, default to "Unset Scope"
        this.selectedScope.value = '';
      }
    } catch (error) {
      console.warn('Could not load workspace scopes:', error);
      this.sdk.window.showToast('Could not load workspace scopes', { variant: "error" });
      // Fallback to "Unset Scope"
      this.workspaceScopes.value = [{ label: 'Unset Scope', value: '' }];
      this.selectedScope.value = '';
    }
  }

  // Function to handle scope changes and notify backend
  async handleScopeChange(newScope: string | undefined, rows: Ref<any[]>, selected: Ref<any>) {
    const localScopes = await this.sdk.scopes.getScopes();
    const result = await this.sdk.backend.setSelectedScope(newScope || '', localScopes);
    if (result.kind === "Error") {
      this.sdk.window.showToast(`Failed to set scope: ${result.error}`, { variant: "error" });
    } else {
      
      // Save the new scope to storage
      this.saveSelectedScope();
    }
  }
}
