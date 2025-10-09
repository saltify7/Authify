import type { DefineAPI, DefineEvents, SDK } from "caido:plugin";
import { getFilterSettings, setFilterSettings, shouldFilterRequest, isPluginGeneratedRequest } from "./filter";
import { saveAuthHeaders, getAuthHeaders, getStoredAuthHeaders, sendHeadersToAuthify, applyHeadersToReplay } from "./auth-headers";
import { setSelectedScope, getSelectedScope, refreshScopes, getSelectedScopeInternal, setSelectedScopeInternal } from "./scopes";
import { getResponseContentLength, compareResponses } from "./utils";

// Result type for safe error handling between backend and frontend
export type Result<T> =
  | { kind: "Error"; error: string }
  | { kind: "Ok"; value: T };

// Events sent from backend to frontend
export type BackendEvents = DefineEvents<{
  // Emitted whenever capturedTraffic changes (add/update/clear)
  tableChanged: (rows: Array<Row>) => void;
}>;

// Simplified row type mirrored by frontend
type Row = {
  id: string;
  method: string;
  hostname: string;
  path: string;
  code: number;
  length: number;
  modifiedCode: number;
  modifiedLength: number;
  reqRaw: string;
  respRaw: string;
  modifiedReqRaw: string;
  modifiedRespRaw: string;
  reqSpecRaw: unknown;
  comparison: "same" | "different" | "similar" | "unknown";
};

// Plugin state
let isPluginEnabled = false;
let lastProcessedRequestId: string | undefined = undefined;
let capturedTraffic: Array<Row> = [];
let modifiedRequestIds = new Set<string>();
let pendingResponseQueue = new Set<string>(); // Queue of request IDs waiting for responses
let responseUpdateInterval: number | undefined = undefined;


// ACTIONS

