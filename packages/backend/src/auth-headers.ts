import type { DefineAPI, SDK } from "caido:plugin";

// Result type for safe error handling between backend and frontend
export type Result<T> =
  | { kind: "Error"; error: string }
  | { kind: "Ok"; value: T };

// Auth headers state
let storedAuthHeaders = "";

// Save auth headers to memory
export const saveAuthHeaders = (sdk: SDK, headers: string): Result<void> => {
  storedAuthHeaders = headers;
  sdk.console.log(`Auth headers saved (${headers.length} characters)`);
  return { kind: "Ok", value: undefined };
};

// Get stored auth headers
export const getAuthHeaders = (sdk: SDK): Result<string> => {
  return { kind: "Ok", value: storedAuthHeaders };
};

// Get stored auth headers for internal use (without SDK parameter)
export const getStoredAuthHeaders = (): string => {
  return storedAuthHeaders;
};

// Set stored auth headers for internal use (without SDK parameter)
export const setStoredAuthHeaders = (headers: string): void => {
  storedAuthHeaders = headers;
};

// Send headers from a request to Authify (extract and update stored auth headers)
export const sendHeadersToAuthify = async (sdk: SDK, requestId: string): Promise<Result<{ headers: string; count: number }>> => {
  try {
    // Get the request directly using the request ID
    const requestResponse = await sdk.requests.get(requestId.toString());
    if (!requestResponse) {
      return { kind: "Error", error: "Request not found in HTTP history" };
    }

    const request = requestResponse.request;
    if (!request) {
      return { kind: "Error", error: "Request object not found" };
    }

    // Get the request headers
    const requestHeaders = request.getHeaders();
    if (!requestHeaders || Object.keys(requestHeaders).length === 0) {
      return { kind: "Error", error: "No headers found in the selected request" };
    }

    // Get current stored auth headers
    const currentAuthHeaders = storedAuthHeaders.trim();
    
    // Parse current auth headers into a map for easy lookup
    const currentAuthMap: Record<string, string> = {};
    if (currentAuthHeaders) {
      const authLines = currentAuthHeaders.split('\n').filter(line => line.trim());
      for (const line of authLines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const headerName = line.substring(0, colonIndex).trim();
          const headerValue = line.substring(colonIndex + 1).trim();
          currentAuthMap[headerName] = headerValue; // Keep original case
        }
      }
    }

    // Extract headers from the request that match common auth header names
    const authHeaderNames = [
      'authorization', 'cookie', 'x-api-key', 'x-auth-token', 'x-access-token',
      'x-csrf-token', 'x-session-id', 'x-user-token',
      'bearer', 'token', 'jwt', 'api-key', 'auth-token', 'access-token'
    ];

    const updatedHeaders: Record<string, string> = { ...currentAuthMap };
    let updatedCount = 0;

    // Check each request header against our auth header list and current config headers
    for (const [headerName, headerValues] of Object.entries(requestHeaders)) {
      if (!Array.isArray(headerValues) || headerValues.length === 0 || !headerValues[0]) {
        continue;
      }

      const headerValue = headerValues[0];
      const lowerHeaderName = headerName.toLowerCase();
      
      // Check if this header matches any of our predefined auth header patterns (exact case-insensitive match)
      const matchesAuthHeaderList = authHeaderNames.some(authName => 
        lowerHeaderName === authName.toLowerCase()
      );
      
      // Check if this header matches any header already in the config (case-insensitive)
      const matchesConfigHeader = Object.keys(currentAuthMap).some(configHeaderName =>
        configHeaderName.toLowerCase() === lowerHeaderName
      );
      
      // Update if it matches predefined auth headers OR if it matches headers already in config
      if (matchesAuthHeaderList || matchesConfigHeader) {
        // Remove any existing header with the same name (case-insensitive) before adding the new one
        const keysToRemove: string[] = [];
        for (const existingKey of Object.keys(updatedHeaders)) {
          if (existingKey.toLowerCase() === lowerHeaderName && existingKey !== headerName) {
            keysToRemove.push(existingKey);
          }
        }
        for (const key of keysToRemove) {
          delete updatedHeaders[key];
        }
        
        // Update the header in our map (preserving original case from request)
        updatedHeaders[headerName] = headerValue;
        updatedCount++;
        
        sdk.console.log(`Updated auth header: ${headerName}: ${headerValue.substring(0, 50)}${headerValue.length > 50 ? '...' : ''}`);
      }
    }

    if (updatedCount === 0) {
      return { kind: "Error", error: "No matching authentication headers found in the selected request" };
    }

    // Convert the updated headers back to the stored format
    const newAuthHeaders = Object.entries(updatedHeaders)
      .map(([name, value]) => `${name}: ${value}`)
      .join('\n');

    // Update the stored auth headers
    storedAuthHeaders = newAuthHeaders;
    
    sdk.console.log(`Successfully updated ${updatedCount} authentication headers from request ${requestId}`);
    return { kind: "Ok", value: { headers: newAuthHeaders, count: updatedCount } };

  } catch (error) {
    sdk.console.error(`Error sending headers to Authify: ${error instanceof Error ? error.message : String(error)}`);
    return { kind: "Error", error: `Failed to send headers: ${error instanceof Error ? error.message : String(error)}` };
  }
};


// Export API type for auth headers functions
export type AuthHeadersAPI = DefineAPI<{
  saveAuthHeaders: typeof saveAuthHeaders;
  getAuthHeaders: typeof getAuthHeaders;
  sendHeadersToAuthify: typeof sendHeadersToAuthify;
}>;
