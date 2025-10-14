import { type Ref } from "vue";
import type { FrontendSDK } from "../types";
import { StorageManager } from "../utils/storage";

// Match & Replace rule type
export type MatchReplaceRule = {
  id: string;
  match: string;
  replace: string;
  enabled: boolean;
};

// Match & Replace manager class
export class MatchReplaceManager {
  private sdk: FrontendSDK;
  private storage: StorageManager;
  private matchReplaceSaveTimeout: ReturnType<typeof setTimeout> | undefined = undefined;

  constructor(sdk: FrontendSDK, storage: StorageManager) {
    this.sdk = sdk;
    this.storage = storage;
  }

  // Add a new match & replace rule
  addMatchReplaceRule(matchReplaceRules: Ref<MatchReplaceRule[]>) {
    const newRule: MatchReplaceRule = {
      id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      match: "",
      replace: "",
      enabled: true
    };
    matchReplaceRules.value.push(newRule);
    this.autoSaveMatchReplaceRules(matchReplaceRules);
  }

  // Remove a match & replace rule
  removeMatchReplaceRule(matchReplaceRules: Ref<MatchReplaceRule[]>, id: string) {
    const index = matchReplaceRules.value.findIndex(rule => rule.id === id);
    if (index > -1) {
      matchReplaceRules.value.splice(index, 1);
      this.autoSaveMatchReplaceRules(matchReplaceRules);
    }
  }

  // Toggle a match & replace rule enabled/disabled
  toggleMatchReplaceRule(matchReplaceRules: Ref<MatchReplaceRule[]>, id: string) {
    const rule = matchReplaceRules.value.find(rule => rule.id === id);
    if (rule) {
      rule.enabled = !rule.enabled;
      this.autoSaveMatchReplaceRules(matchReplaceRules);
    }
  }

  // Update a match & replace rule field
  updateMatchReplaceRule(matchReplaceRules: Ref<MatchReplaceRule[]>, id: string, field: 'match' | 'replace', value: string) {
    const rule = matchReplaceRules.value.find(rule => rule.id === id);
    if (rule) {
      rule[field] = value;
      this.autoSaveMatchReplaceRules(matchReplaceRules);
    }
  }

  // Auto-save match & replace rules when user types (with debouncing)
  private autoSaveMatchReplaceRules(matchReplaceRules: Ref<MatchReplaceRule[]>) {
    // Clear existing timeout
    if (this.matchReplaceSaveTimeout !== undefined) {
      clearTimeout(this.matchReplaceSaveTimeout);
    }
    
    // Set new timeout to save after 500ms of no typing
    this.matchReplaceSaveTimeout = setTimeout(async () => {
      await this.saveMatchReplaceRules(matchReplaceRules);
    }, 500);
  }

  // Function to save match & replace rules to storage and backend
  private async saveMatchReplaceRules(matchReplaceRules: Ref<MatchReplaceRule[]>) {
    try {
      // Save to backend first
      const result = await this.sdk.backend.saveMatchReplaceRules(matchReplaceRules.value);
      if (result.kind === "Error") {
        this.sdk.window.showToast(`Failed to save match & replace rules: ${result.error}`, { variant: "error" });
        return;
      }
      
      // Save to both legacy global storage and project-specific storage
      await this.storage.saveMatchReplaceRules(matchReplaceRules.value);
      await this.saveProjectMatchReplaceRules(matchReplaceRules.value);
      
      console.log("Match & replace rules saved to backend and storage");
    } catch (error) {
      console.warn("Error saving match & replace rules:", error);
      this.sdk.window.showToast("Failed to save match & replace rules", { variant: "error" });
    }
  }

  // Load match & replace rules from backend and storage
  async loadMatchReplaceRules(): Promise<MatchReplaceRule[]> {
    try {
      // Try to load from backend first
      const backendResult = await this.sdk.backend.getMatchReplaceRules();
      if (backendResult.kind === "Ok" && backendResult.value.length > 0) {
        console.log("Loaded match & replace rules from backend");
        return backendResult.value;
      }
      
      // Fallback to storage if backend has no rules
      const rules = await this.storage.loadMatchReplaceRules();
      return rules || [];
    } catch (error) {
      console.warn("Error loading match & replace rules from backend, falling back to storage:", error);
      const rules = await this.storage.loadMatchReplaceRules();
      return rules || [];
    }
  }

  // Function to refresh match & replace rules (can be called manually or on project change)
  async refreshMatchReplaceRules() {
    console.log("Refreshing match & replace rules");
    try {
      // Load project-specific match & replace rules
      await this.loadProjectMatchReplaceRules();
      
      return { shouldClearTraffic: false };
      
    } catch (error) {
      console.warn("Error refreshing match & replace rules:", error);
      this.sdk.window.showToast("Failed to refresh match & replace rules", { variant: "error" });
      return { shouldClearTraffic: false };
    }
  }

  // Save match & replace rules to storage (project-specific)
  async saveProjectMatchReplaceRules(rules: MatchReplaceRule[]) {
    const result = await this.sdk.backend.getCurrentProjectId();
    if (result.kind === "Ok") {
      await this.storage.saveProjectMatchReplaceRules(rules, result.value);
    } else {
      console.warn("Could not get project ID for match & replace rules storage:", result.error);
    }
  }

  // Clear stored match & replace rules from storage (project-specific)
  async clearStoredMatchReplaceRules() {
    const result = await this.sdk.backend.getCurrentProjectId();
    if (result.kind === "Ok") {
      await this.storage.clearProjectMatchReplaceRules(result.value);
    } else {
      console.warn("Could not get project ID for match & replace rules clearing:", result.error);
    }
  }

  // Function to load project-specific match & replace rules
  async loadProjectMatchReplaceRules(): Promise<MatchReplaceRule[]> {
    try {
      // Get current project ID and load project-specific match & replace rules
      const result = await this.sdk.backend.getCurrentProjectId();
      if (result.kind === "Ok") {
        const storedRules = await this.storage.loadProjectMatchReplaceRules(result.value);
        if (storedRules !== null) {
          console.log("Restored previously saved match & replace rules for project:", result.value);
          return storedRules;
        } else {
          // No stored rules, default to empty array
          console.log("No stored match & replace rules for project, defaulting to empty");
          return [];
        }
      } else {
        console.warn("Could not get project ID for match & replace rules loading:", result.error);
        // No project ID available, default to empty
        return [];
      }
    } catch (error) {
      console.warn('Could not load project match & replace rules:', error);
      this.sdk.window.showToast('Could not load project match & replace rules', { variant: "error" });
      // Fallback to empty
      return [];
    }
  }

  // Clean up timeout on destroy
  destroy() {
    if (this.matchReplaceSaveTimeout !== undefined) {
      clearTimeout(this.matchReplaceSaveTimeout);
    }
  }
}