// Function to send request to replay
const sendToReplay = async (sdk: SDK, requestId: string, useModified: boolean): Promise<Result<{ id: string }>> => {
  try {
    // Find the request in captured traffic
    const row = capturedTraffic.find(r => r.id === requestId);
    if (!row) {
      return { kind: "Error", error: "Request not found in captured traffic" };
    }

    // Determine which request to send based on useModified flag
    let requestRaw: string;
    if (useModified && row.modifiedReqRaw) {
      requestRaw = row.modifiedReqRaw;
      sdk.console.log(`Sending modified request to replay: ${requestId}`);
    } else {
      requestRaw = row.reqRaw;
      sdk.console.log(`Sending original request to replay: ${requestId}`);
    }

    if (!requestRaw || requestRaw.trim() === "") {
      return { kind: "Error", error: "No request data available to send" };
    }

    // Parse the raw HTTP request to create a RequestSpec
    const lines = requestRaw.split('\n');
    if (lines.length < 1) {
      return { kind: "Error", error: "Invalid request format" };
    }

    // Parse the request line (e.g., "GET /path HTTP/1.1")
    const requestLine = lines[0]?.trim();
    if (!requestLine) {
      return { kind: "Error", error: "Empty request line" };
    }
    
    const requestParts = requestLine.split(' ');
    if (requestParts.length < 3) {
      return { kind: "Error", error: "Invalid request line format" };
    }

    const method = requestParts[0];
    const path = requestParts[1];
    
    if (!method || !path) {
      return { kind: "Error", error: "Invalid method or path in request line" };
    }
    
    // Find the empty line that separates headers from body (optional for GET requests)
    let headerEndIndex = -1;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // Check for empty line (either completely empty or just whitespace)
      if (!line || line.trim() === '') {
        headerEndIndex = i;
        break;
      }
    }

    // If no separator found, assume all remaining lines are headers (common for GET requests)
    if (headerEndIndex === -1) {
      headerEndIndex = lines.length; // All lines after request line are headers
    }

    // Parse headers
    const headers: Record<string, string> = {};
    for (let i = 1; i < headerEndIndex; i++) {
      const line = lines[i];
      if (line) {
        const trimmedLine = line.trim();
        const colonIndex = trimmedLine.indexOf(':');
        if (colonIndex > 0) {
          const headerName = trimmedLine.substring(0, colonIndex).trim();
          const headerValue = trimmedLine.substring(colonIndex + 1).trim();
          headers[headerName] = headerValue;
        }
      }
    }

    // Get body (everything after the empty line) - only for methods that support body
    const body = headerEndIndex < lines.length ? lines.slice(headerEndIndex + 1).join('\n') : '';
    const hasBody = body.trim() !== '';

    // Extract host from Host header
    const host = headers['Host'] || headers['host'];
    if (!host) {
      return { kind: "Error", error: "No Host header found in request" };
    }

    // Construct the full URL
    const protocol = headers['X-Forwarded-Proto'] || 'https';
    const fullUrl = `${protocol}://${host}${path}`;

    // Create RequestSpec using Caido SDK
    const RequestSpec = (sdk as any).RequestSpec || (globalThis as any).RequestSpec;
    if (!RequestSpec) {
      return { kind: "Error", error: "RequestSpec not available in SDK" };
    }

    const spec = new RequestSpec(fullUrl);
    spec.setMethod(method);
    
    // Set headers
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() !== 'host') { // Host is handled by URL
        spec.setHeader(name, value);
      }
    }
    
    // Set body only if present and method supports it
    // GET, HEAD, DELETE, OPTIONS typically don't have bodies
    const methodsWithoutBody = ['GET', 'HEAD', 'DELETE', 'OPTIONS'];
    if (hasBody && !methodsWithoutBody.includes(method.toUpperCase())) {
      spec.setBody(body);
      sdk.console.log(`Set body for ${method} request (${body.length} characters)`);
    } else if (hasBody && methodsWithoutBody.includes(method.toUpperCase())) {
      sdk.console.log(`Skipping body for ${method} request (method doesn't typically support body)`);
    } else {
      sdk.console.log(`No body to set for ${method} request`);
    }

    // Send the request to replay using createSession
    const session = await sdk.replay.createSession(spec);
    
    if (session) {
      sdk.console.log(`Request sent to replay successfully - Session created`);
      return { kind: "Ok", value: { id: session.getId() } };
    } else {
      return { kind: "Error", error: "Failed to create replay session" };
    }

  } catch (error) {
    sdk.console.log(`Error sending request to replay: ${error}`);
    return { kind: "Error", error: `Failed to send request to replay: ${error}` };
  }
};

// Process a request from HTTP history (context menu action)
const processRequestFromHistory = async (sdk: SDK<API, BackendEvents>, requestId: string): Promise<Result<void>> => {
  try {
    // Get the request directly using the request ID
    const requestResponse = await sdk.requests.get(requestId.toString());
    if (!requestResponse) {
      return { kind: "Error", error: "Request not found in HTTP history" };
    }

    const request = requestResponse.request;
    const response = requestResponse.response;

    if (!request) {
      return { kind: "Error", error: "Request object not found" };
    }

    if (!response) {
      return { kind: "Error", error: "Response not found for this request" };
    }

    // Check if we have auth headers configured
    if (!getStoredAuthHeaders().trim()) {
      return { kind: "Error", error: "No authentication headers configured. Please add headers in the Config tab first." };
    }

    // Get raw request and response
    const originalReqRaw = request.getRaw()?.toText() ?? "";
    const originalRespRaw = response.getRaw()?.toText() ?? "";

    if (!originalReqRaw || !originalRespRaw) {
      return { kind: "Error", error: "Could not retrieve raw request/response data" };
    }

    // Process the request using our existing modifyAndResendRequest logic
    const result = await modifyAndResendRequest(sdk, originalReqRaw, originalRespRaw);
    
    // modifyAndResendRequest returns a plain object, not a Result type
    if (!result) {
      return { kind: "Error", error: "Failed to process request" };
    }

    // Create a row entry for the processed request to add to the traffic table
    const id = `${request.getId()}`;
    const method = request.getMethod();
    const url = request.getUrl();
    
    // Parse URL to extract hostname and path
    let hostname = "";
    let path = "";
    try {
      const urlObj = new (globalThis as any).URL(url);
      hostname = urlObj.hostname;
      path = urlObj.pathname + urlObj.search;
    } catch {
      hostname = "Invalid URL";
      path = url;
    }
    
    const code = response.getCode();
    const length = getResponseContentLength(response, originalRespRaw);
    
    // Create the row entry
    const row: Row = {
      id,
      method,
      hostname,
      path,
      code,
      length,
      modifiedCode: result.code,
      modifiedLength: result.length,
      reqRaw: originalReqRaw,
      respRaw: originalRespRaw,
      modifiedReqRaw: result.modifiedReqRaw,
      modifiedRespRaw: result.modifiedRespRaw,
      reqSpecRaw: request.toSpecRaw(),
      comparison: result.comparison
    };

    // Add to captured traffic (prepend to keep newest first)
    capturedTraffic = [row, ...capturedTraffic];
    
    // Mark this request as modified
    modifiedRequestIds.add(id);

    // Notify frontend that table changed
    sdk.api.send("tableChanged", capturedTraffic);

    sdk.console.log(`Successfully processed request from HTTP history: ${request.getMethod()} ${request.getPath()}`);
    return { kind: "Ok", value: undefined };

  } catch (error) {
    sdk.console.error(`Error processing request from history: ${error instanceof Error ? error.message : String(error)}`);
    return { kind: "Error", error: `Failed to process request: ${error instanceof Error ? error.message : String(error)}` };
  }
};

