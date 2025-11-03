import { Classic } from "@caido/primevue";
import PrimeVue from "primevue/config";
import { createApp } from "vue";

import { SDKPlugin } from "./plugins/sdk";
import "./styles/index.css";
import type { FrontendSDK } from "./types";
import App from "./views/App.vue";
import { HTTPQLManager } from "./configs/httpql";

// Helper function to replace auth headers in HTTP request text
async function applyHeadersToReplay(sdk: any, requestText: string, authHeaders: string): Promise<string> {
  if (!requestText || !authHeaders.trim()) {
    return requestText;
  }

  const lines = requestText.split(/\r?\n/);
  if (lines.length < 1) {
    return requestText;
  }

  // Find the empty line that separates headers from body
  let headerEndIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim() === '') {
      headerEndIndex = i;
      break;
    }
  }

  // If no separator found, assume all remaining lines are headers
  if (headerEndIndex === -1) {
    headerEndIndex = lines.length;
  }

  // Parse existing headers
  const existingHeaders: Record<string, string> = {};
  for (let i = 1; i < headerEndIndex; i++) {
    const line = lines[i];
    if (line) {
      const trimmedLine = line.trim();
      const colonIndex = trimmedLine.indexOf(':');
      if (colonIndex > 0) {
        const headerName = trimmedLine.substring(0, colonIndex).trim();
        const headerValue = trimmedLine.substring(colonIndex + 1).trim();
        existingHeaders[headerName] = headerValue;
      }
    }
  }

  // Parse auth headers from config
  const authLines = authHeaders.split('\n').filter(line => line.trim());
  const newAuthHeaders: Record<string, string> = {};
  for (const line of authLines) {
    const trimmedLine = line.trim();
    const colonIndex = trimmedLine.indexOf(':');
    if (colonIndex > 0) {
      const headerName = trimmedLine.substring(0, colonIndex).trim();
      const headerValue = trimmedLine.substring(colonIndex + 1).trim();
      newAuthHeaders[headerName] = headerValue;
    }
  }

  // Get the header names from the config to know which ones to replace
  const configHeaderNames = Object.keys(newAuthHeaders);

  // Remove existing headers that match the ones in config (case-insensitive)
  const filteredHeaders: Record<string, string> = {};
  for (const [name, value] of Object.entries(existingHeaders)) {
    const lowerName = name.toLowerCase();
    const shouldReplace = configHeaderNames.some(configName => 
      lowerName === configName.toLowerCase()
    );
    
    if (!shouldReplace) {
      filteredHeaders[name] = value;
    }
  }

  // Add new auth headers
  const modifiedHeaders = { ...filteredHeaders, ...newAuthHeaders };

  // Reconstruct the request
  const requestLine = lines[0]; // GET /path HTTP/1.1
  const body = headerEndIndex < lines.length ? lines.slice(headerEndIndex + 1).join('\r\n') : '';
  
  // Apply match & replace rules to the request body (if any rules are configured)
  let modifiedBody = body;
  try {
    const hasRules = await sdk.backend.hasEnabledMatchReplaceRules();
    if (hasRules) {
      const modifiedBodyResult = await sdk.backend.applyMatchReplaceRules(body);
      modifiedBody = modifiedBodyResult;
      if (modifiedBody !== body) {
        console.log(`Applied match & replace rules to request body`);
      }
    }
  } catch (error) {
    console.warn("Error applying match & replace rules:", error);
    // Continue with original body if match & replace fails
  }
  
  let modifiedRequest = requestLine + '\r\n';
  
  // Add all headers
  for (const [name, value] of Object.entries(modifiedHeaders)) {
    modifiedRequest += `${name}: ${value}\r\n`;
  }
  
  // Add empty line and body
  modifiedRequest += '\r\n';
  if (modifiedBody) {
    modifiedRequest += modifiedBody;
  }

  return modifiedRequest;
}

