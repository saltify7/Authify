import type { DefineAPI, SDK } from "caido:plugin";

// Result type for safe error handling between backend and frontend
export type Result<T> =
  | { kind: "Error"; error: string }
  | { kind: "Ok"; value: T };

// Scopes state
let selectedScope = "";
let selectedScopeStructure: Record<string, unknown> | undefined = undefined;

// selectedScopeStructure: {"id":"4","name":"pers","allowlist":["sec-test-saltify-20.app.personio.com"],"denylist":["sec-test-saltify-21.app.personio.com"]}

// Function to set selected scope
export const setSelectedScope = async (sdk: SDK, scope: string, scopesList: Array<Record<string, unknown>>): Promise<Result<void>> => {
  selectedScope = scope;

  const trimmed = scope.trim();
  if (trimmed === "") {
    selectedScopeStructure = undefined;
    sdk.console.log("Selected scope set to: Unset Scope");
    return { kind: "Ok", value: undefined };
  }

  // Attempt to match by id first; fall back to name
  const found = scopesList.find(s => {
    const id = (s as Record<string, unknown>)["id"];
    if (typeof id === "string" && id === trimmed) {
      return true;
    }
    const name = (s as Record<string, unknown>)["name"];
    return typeof name === "string" && name === trimmed;
  });

  selectedScopeStructure = found ?? undefined;
  sdk.console.log(`Selected scope set to: ${trimmed}${found === undefined ? " (not found in SDK scopes)" : ""}`);
  sdk.console.log(`selectedScopeStructure: ${JSON.stringify(selectedScopeStructure)}`);
  return { kind: "Ok", value: undefined };
};

// Function to get current selected scope
export const getSelectedScope = (sdk: SDK): Result<string> => {
  return { kind: "Ok", value: selectedScope };
};

// Get selected scope for internal use (without SDK parameter)
export const getSelectedScopeInternal = (): string => {
  return selectedScope;
};

// Set selected scope for internal use (without SDK parameter)
export const setSelectedScopeInternal = (scope: string): void => {
  selectedScope = scope;
};

// Function to check if a URL is in scope based on selectedScopeStructure
export const isUrlInScope = (sdk: SDK, url: string): boolean => {
  if (!selectedScopeStructure) {
    return true; // No scope selected, allow all
  }

  try {
    const urlObj = new (globalThis as any).URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    // Get allowlist and denylist from scope structure
    const allowlist = (selectedScopeStructure.allowlist as string[]) || [];
    const denylist = (selectedScopeStructure.denylist as string[]) || [];

    // First check denylist (higher priority)
    for (const denyPattern of denylist) {
      if (matchesPattern(hostname, denyPattern.toLowerCase())) {
        return false; // Denied by denylist
      }
    }

    // If no allowlist, allow by default (only denylist matters)
    if (allowlist.length === 0) {
      return true;
    }

    // Check allowlist
    for (const allowPattern of allowlist) {
      if (matchesPattern(hostname, allowPattern.toLowerCase())) {
        return true; // Allowed by allowlist
      }
    }

    // Not in allowlist
    return false;

  } catch (error) {
    // Invalid URL, default to false
    return false;
  }
};

// Helper function to match hostname against Caido scope pattern
// Supports * (multiple chars) and ? (single char) wildcards
const matchesPattern = (hostname: string, pattern: string): boolean => {
  // Convert Caido pattern to regex
  // * matches multiple characters, ? matches single character
  const regexPattern = pattern
    .replace(/\./g, '\\.') // Escape dots
    .replace(/\*/g, '.*')  // * becomes .*
    .replace(/\?/g, '.');  // ? becomes .
  
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(hostname);
};

// Export API type for scopes functions
export type ScopesAPI = DefineAPI<{
  setSelectedScope: typeof setSelectedScope;
  getSelectedScope: typeof getSelectedScope;
  isUrlInScope: typeof isUrlInScope;
}>;
