import { Classic } from "@caido/primevue";
import PrimeVue from "primevue/config";
import { createApp } from "vue";

import { SDKPlugin } from "./plugins/sdk";
import "./styles/index.css";
import type { FrontendSDK } from "./types";
import App from "./views/App.vue";

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
          sdk.window.showToast(`Please send the request before applying new headers: ${errorMessage}`, { variant: "error" });
          return;
        }
      } else {
        sdk.window.showToast("Please send the request before applying new headers", { variant: "error" });
        return;
      }

      if (requestIds.length === 0) {
        sdk.window.showToast("No valid requests found", { variant: "error" });
        return;
      }

      // Process each request to apply headers
      let successCount = 0;
      let errorCount = 0;
      
      for (const requestId of requestIds) {
        try {
          const result = await sdk.backend.applyHeadersToReplay(requestId);
          
          if (result.kind === "Error") {
            errorCount++;
          } else {
            sdk.replay.openTab(result.value.id);
            successCount++;
          }
        } catch (error) {
          errorCount++;
        }
      }

      // Show appropriate success/error message
      if (successCount > 0 && errorCount === 0) {
        sdk.window.showToast(`Successfully applied auth headers to ${successCount} request(s) in Replay!`, { variant: "success" });
      } else if (successCount > 0 && errorCount > 0) {
        sdk.window.showToast(`Applied headers to ${successCount} request(s), ${errorCount} failed.`, { variant: "warning" });
      } else {
        sdk.window.showToast(`Failed to apply headers to ${errorCount} request(s). Check console for details.`, { variant: "error" });
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

  // Add commands to command palette for global access
  sdk.commandPalette.register(Commands.sendHeadersToAuthify);
  sdk.commandPalette.register(Commands.processRequestFromHistory);
  sdk.commandPalette.register(Commands.applyHeadersToReplay);

};
