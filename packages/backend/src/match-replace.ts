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
  type: 'string' | 'regex';
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

// Helper function to apply a single rule to a string
const applyRuleToString = (text: string, rule: MatchReplaceRule, sdk?: { console: { log(msg: string): void } }): string => {
  if (!text || text.trim() === '') {
    return text;
  }

  if ((rule.type ?? 'string') === 'regex') {
    try {
      const regex = new RegExp(rule.match, 'g');
      return text.replace(regex, rule.replace);
    } catch (error) {
      sdk?.console.log(`Match & replace: invalid regex pattern "${rule.match}" — skipping rule`);
      return text;
    }
  }

  // String mode: escape pattern so it matches literally
  const regex = new RegExp(escapeRegExp(rule.match), 'g');
  return text.replace(regex, rule.replace);
};

// Apply match & replace rules across the entire request (headers, request line, and body)
export const applyMatchReplaceRules = (
  body: string,
  requestLine?: string,
  headers?: Record<string, string>,
  sdk?: { console: { log(msg: string): void } }
): { body: string; requestLine?: string; headers?: Record<string, string> } => {
  const enabledRules = storedMatchReplaceRules.filter(rule => rule.enabled && rule.match.trim() !== '');

  if (enabledRules.length === 0) {
    return { body, requestLine, headers };
  }

  // Apply rules to body
  let modifiedBody = body;
  if (body && body.trim() !== '') {
    for (const rule of enabledRules) {
      modifiedBody = applyRuleToString(modifiedBody, rule, sdk);
    }
  }

  // Apply rules to request line
  let modifiedRequestLine = requestLine;
  if (requestLine !== undefined && requestLine.trim() !== '') {
    let currentRequestLine = requestLine;
    for (const rule of enabledRules) {
      currentRequestLine = applyRuleToString(currentRequestLine, rule, sdk);
    }
    modifiedRequestLine = currentRequestLine;
  }

  // Apply rules to headers (both names and values)
  let modifiedHeaders = headers;
  if (headers !== undefined) {
    modifiedHeaders = {};
    for (const [name, value] of Object.entries(headers)) {
      let modifiedName = name;
      let modifiedValue = value;

      for (const rule of enabledRules) {
        modifiedName = applyRuleToString(modifiedName, rule, sdk);
      }

      if (value && value.trim() !== '') {
        for (const rule of enabledRules) {
          modifiedValue = applyRuleToString(modifiedValue, rule, sdk);
        }
      }

      modifiedHeaders[modifiedName] = modifiedValue;
    }
  }

  return { body: modifiedBody, requestLine: modifiedRequestLine, headers: modifiedHeaders };
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
