import { ref } from "vue";
import { useSDK } from "@/plugins/sdk";
import { StorageManager } from "@/utils/storage";

export class AuthConfigManager {
  private sdk: ReturnType<typeof useSDK>;
  private storage: StorageManager;
  
  // Auth config state
  public authHeaders = ref<string>("");

  constructor(sdk: ReturnType<typeof useSDK>, storage: StorageManager) {
    this.sdk = sdk;
    this.storage = storage;
  }

  // Function to refresh auth config (can be called manually or on project change)
  async refreshAuthConfig() {
    console.log("Refreshing auth config");
    try {
      // Store the current auth headers before refreshing
      const currentAuthHeaders = this.authHeaders.value;
      
      // Load project-specific auth config
      await this.loadProjectAuthConfig();
      
      // Return a flag to indicate that traffic should be cleared if auth changed
      const authChanged = currentAuthHeaders !== this.authHeaders.value;
      return { shouldClearTraffic: authChanged };
      
    } catch (error) {
      console.warn("Error refreshing auth config:", error);
      this.sdk.window.showToast("Failed to refresh auth config", { variant: "error" });
      return { shouldClearTraffic: false };
    }
  }

  // Save auth headers to storage (project-specific)
  async saveAuthHeaders() {
    const result = await this.sdk.backend.getCurrentProjectId();
    if (result.kind === "Ok") {
      await this.storage.saveProjectAuthHeaders(this.authHeaders.value, result.value);
    } else {
      console.warn("Could not get project ID for auth headers storage:", result.error);
    }
  }

  // Clear stored auth headers from storage (project-specific)
  async clearStoredAuthHeaders() {
    const result = await this.sdk.backend.getCurrentProjectId();
    if (result.kind === "Ok") {
      await this.storage.clearProjectAuthHeaders(result.value);
    } else {
      console.warn("Could not get project ID for auth headers clearing:", result.error);
    }
  }

  // Function to load project-specific auth config
  async loadProjectAuthConfig() {
    try {
      // Get current project ID and load project-specific auth headers
      const result = await this.sdk.backend.getCurrentProjectId();
      if (result.kind === "Ok") {
        const storedAuthHeaders = await this.storage.loadProjectAuthHeaders(result.value);
        if (storedAuthHeaders !== null) {
          this.authHeaders.value = storedAuthHeaders;
          console.log("Restored previously saved auth headers for project:", result.value);
          
          // Sync the loaded auth headers with the backend
          const backendResult = await this.sdk.backend.saveAuthHeaders(storedAuthHeaders);
          if (backendResult.kind === "Error") {
            console.warn("Failed to sync auth headers with backend:", backendResult.error);
            this.sdk.window.showToast("Failed to sync auth headers with backend", { variant: "warning" });
          } else {
            console.log("Successfully synced auth headers with backend");
          }
        } else {
          // No stored auth headers, default to empty and sync with backend
          this.authHeaders.value = "";
          console.log("No stored auth headers for project, defaulting to empty");
          
          // Sync empty auth headers with backend
          const backendResult = await this.sdk.backend.saveAuthHeaders("");
          if (backendResult.kind === "Error") {
            console.warn("Failed to sync empty auth headers with backend:", backendResult.error);
          }
        }
      } else {
        console.warn("Could not get project ID for auth headers loading:", result.error);
        // No project ID available, default to empty
        this.authHeaders.value = "";
      }
    } catch (error) {
      console.warn('Could not load project auth config:', error);
      this.sdk.window.showToast('Could not load project auth config', { variant: "error" });
      // Fallback to empty
      this.authHeaders.value = "";
    }
  }

  // Function to handle auth headers changes and notify backend
  async handleAuthHeadersChange(newAuthHeaders: string) {
    // Save to backend
    const result = await this.sdk.backend.saveAuthHeaders(newAuthHeaders);
    if (result.kind === "Error") {
      this.sdk.window.showToast(`Failed to save auth headers: ${result.error}`, { variant: "error" });
    } else {
      // Save the new auth headers to storage
      await this.saveAuthHeaders();
    }
  }
}
