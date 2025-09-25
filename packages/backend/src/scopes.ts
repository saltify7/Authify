import type { DefineAPI, SDK } from "caido:plugin";

// Result type for safe error handling between backend and frontend
export type Result<T> =
  | { kind: "Error"; error: string }
  | { kind: "Ok"; value: T };

// Scopes state
let selectedScope = "";

// Function to set selected scope
export const setSelectedScope = (sdk: SDK, scope: string): Result<void> => {
  selectedScope = scope;
  sdk.console.log(`Selected scope set to: ${scope || 'Unset Scope'}`);
  return { kind: "Ok", value: undefined };
};

// Function to get current selected scope
export const getSelectedScope = (sdk: SDK): Result<string> => {
  return { kind: "Ok", value: selectedScope };
};

// Function to refresh scopes (called when project changes)
export const refreshScopes = (sdk: SDK): Result<void> => {
  sdk.console.log("Scopes refreshed due to project change");
  return { kind: "Ok", value: undefined };
};

// Get selected scope for internal use (without SDK parameter)
export const getSelectedScopeInternal = (): string => {
  return selectedScope;
};

// Set selected scope for internal use (without SDK parameter)
export const setSelectedScopeInternal = (scope: string): void => {
  selectedScope = scope;
};

// Export API type for scopes functions
export type ScopesAPI = DefineAPI<{
  setSelectedScope: typeof setSelectedScope;
  getSelectedScope: typeof getSelectedScope;
  refreshScopes: typeof refreshScopes;
}>;