// REQUEST PROCESSING

// Event-driven request processing using onInterceptResponse
const handleInterceptedResponse = async (sdk: SDK<API, BackendEvents>, request: any, response: any): Promise<void> => {
  try {
    // Only process if plugin is enabled
    if (!isPluginEnabled) {
      return;
    }

    // Process the request using our existing logic
    const processedRow = await processNewRequest(sdk, request, response);
    if (processedRow !== null) {
      // Add new row to captured traffic (prepend to keep newest first)
      capturedTraffic = [processedRow, ...capturedTraffic];
      
      // Keep only the last 500 entries to prevent memory issues
      if (capturedTraffic.length > 500) {
        capturedTraffic = capturedTraffic.slice(0, 500);
      }
      
      // Notify frontend that table changed
      sdk.api.send("tableChanged", capturedTraffic);
      
      sdk.console.log(`Processed intercepted request: ${request.getMethod()} ${request.getUrl()}`);
    }
  } catch (error) {
    sdk.console.log(`Error processing intercepted response: ${error}`);
  }
};

// Process a single new request
const processNewRequest = async (sdk: SDK, req: any, resp: any): Promise<Row | null> => {
  const id = `${req.getId()}`;
  const method = req.getMethod();
  const url = req.getUrl();
  
  // Check if this is a plugin-generated request (early exit for performance)
  const isPluginRequest = isPluginGeneratedRequest(sdk, req, getStoredAuthHeaders());
  if (isPluginRequest) {
    sdk.console.log("Skipping request entirely - request is plugin-generated");
    return null; // Skip this request completely
  }
  
  // Check if request should be filtered out based on file extensions
  if (shouldFilterRequest(req)) {
    sdk.console.log(`Filtered out request: ${method} ${url} (file extension filter)`);
    return null;
  }
  
  // Check if request is in the selected scope
  if (getSelectedScopeInternal() && getSelectedScopeInternal().trim() !== "") {
    try {
      const isInScope = sdk.requests.inScope(req);
      if (!isInScope) {
        sdk.console.log(`Skipping request - URL ${url} not in scope ${getSelectedScopeInternal()}`);
        return null;
      }
    } catch (scopeError) {
      sdk.console.log(`Error checking scope for request ${url}: ${scopeError}`);
      return null;
    }
  }
  
  // Parse URL to extract hostname and path
  let hostname = "";
  let path = "";
  try {
    const urlObj = new (globalThis as any).URL(url);
    hostname = urlObj.hostname;
    path = urlObj.pathname + urlObj.search;
  } catch {
    hostname = "Invalid URL";
    path = url;
  }
  
  const code = resp !== undefined ? resp.getCode() : 0;
  const respRaw = resp !== undefined ? resp.getRaw()?.toText() ?? "" : "";
  const length = getResponseContentLength(resp, respRaw);
  
  // If response is empty or missing, add to queue for later processing
  if (resp === undefined || respRaw === "") {
    pendingResponseQueue.add(id);
    sdk.console.log(`Request ${id} added to response queue - response not available yet`);
  }
  const reqRaw = req.getRaw()?.toText() ?? "";
  const reqSpecRaw = req.toSpecRaw();

  // Initialize modification data
  let modifiedCode = 0;
  let modifiedLength = 0;
  let modifiedReqRaw = "";
  let modifiedRespRaw = "";
  let comparison: "same" | "different" | "similar" | "unknown" = "unknown";
  
  // Process request modification if plugin is enabled and auth headers are available
  if (isPluginEnabled && getStoredAuthHeaders().trim() && !modifiedRequestIds.has(id)) {
    sdk.console.log(`Processing new request: ${method} ${url}`);
    
    // Mark this request as being modified to prevent recursion
    modifiedRequestIds.add(id);
    
    const modifiedResult = await modifyAndResendRequest(sdk, reqRaw, respRaw);
    modifiedCode = modifiedResult.code;
    modifiedLength = modifiedResult.length;
    modifiedReqRaw = modifiedResult.modifiedReqRaw;
    modifiedRespRaw = modifiedResult.modifiedRespRaw;
    comparison = modifiedResult.comparison;
  }

  return {
    id,
    method,
    hostname,
    path,
    code,
    length,
    modifiedCode,
    modifiedLength,
    reqRaw,
    respRaw,
    modifiedReqRaw,
    modifiedRespRaw,
    reqSpecRaw,
    comparison
  };
};

