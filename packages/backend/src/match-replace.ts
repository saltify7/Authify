import type { DefineAPI, SDK } from "caido:plugin";

// Result type for safe error handling between backend and frontend
export type Result<T> =
  | { kind: "Error"; error: string }
  | { kind: "Ok"; value: T };

// Match & Replace rule type
export type MatchReplaceRule = {
  id: string;
  match: string;
  replace: string;
  enabled: boolean;
};

// Match & Replace state
let storedMatchReplaceRules: MatchReplaceRule[] = [];

// Save match & replace rules to memory
export const saveMatchReplaceRules = (sdk: SDK, rules: MatchReplaceRule[]): Result<void> => {
  storedMatchReplaceRules = rules;
  sdk.console.log(`Match & replace rules saved (${rules.length} rules)`);
  return { kind: "Ok", value: undefined };
};

// Get stored match & replace rules
export const getMatchReplaceRules = (sdk: SDK): Result<MatchReplaceRule[]> => {
  return { kind: "Ok", value: storedMatchReplaceRules };
};

// Get stored match & replace rules for internal use (without SDK parameter)
export const getStoredMatchReplaceRules = (): MatchReplaceRule[] => {
  return storedMatchReplaceRules;
};

// Apply match & replace rules to request body
export const applyMatchReplaceRules = (body: string): string => {
  if (!body || body.trim() === '') {
    return body;
  }

  let modifiedBody = body;
  const enabledRules = storedMatchReplaceRules.filter(rule => rule.enabled && rule.match.trim() !== '');
  
  for (const rule of enabledRules) {
    try {
      // Use global replace to replace all occurrences
      const regex = new RegExp(escapeRegExp(rule.match), 'g');
      modifiedBody = modifiedBody.replace(regex, rule.replace);
    } catch (error) {
      // If regex creation fails, fall back to simple string replacement
      modifiedBody = modifiedBody.replace(new RegExp(rule.match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), rule.replace);
    }
  }
  
  return modifiedBody;
};

// Helper function to escape special regex characters for literal string matching
const escapeRegExp = (string: string): string => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

// Check if any match & replace rules are configured and enabled
export const hasEnabledMatchReplaceRules = (): boolean => {
  return storedMatchReplaceRules.some(rule => rule.enabled && rule.match.trim() !== '');
};

// API type definition for match & replace functions
export type MatchReplaceAPI = DefineAPI<{
  saveMatchReplaceRules: typeof saveMatchReplaceRules;
  getMatchReplaceRules: typeof getMatchReplaceRules;
}>;