// This is the entry point for the frontend plugin
export const init = (sdk: FrontendSDK) => {
  const app = createApp(App);

  // Load the PrimeVue component library
  app.use(PrimeVue, {
    unstyled: true,
    pt: Classic,
  });

  // Provide the FrontendSDK
  app.use(SDKPlugin, sdk);

  // Create the root element for the app
  const root = document.createElement("div");
  Object.assign(root.style, {
    height: "100%",
    width: "100%"
  });

  // Set the ID of the root element
  // Replace this with the value of the prefixWrap plugin in caido.config.ts
  // This is necessary to prevent styling conflicts between plugins
  root.id = `plugin--authify`;

  // Mount the app to the root element
  app.mount(root);

  // Add the page to the navigation
  // Make sure to use a unique name for the page
  sdk.navigation.addPage("/Authify", {
    body: root,
  });

  // Add a sidebar item
  sdk.sidebar.registerItem("Authify", "/Authify", {
    icon: "fas fa-shield-alt"
  });

  // Define command IDs
  const Commands = {
    processRequestFromHistory: "authify.process-request-from-history",
    sendHeadersToAuthify: "authify.send-headers-to-authify",
    applyHeadersToReplay: "authify.apply-headers-to-replay",
    createAuthifyFilter: "authify.create-authify-filter",
    getAuthifyFilter: "authify.get-authify-filter",
  } as const;

  // Helper function to extract request IDs from BaseContext (replay and http-history pages)
  const getRequestIdsFromBaseContext = (): string[] => {
    try {
      let requestId: string | undefined;
      
      switch (location.hash) {
        case "#/http-history": {
          console.log("Getting request from http-history HTML");
          
          // there's always a request selected in http history
          requestId = document
            .querySelector(".c-response[data-request-id]")
            ?.getAttribute("data-request-id") as string;
          
          break;
        }
        case "#/replay": {
          console.log("Getting request from replay HTML");
          
          const div: Element | null = document.querySelector(
            ".c-response[data-request-id]"
          );
          if (!div) {
            throw new Error("Request must be sent first");
          }
          
          requestId = div.getAttribute("data-request-id") as string;
          break;
        }
        default:
          throw new Error("Can't find request");
      }
      
      if (requestId) {
        return [requestId];
      } else {
        throw new Error("No request ID found in current page");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`No request found in current page: ${errorMessage}`);
    }
  };

  // Register command for processing requests from HTTP history
  sdk.commands.register(Commands.processRequestFromHistory, {
    name: "Process with Authify",
    run: async (context: any) => {      
      // Handle different context types
      let requestIds: string[] = [];
      
      if ((context as any)?.type === "RequestRowContext") {
        // Multiple requests selected from table rows
        requestIds = (context as any).requests
          .filter((request: any) => request.id !== undefined)
          .map((request: any) => request.id);
      } else if ((context as any)?.type === "RequestContext" && (context as any)?.request?.id) {
        // Single request selected
        requestIds = [(context as any).request.id];
      } else if ((context as any)?.type === "BaseContext" || !(context as any)?.type) {
        // BaseContext or no specific context - try to get request from current page
        try {
          requestIds = getRequestIdsFromBaseContext();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          sdk.window.showToast(errorMessage, { variant: "error" });
          return;
        }
      } else {
        sdk.window.showToast("No request selected", { variant: "error" });
        return;
      }

      if (requestIds.length === 0) {
        sdk.window.showToast("No valid requests found", { variant: "error" });
        return;
      }

      // Process each request
      let successCount = 0;
      let errorCount = 0;
      
      for (const requestId of requestIds) {
        try {
          const result = await sdk.backend.processRequestFromHistory(requestId);
          
          if (result.kind === "Error") {
            errorCount++;
          } else {
            successCount++;
          }
        } catch (error) {
          errorCount++;
        }
      }

      // Show appropriate success/error message
      if (successCount > 0 && errorCount === 0) {
        sdk.window.showToast(`Successfully processed ${successCount} request(s)! Check the Traffic tab for results.`, { variant: "success" });
      } else if (successCount > 0 && errorCount > 0) {
        sdk.window.showToast(`Processed ${successCount} request(s) successfully, ${errorCount} failed. Check the Traffic tab for results.`, { variant: "warning" });
      } else {
        sdk.window.showToast(`Failed to process ${errorCount} request(s). Check console for details.`, { variant: "error" });
      }
    },
  });

  // Register command for sending headers to Authify
  sdk.commands.register(Commands.sendHeadersToAuthify, {
    name: "Send headers to Authify",
    run: async (context: any) => {      
      // Handle different context types
      let requestIds: string[] = [];
      
      if ((context as any)?.type === "RequestRowContext") {
        // Multiple requests selected from table rows
        requestIds = (context as any).requests
          .filter((request: any) => request.id !== undefined)
          .map((request: any) => request.id);
      } else if ((context as any)?.type === "RequestContext" && (context as any)?.request?.id) {
        // Single request selected
        requestIds = [(context as any).request.id];
      } else if ((context as any)?.type === "BaseContext" || !(context as any)?.type) {
        // BaseContext or no specific context - try to get request from current page
        try {
          requestIds = getRequestIdsFromBaseContext();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          sdk.window.showToast(errorMessage, { variant: "error" });
          return;
        }
      } else {
        sdk.window.showToast("No request selected", { variant: "error" });
        return;
      }

      if (requestIds.length === 0) {
        sdk.window.showToast("No valid requests found", { variant: "error" });
        return;
      }

      // Process each request to extract and update headers
      let successCount = 0;
      let errorCount = 0;
      let totalHeadersUpdated = 0;
      
      let lastUpdatedHeaders = "";
      
      for (const requestId of requestIds) {
        try {
          const result = await sdk.backend.sendHeadersToAuthify(requestId);
          
          if (result.kind === "Error") {
            errorCount++;
          } else {
            lastUpdatedHeaders = result.value.headers; // Store the updated headers
            totalHeadersUpdated += result.value.count; // Add to total count
            successCount++;
          }
        } catch (error) {
          errorCount++;
        }
      }

      // Update the frontend auth textarea if we have updated headers
      if (successCount > 0 && lastUpdatedHeaders) {
        // Dispatch a custom event to update the auth headers in the frontend
        const event = new CustomEvent('authify-update-headers', {
          detail: { headers: lastUpdatedHeaders }
        });
        window.dispatchEvent(event);
      }

      // Show appropriate success/error message
      if (successCount > 0 && errorCount === 0) {
        sdk.window.showToast(`Successfully updated ${totalHeadersUpdated} auth header(s) from ${successCount} request(s)!`, { variant: "success" });
      } else if (successCount > 0 && errorCount > 0) {
        sdk.window.showToast(`Updated ${totalHeadersUpdated} auth header(s) from ${successCount} request(s), ${errorCount} failed.`, { variant: "warning" });
      } else {
        sdk.window.showToast(`Failed to update auth headers from ${errorCount} request(s). Check console for details.`, { variant: "error" });
      }
    },
  });

  // Register command for applying headers to replay
  sdk.commands.register(Commands.applyHeadersToReplay, {
    name: "Apply headers to Replay",
    run: async (context: any) => {      
      // Handle different context types

      // testing
      const view = sdk.window.getActiveEditor()?.getEditorView();
      if (view === undefined) {
        throw new Error("No active editor");
      }
      try {
        // Get current auth headers from backend
        const authResult = await sdk.backend.getAuthHeaders();
        if (authResult.kind === "Error") {
          sdk.window.showToast(`Failed to get auth headers: ${authResult.error}`, { variant: "error" });
          return;
        }

        const authHeaders = authResult.value;
        if (!authHeaders.trim()) {
          sdk.window.showToast("No auth headers configured. Please add headers in the Config tab first.", { variant: "warning" });
          return;
        }

        // Get current request text from editor
        const currentRequestText = view.state.doc.toJSON().join("\r\n");
        
        // Parse and replace auth headers in request text
        const modifiedRequestText = await applyHeadersToReplay(sdk, currentRequestText, authHeaders);
        
        // Update editor with modified request
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: modifiedRequestText },
        });
        view.focus();
        
        sdk.window.showToast("Auth headers applied successfully", { variant: "success" });
      }
      catch (error) {
        console.error("Error applying headers to replay:", error);
        sdk.window.showToast("Error applying headers to replay: " + error, { variant: "error" });
      }
    },
  });

  // Add to context menu for request rows (this is the correct type for HTTP History table)
  sdk.menu.registerItem({
    type: "RequestRow",
    commandId: Commands.processRequestFromHistory,
    leadingIcon: "fas fa-shield-alt",
  });

  // Also try registering for Request type in case that's needed for other contexts
  sdk.menu.registerItem({
    type: "Request",
    commandId: Commands.processRequestFromHistory,
    leadingIcon: "fas fa-shield-alt",
  });

  // Add "Send headers to Authify" to context menu for request rows
  sdk.menu.registerItem({
    type: "RequestRow",
    commandId: Commands.sendHeadersToAuthify,
    leadingIcon: "fas fa-arrow-up",
  });

  // Add "Send headers to Authify" to context menu for Request type
  sdk.menu.registerItem({
    type: "Request",
    commandId: Commands.sendHeadersToAuthify,
    leadingIcon: "fas fa-arrow-up",
  });


  // Add "Apply headers to Replay" to context menu for request rows
  sdk.menu.registerItem({
    type: "RequestRow",
    commandId: Commands.applyHeadersToReplay,
    leadingIcon: "fas fa-arrow-down",
  });

  // Add "Apply headers to Replay" to context menu for Request type
  sdk.menu.registerItem({
    type: "Request",
    commandId: Commands.applyHeadersToReplay,
    leadingIcon: "fas fa-arrow-down",
  });

  // Initialize HTTPQL manager
  const httpqlManager = new HTTPQLManager(sdk);

  // Register command for creating Authify filter
  sdk.commands.register(Commands.createAuthifyFilter, {
    name: "Create Authify Filter",
    run: async () => {
      try {
        const filter = await httpqlManager.createAuthifyFilter();
        if (filter) {
          sdk.window.showToast(`Authify filter created successfully!`, { variant: "success" });
        } else {
          sdk.window.showToast(`Failed to create Authify filter`, { variant: "error" });
        }
      } catch (error) {
        sdk.window.showToast(`Error creating Authify filter: ${error}`, { variant: "error" });
      }
    },
  });

  // Register command for getting Authify filter
  sdk.commands.register(Commands.getAuthifyFilter, {
    name: "Get Authify Filter",
    run: async () => {
      try {
        const filter = await httpqlManager.getAuthifyFilter();
        if (filter) {
          sdk.window.showToast(`Authify filter found: ${filter.name}`, { variant: "success" });
          console.log("Authify filter details:", filter);
        } else {
          sdk.window.showToast(`Authify filter not found`, { variant: "warning" });
        }
      } catch (error) {
        sdk.window.showToast(`Error retrieving Authify filter: ${error}`, { variant: "error" });
      }
    },
  });

  // Add commands to command palette for global access
  sdk.commandPalette.register(Commands.sendHeadersToAuthify);
  sdk.commandPalette.register(Commands.processRequestFromHistory);
  sdk.commandPalette.register(Commands.applyHeadersToReplay);
  sdk.commandPalette.register(Commands.createAuthifyFilter);
  sdk.commandPalette.register(Commands.getAuthifyFilter);

};