// Function to process pending responses in bulk
const processPendingResponses = async (sdk: SDK<API, BackendEvents>): Promise<void> => {
  // Only process if plugin is enabled
  if (!isPluginEnabled) {
    return;
  }

  if (pendingResponseQueue.size === 0) {
    return;
  }

  sdk.console.log(`Processing ${pendingResponseQueue.size} pending responses`);
  
  const updatedIds = new Set<string>();
  const pendingIds = Array.from(pendingResponseQueue);

  // Process each pending request ID individually
  for (const id of pendingIds) {
    try {
      // Get the specific request by ID
      const requestResponse = await sdk.requests.get(id.toString());
      
      if (!requestResponse) {
        // Request not found, remove from queue
        pendingResponseQueue.delete(id);
        sdk.console.log(`Request ${id} not found, removing from pending queue`);
        continue;
      }

      const resp = requestResponse.response;
      
      // Check if we now have a response
      if (resp !== undefined) {
      const respRaw = resp.getRaw()?.toText() ?? "";
      
      // Only update if we now have a response
      if (respRaw !== "") {
        const code = resp.getCode();
        const length = getResponseContentLength(resp, respRaw);
        
        // Find and update the row in captured traffic
        const rowIndex = capturedTraffic.findIndex(row => row.id === id);
        if (rowIndex !== -1) {
          const row = capturedTraffic[rowIndex];
          if (row !== undefined) {
            row.code = code;
            row.length = length;
            row.respRaw = respRaw;
            
            // Re-process comparison logic if we have modified response data
            if (row.modifiedRespRaw !== "") {
              const modifiedLength = row.modifiedLength;
              const modifiedCode = row.modifiedCode;
              
              // Compare original and modified responses using the helper function
              const comparison = compareResponses(code, length, modifiedCode, modifiedLength, respRaw, row.modifiedRespRaw);
              
              row.comparison = comparison;
              sdk.console.log(`Updated response and comparison for request ${id}: ${code}, length: ${length}, comparison: ${comparison}`);
            } else {
              sdk.console.log(`Updated response for request ${id}: ${code}, length: ${length}`);
            }
            
            updatedIds.add(id);
          }
        }
      }
      }
    } catch (error) {
      sdk.console.log(`Error checking request ${id}: ${error}`);
      // Keep the request in the queue for next time
    }
  }

  // Remove updated IDs from queue
  for (const id of updatedIds) {
    pendingResponseQueue.delete(id);
  }

  if (updatedIds.size > 0) {
    sdk.console.log(`Successfully updated ${updatedIds.size} responses`);
    // Notify frontend that table changed
    sdk.api.send("tableChanged", capturedTraffic);
  }
};

