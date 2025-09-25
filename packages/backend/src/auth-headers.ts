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
      'x-csrf-token', 'x-requested-with', 'x-session-id', 'x-user-token',
      'bearer', 'token', 'jwt', 'api-key', 'auth-token', 'access-token'
    ];

    const updatedHeaders: Record<string, string> = { ...currentAuthMap };
    let updatedCount = 0;

    // Check each request header against our auth header list
    for (const [headerName, headerValues] of Object.entries(requestHeaders)) {
      // Check if this header matches any of our auth header patterns (case-insensitive matching, but preserve original case)
      const lowerHeaderName = headerName.toLowerCase();
      const isAuthHeader = authHeaderNames.some(authName => 
        lowerHeaderName.includes(authName) || authName.includes(lowerHeaderName)
      );

      if (isAuthHeader && Array.isArray(headerValues) && headerValues.length > 0 && headerValues[0]) {
        const headerValue = headerValues[0];
        
        // Update the header in our map (preserving original case)
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

// Function to apply auth headers to a replay request
export const applyHeadersToReplay = async (sdk: SDK, requestId: string): Promise<Result<{ id: string }>> => {
  try {
    // Check if we have auth headers configured
    if (!storedAuthHeaders.trim()) {
      return { kind: "Error", error: "No authentication headers configured. Please add headers in the Config tab first." };
    }

    // Get the request from replay using the request ID
    const requestResponse = await sdk.requests.get(requestId.toString());
    if (!requestResponse) {
      return { kind: "Error", error: "Request not found in replay" };
    }

    const request = requestResponse.request;
    if (!request) {
      return { kind: "Error", error: "Request object not found" };
    }

    // Get the raw request
    const originalReqRaw = request.getRaw()?.toText() ?? "";
    if (!originalReqRaw) {
      return { kind: "Error", error: "Could not retrieve raw request data" };
    }

    // Parse the original raw request
    const lines = originalReqRaw.split('\n');
    if (lines.length < 1) {
      return { kind: "Error", error: "Invalid request format" };
    }

    // Find the empty line that separates headers from body
    let headerEndIndex = -1;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // Check for empty line (either completely empty or just whitespace)
      if (!line || line.trim() === '') {
        headerEndIndex = i;
        break;
      }
    }

    // If no separator found, assume all remaining lines are headers
    if (headerEndIndex === -1) {
      headerEndIndex = lines.length;
    }

    // Parse headers from original request
    const originalHeaders: Record<string, string> = {};
    for (let i = 1; i < headerEndIndex; i++) {
      const line = lines[i];
      if (line) {
        const trimmedLine = line.trim();
        const colonIndex = trimmedLine.indexOf(':');
        if (colonIndex > 0) {
          const headerName = trimmedLine.substring(0, colonIndex).trim();
          const headerValue = trimmedLine.substring(colonIndex + 1).trim();
          originalHeaders[headerName] = headerValue;
        }
      }
    }

    // Parse stored auth headers
    const authLines = storedAuthHeaders.split('\n').filter(line => line.trim());
    const authHeaders: Record<string, string> = {};
    for (const line of authLines) {
      const trimmedLine = line.trim();
      const colonIndex = trimmedLine.indexOf(':');
      if (colonIndex > 0) {
        const headerName = trimmedLine.substring(0, colonIndex).trim();
        const headerValue = trimmedLine.substring(colonIndex + 1).trim();
        authHeaders[headerName] = headerValue;
      }
    }
    
    // Merge headers: start with original, then add/overwrite with auth headers
    const modifiedHeaders = { ...originalHeaders };
    for (const [name, value] of Object.entries(authHeaders)) {
      modifiedHeaders[name] = value;
      sdk.console.log(`Applied auth header: ${name}: ${value}`);
    }

    // Reconstruct the modified request
    const requestLine = lines[0]; // GET /path HTTP/1.1
    const body = headerEndIndex < lines.length ? lines.slice(headerEndIndex + 1).join('\n') : '';
    
    let modifiedReqRaw = requestLine + '\r\n';
    
    // Add all headers
    for (const [name, value] of Object.entries(modifiedHeaders)) {
      modifiedReqRaw += `${name}: ${value}\r\n`;
    }
    
    // Add empty line and body
    modifiedReqRaw += '\r\n';
    if (body) {
      modifiedReqRaw += body;
    }

    // Parse request line to get method and path
    const requestParts = requestLine?.split(' ');
    if (!requestParts || requestParts.length < 3) {
      return { kind: "Error", error: "Invalid request line format" };
    }

    const method = requestParts[0];
    const path = requestParts[1];
    
    // Extract host from Host header
    const host = modifiedHeaders['Host'] || modifiedHeaders['host'];
    if (!host) {
      return { kind: "Error", error: "No Host header found" };
    }

    // Construct full URL
    const protocol = modifiedHeaders['X-Forwarded-Proto'] || 'https';
    const fullUrl = `${protocol}://${host}${path}`;

    // Create RequestSpec using Caido SDK
    const RequestSpec = (sdk as any).RequestSpec || (globalThis as any).RequestSpec;
    if (!RequestSpec) {
      return { kind: "Error", error: "RequestSpec not available in SDK" };
    }

    const spec = new RequestSpec(fullUrl);
    spec.setMethod(method);
    
    // Set headers (excluding Host which is handled by URL)
    for (const [name, value] of Object.entries(modifiedHeaders)) {
      if (name.toLowerCase() !== 'host') {
        spec.setHeader(name, value);
      }
    }
    
    // Set body if present
    if (body.trim()) {
      spec.setBody(body);
    }

    // Send the modified request to replay using createSession
    const session = await sdk.replay.createSession(spec);
    
    if (session) {
      sdk.console.log(`Applied auth headers to replay request successfully - Session created: ${session.getId()}`);
      return { kind: "Ok", value: { id: session.getId() } };
    } else {
      return { kind: "Error", error: "Failed to create replay session with modified headers" };
    }

  } catch (error) {
    sdk.console.log(`Error applying headers to replay: ${error}`);
    return { kind: "Error", error: `Failed to apply headers to replay: ${error}` };
  }
};

// Export API type for auth headers functions
export type AuthHeadersAPI = DefineAPI<{
  saveAuthHeaders: typeof saveAuthHeaders;
  getAuthHeaders: typeof getAuthHeaders;
  sendHeadersToAuthify: typeof sendHeadersToAuthify;
  applyHeadersToReplay: typeof applyHeadersToReplay;
}>;