// Function to modify request with auth headers and resend
const modifyAndResendRequest = async (sdk: SDK<API, BackendEvents>, originalReqRaw: string, originalRespRaw: string): Promise<{ code: number; length: number; modifiedReqRaw: string; modifiedRespRaw: string; comparison: "same" | "different" | "similar" | "unknown" }> => {
  try {
    if (!getStoredAuthHeaders().trim()) {
      sdk.console.log("No auth headers stored, skipping modification");
      return { code: 0, length: 0, modifiedReqRaw: "", modifiedRespRaw: "", comparison: "unknown" };
    }

    // Parse the original raw request
    const lines = originalReqRaw.split('\n');
    if (lines.length < 1) {
      sdk.console.log("Invalid request format");
      return { code: 0, length: 0, modifiedReqRaw: "", modifiedRespRaw: "", comparison: "unknown" };
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
    const authLines = getStoredAuthHeaders().split('\n').filter(line => line.trim());
    const authHeaders: Record<string, string> = {};
    for (const line of authLines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const headerName = line.substring(0, colonIndex).trim();
        const headerValue = line.substring(colonIndex + 1).trim();
        authHeaders[headerName] = headerValue;
      }
    }
    
    // Merge headers: start with original, then add/overwrite with auth headers
    const modifiedHeaders = { ...originalHeaders };
    for (const [name, value] of Object.entries(authHeaders)) {
      modifiedHeaders[name] = value;
      sdk.console.log(`Modified header: ${name}: ${value}`);
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

    // Convert raw request to RequestSpec and send
    const RequestSpec = (sdk as any).RequestSpec || (globalThis as any).RequestSpec;
    if (!RequestSpec) {
      sdk.console.log("RequestSpec not available");
      return { code: 0, length: 0, modifiedReqRaw, modifiedRespRaw: "", comparison: "unknown" };
    }

    // Parse request line to get method and path
    const requestParts = requestLine?.split(' ');
    if (!requestParts || requestParts.length < 3) {
      sdk.console.log("Invalid request line format");
      return { code: 0, length: 0, modifiedReqRaw, modifiedRespRaw: "", comparison: "unknown" };
    }

    const method = requestParts[0];
    const path = requestParts[1];
    
    // Extract host from Host header
    const host = modifiedHeaders['Host'] || modifiedHeaders['host'];
    if (!host) {
      sdk.console.log("No Host header found");
      return { code: 0, length: 0, modifiedReqRaw, modifiedRespRaw: "", comparison: "unknown" };
    }

    // Construct full URL
    const protocol = modifiedHeaders['X-Forwarded-Proto'] || 'https';
    const fullUrl = `${protocol}://${host}${path}`;

    // Create and send request
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

    // Send the request
    const result = await sdk.requests.send(spec);
    
    if (result && result.response) {
      const modifiedRespRaw = result.response.getRaw()?.toText() ?? "";
      const modifiedCode = result.response.getCode();
      
      // Get modified response length using helper function
      const modifiedLength = getResponseContentLength(result.response, modifiedRespRaw);
      
      // Parse original response to get code and length
      const originalLines = originalRespRaw.split('\n');
      const originalCode = originalLines.length > 0 && originalLines[0] ? parseInt(originalLines[0].split(' ')[1] || '0') || 0 : 0;
      
      // Get original response length using helper function
      // Note: We don't have the original response object here, so we'll parse from raw
      // This ensures consistent behavior with the modified response calculation
      const originalLength = getResponseContentLength(undefined, originalRespRaw);
      
      // Compare responses using the helper function
      const comparison = compareResponses(originalCode, originalLength, modifiedCode, modifiedLength, originalRespRaw, modifiedRespRaw);
      
      sdk.console.log(`Modified response: ${modifiedCode}, length: ${modifiedLength}, comparison: ${comparison} (original: ${originalCode}, ${originalLength})`);
        
        return {
        code: modifiedCode,
        length: modifiedLength,
          modifiedReqRaw,
        modifiedRespRaw,
          comparison
        };
    }
    
    sdk.console.log("No response received from modified request");
    return { code: 0, length: 0, modifiedReqRaw, modifiedRespRaw: "", comparison: "unknown" };
    
  } catch (error) {
    sdk.console.log(`Error modifying and resending request: ${error}`);
    return { code: 0, length: 0, modifiedReqRaw: "", modifiedRespRaw: "", comparison: "unknown" };
  }
};

// RUNNING LOGIC

// Get current traffic - now just returns captured traffic since we use event-driven processing
const getTraffic = async (sdk: SDK<API, BackendEvents>): Promise<Result<Array<Row>>> => {
  try {
    return { kind: "Ok", value: capturedTraffic };
  } catch (error) {
    sdk.console.log(`Error fetching traffic: ${error}`);
    return { kind: "Error", error: `Failed to fetch traffic: ${error}` };
  }
};

// Start background response processing
const startResponseProcessing = (sdk: SDK<API, BackendEvents>): void => {
  if (responseUpdateInterval !== undefined) {
    return; // Already running
  }
  
  responseUpdateInterval = (globalThis as any).setInterval(async () => {
    await processPendingResponses(sdk);
  }, 1000);
  
  sdk.console.log("Started background response processing (every second)");
};

// Stop background response processing
const stopResponseProcessing = (sdk: SDK<API, BackendEvents>): void => {
  if (responseUpdateInterval !== undefined) {
    (globalThis as any).clearInterval(responseUpdateInterval);
    responseUpdateInterval = undefined;
    sdk.console.log("Stopped background response processing");
  }
};

// Set plugin enabled state
const setPluginEnabled = async (sdk: SDK<API, BackendEvents>, enabled: boolean): Promise<Result<void>> => {
  try {
    if (enabled && !isPluginEnabled) {
      // Plugin is being turned ON - set lastProcessedRequestId to most recent request
      const query = sdk.requests
        .query()
        .descending("req", "created_at")
        .first(1);

      const conn = await query.execute();
      
      if (conn.items.length > 0) {
        const firstItem = conn.items[0];
        if (firstItem !== undefined) {
          lastProcessedRequestId = `${firstItem.request.getId()}`;
          sdk.console.log(`Plugin enabled - will monitor requests after ID: ${lastProcessedRequestId}`);
        }
      } else {
        sdk.console.log(`Plugin enabled - no existing requests found, will capture all new requests`);
        lastProcessedRequestId = undefined;
      }
      
      // Keep existing captured traffic, just set new baseline for future requests
      // Clear modified request tracking when starting fresh
      modifiedRequestIds.clear();
      pendingResponseQueue.clear();
      sdk.console.log("Cleared modified request tracking and response queue for fresh start");
      
      // Start background response processing
      startResponseProcessing(sdk);
    } else if (!enabled && isPluginEnabled) {
      // Plugin is being turned OFF - keep captured traffic but stop collecting new ones
      sdk.console.log(`Plugin disabled - captured ${capturedTraffic.length} requests`);
      // Clear modified request tracking when disabled
      modifiedRequestIds.clear();
      pendingResponseQueue.clear();
      sdk.console.log("Cleared modified request tracking and response queue");
      
      // Stop background response processing
      stopResponseProcessing(sdk);
    }
    
    isPluginEnabled = enabled;
    return { kind: "Ok", value: undefined };
  } catch (error) {
    sdk.console.log(`Error setting plugin state: ${error}`);
    return { kind: "Error", error: `Failed to set plugin state: ${error}` };
  }
};

// Clear traffic table
const clearTraffic = async (sdk: SDK<API, BackendEvents>): Promise<Result<void>> => {
  try {
    // Get the most recent request ID and set it as the last processed request
    const query = sdk.requests
      .query()
      .descending("req", "created_at")
      .first(1);

    const conn = await query.execute();
    
    if (conn.items.length > 0) {
      const firstItem = conn.items[0];
      if (firstItem !== undefined) {
        lastProcessedRequestId = `${firstItem.request.getId()}`;
        sdk.console.log(`Cleared traffic table - set last processed request ID to: ${lastProcessedRequestId}`);
      }
    } else {
      sdk.console.log("Cleared traffic table - no existing requests found");
      lastProcessedRequestId = undefined;
    }
    
    capturedTraffic = [];
    pendingResponseQueue.clear();
    // Notify frontend that table changed (now empty)
    sdk.api.send("tableChanged", capturedTraffic);
    sdk.console.log("Cleared traffic table and response queue");
    return { kind: "Ok", value: undefined };
  } catch (error) {
    sdk.console.log(`Error clearing traffic table: ${error}`);
    return { kind: "Error", error: `Failed to clear traffic table: ${error}` };
  }
};

// API SPECIFICATION

export type API = DefineAPI<{
  getTraffic: typeof getTraffic;
  setPluginEnabled: typeof setPluginEnabled;
  saveAuthHeaders: typeof saveAuthHeaders;
  getAuthHeaders: typeof getAuthHeaders;
  modifyAndResendRequest: typeof modifyAndResendRequest;
  clearTraffic: typeof clearTraffic;
  setSelectedScope: typeof setSelectedScope;
  getSelectedScope: typeof getSelectedScope;
  sendToReplay: typeof sendToReplay;
  getFilterSettings: typeof getFilterSettings;
  setFilterSettings: typeof setFilterSettings;
  processRequestFromHistory: typeof processRequestFromHistory;
  sendHeadersToAuthify: typeof sendHeadersToAuthify;
  refreshScopes: typeof refreshScopes;
  applyHeadersToReplay: typeof applyHeadersToReplay;
}>;

export async function init(sdk: SDK<API, BackendEvents>) {
  sdk.api.register("getTraffic", getTraffic);
  sdk.api.register("setPluginEnabled", setPluginEnabled);
  sdk.api.register("saveAuthHeaders", saveAuthHeaders);
  sdk.api.register("getAuthHeaders", getAuthHeaders);
  sdk.api.register("modifyAndResendRequest", modifyAndResendRequest);
  sdk.api.register("clearTraffic", clearTraffic);
  sdk.api.register("setSelectedScope", setSelectedScope);
  sdk.api.register("getSelectedScope", getSelectedScope);
  sdk.api.register("sendToReplay", sendToReplay);
  sdk.api.register("getFilterSettings", getFilterSettings);
  sdk.api.register("setFilterSettings", setFilterSettings);
  sdk.api.register("processRequestFromHistory", processRequestFromHistory);
  sdk.api.register("sendHeadersToAuthify", sendHeadersToAuthify);
  sdk.api.register("refreshScopes", refreshScopes);
  sdk.api.register("applyHeadersToReplay", applyHeadersToReplay);

  // Register event listener for intercepted responses (event-driven approach)
  sdk.events.onInterceptResponse(async (sdk, request, response) => {
    await handleInterceptedResponse(sdk, request, response);
  });

  // Register event listener for project changes to refresh scopes
  sdk.events.onProjectChange(async (sdk, project) => {
    const newProjectName = project?.getName() ?? "No Project";
    sdk.console.log(`Project changed to "${newProjectName}" - scopes will be refreshed`);
    
    // Clear existing traffic when project changes to avoid confusion
    capturedTraffic = [];
    pendingResponseQueue.clear();
    modifiedRequestIds.clear();
    refreshScopes(sdk);
    // Notify frontend that table changed (now empty)
    sdk.api.send("tableChanged", capturedTraffic);
    
    // Reset selected scope to default
    setSelectedScopeInternal("");
    
    sdk.console.log("Cleared traffic and reset scope due to project change");
  });

  sdk.console.log("Authify plugin initialized successfully with event-driven processing and project change detection");
}

