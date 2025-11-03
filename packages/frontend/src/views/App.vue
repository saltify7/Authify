<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed, watch, nextTick } from "vue";
import Textarea from "primevue/textarea";
import TabView from "primevue/tabview";
import TabPanel from "primevue/tabpanel";
import Splitter from "primevue/splitter";
import SplitterPanel from "primevue/splitterpanel";
import DataTable from "primevue/datatable";
import Column from "primevue/column";
import ToggleButton from "primevue/togglebutton";
import Button from "primevue/button";
import Dropdown from "primevue/dropdown";
import ContextMenu from "primevue/contextmenu";

import { useSDK } from "@/plugins/sdk";
import { prettifyHttpData } from "@/utils/json-prettify";
import { StorageManager } from "@/utils/storage";
import { ScopesManager } from "@/configs/scopes";
import { AuthConfigManager } from "@/configs/auth-config";
import { MatchReplaceManager, type MatchReplaceRule } from "@/configs/match-replace";
import { HTTPQLManager } from "@/configs/httpql";

// SDK instance
const sdk = useSDK();

// Storage manager instance
const storage = new StorageManager(sdk);

// Scopes manager instance
const scopesManager = new ScopesManager(sdk, storage);

// Auth config manager instance
const authConfigManager = new AuthConfigManager(sdk, storage);

// Match & Replace manager instance
const matchReplaceManager = new MatchReplaceManager(sdk, storage);

// HTTPQL manager instance
const httpqlManager = new HTTPQLManager(sdk);

// HTTPQL filter polling
let httpqlPollingInterval: ReturnType<typeof setInterval> | undefined = undefined;

// Filter status state
const isCustomFilterActive = ref(false);
const isCustomFilterEnabled = ref(false);
let filterStatusPollingInterval: ReturnType<typeof setInterval> | undefined = undefined;

// Caido request/response editors
const reqEditor = ref<any>(null);
const respEditor = ref<any>(null);
const reqEditorElement = ref<HTMLElement | null>(null);
const respEditorElement = ref<HTMLElement | null>(null);
const tableWrapper = ref<HTMLElement | null>(null);

// Auth config state is now managed by authConfigManager
const auth = authConfigManager.authHeaders;

// Match & Replace rules state
const matchReplaceRules = ref<MatchReplaceRule[]>([]);

// Plugin state: on/off toggle
const isEnabled = ref(false);

// View toggle for original vs modified request/response
const showModified = ref(false);

// JSON prettification toggle
const enableJsonPrettify = ref(true);

// Dynamic height for traffic container
const trafficHeight = ref(600);

// Workspace scopes state is now managed by scopesManager
const workspaceScopes = scopesManager.workspaceScopes;
const selectedScope = scopesManager.selectedScope;

// Filter settings state - individual refs for better reactivity
const ignoreStyling = ref(true);
const ignoreJavaScript = ref(true);
const ignoreImages = ref(true);
const ignoreOptions = ref(true);

// How to Use tab state
const selectedConfig = ref<string | undefined>(undefined);
const selectedConfigContent = ref<string | undefined>(undefined);
const selectedTraffic = ref<string | undefined>(undefined);
const selectedTrafficContent = ref<string | undefined>(undefined);
const selectedTip = ref<string | undefined>(undefined);
const selectedTipContent = ref<string | undefined>(undefined);

// Computed property to create the filter settings object
const filterSettings = computed(() => ({
  ignoreStyling: ignoreStyling.value,
  ignoreJavaScript: ignoreJavaScript.value,
  ignoreImages: ignoreImages.value,
  ignoreOptions: ignoreOptions.value
}));

// Pane 2 state: requests table + viewers
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
const rows = ref<Row[]>([]);
const selected = ref<Row | undefined>(undefined);
const activeTabIndex = ref(0);

// Context menu state
const contextMenu = ref<any>(null);
const contextMenuRow = ref<Row | undefined>(undefined);


let resizeObserver: ResizeObserver | undefined = undefined;

// Function to calculate and set the traffic container height
const updateTrafficHeight = () => {
  // Get the window height
  const windowHeight = window.innerHeight;
  
  const reservedHeight = 175;
  
  // Set the traffic height to available space
  const availableHeight = Math.max(windowHeight - reservedHeight, 400); // Minimum 400px
  trafficHeight.value = availableHeight;
};

// Handle custom events to update auth headers from context menu
const handleAuthHeadersUpdate = async (event: CustomEvent) => {
  if (event.detail && event.detail.headers) {
    auth.value = event.detail.headers;
    
    // Save to storage for persistence using AuthConfigManager
    await authConfigManager.handleAuthHeadersChange(event.detail.headers);
  }
};

// Function to refresh scopes (can be called manually or on project change)
const refreshScopes = async () => {
  const result = await scopesManager.refreshScopes();
  if (result?.shouldClearTraffic) {
    rows.value = [];
    selected.value = undefined;
  }
};

// Load all settings from storage at once
const loadAllSettings = async () => {
  // Load project-specific auth config
  await authConfigManager.loadProjectAuthConfig();
  
  // Load project-specific match & replace rules
  const loadedRules = await matchReplaceManager.loadProjectMatchReplaceRules();
  matchReplaceRules.value = loadedRules;
  
  // Send loaded rules to backend for processing
  if (loadedRules.length > 0) {
    try {
      const result = await sdk.backend.saveMatchReplaceRules(loadedRules);
      if (result.kind === "Error") {
        sdk.window.showToast(`Failed to sync match & replace rules to backend: ${result.error}`, { variant: "error" });
      } else {
        console.log("Synced project match & replace rules to backend on load");
      }
    } catch (error) {
      console.warn("Error syncing match & replace rules to backend on load:", error);
      sdk.window.showToast("Failed to sync match & replace rules to backend", { variant: "error" });
    }
  }
  
  // Note: selected scope is loaded separately in loadWorkspaceScopes()
  // because it depends on the available scopes being loaded first
};

onMounted(async () => {
  // Initialize Caido request/response editors
  reqEditor.value = sdk.ui.httpRequestEditor();
  respEditor.value = sdk.ui.httpResponseEditor();
  
  // Wait for next tick to ensure DOM is ready
  await nextTick();
  
  // Get DOM elements for the editors and mount them
  const reqElement = reqEditor.value.getElement();
  const respElement = respEditor.value.getElement();
  
  // Mount the editors to their containers
  if (reqEditorElement.value && reqElement) {
    reqEditorElement.value.appendChild(reqElement);
  }
  
  if (respEditorElement.value && respElement) {
    respEditorElement.value.appendChild(respElement);
  }
  
  // Load workspace scopes
  void scopesManager.loadWorkspaceScopes();
  
  // Start auto-refresh scopes every 5 seconds
  autoRefreshScopes();
  
  // Start HTTPQL filter polling
  startHttpqlPolling();
  
  // Start filter status polling
  startFilterStatusPolling();
  
  // Load filter settings
  void loadFilterSettings();
  
  // Load all settings from storage at once
  void loadAllSettings();
  
  // Seed once on mount
  const initial = await sdk.backend.getTraffic();
  if (initial.kind === "Ok") {
    rows.value = initial.value;
  }
  
  // Listen for backend table changes
  sdk.backend.onEvent("tableChanged", (traffic) => {
    rows.value = traffic as unknown as Row[];
  });

  sdk.backend.onEvent("projectChanged", async (projectName) => {
    // Refresh scopes, auth config, and match & replace rules on project change
    const [scopesResult, authResult, matchReplaceResult] = await Promise.all([
      refreshScopes(),
      authConfigManager.refreshAuthConfig(),
      matchReplaceManager.refreshMatchReplaceRules()
    ]);
    
    // Load project-specific match & replace rules
    const loadedRules = await matchReplaceManager.loadProjectMatchReplaceRules();
    matchReplaceRules.value = loadedRules;
    
    // Send loaded rules to backend for processing
    if (loadedRules.length > 0) {
      try {
        const result = await sdk.backend.saveMatchReplaceRules(loadedRules);
        if (result.kind === "Error") {
          sdk.window.showToast(`Failed to sync match & replace rules to backend: ${result.error}`, { variant: "error" });
        } else {
          console.log("Synced project match & replace rules to backend");
        }
      } catch (error) {
        console.warn("Error syncing match & replace rules to backend:", error);
        sdk.window.showToast("Failed to sync match & replace rules to backend", { variant: "error" });
      }
    }
    
    // Clear traffic if any configuration changed
    if ((scopesResult as any)?.shouldClearTraffic || (authResult as any)?.shouldClearTraffic || (matchReplaceResult as any)?.shouldClearTraffic) {
      rows.value = [];
      selected.value = undefined;
    }
  });
  
  // Set initial traffic height
  updateTrafficHeight();
  
  // Add window resize listener
  window.addEventListener('resize', updateTrafficHeight);
  
  // Use ResizeObserver to watch for container size changes
  const container = document.querySelector('#plugin--authify');
  if (container) {
    resizeObserver = new ResizeObserver(() => {
      updateTrafficHeight();
    });
    resizeObserver.observe(container);
  }
  
  // Listen for custom events to update auth headers from context menu
  window.addEventListener('authify-update-headers', handleAuthHeadersUpdate as unknown as EventListener);
  
  // Add keyboard shortcut for CTRL+R to send current row to replay
  window.addEventListener('keydown', handleGlobalKeydown);
});

onBeforeUnmount(() => {
  // Clean up resize listener
  window.removeEventListener('resize', updateTrafficHeight);
  
  // Clean up auth headers update listener
  window.removeEventListener('authify-update-headers', handleAuthHeadersUpdate as unknown as EventListener);
  
  // Clean up keyboard shortcut listener
  window.removeEventListener('keydown', handleGlobalKeydown);
  
  // Clean up scope refresh timeout
  if (scopeRefreshTimeout !== undefined) {
    clearTimeout(scopeRefreshTimeout);
  }
  
  // Clean up HTTPQL filter polling
  stopHttpqlPolling();
  
  // Clean up filter status polling
  stopFilterStatusPolling();
  
  // Clean up ResizeObserver
  if (resizeObserver !== undefined) {
    resizeObserver.disconnect();
  }
  
  // Clean up match replace manager
  matchReplaceManager.destroy();
});


// Watch for toggle button changes and notify backend
watch(isEnabled, async (newValue) => {
  const result = await sdk.backend.setPluginEnabled(newValue);
  if (result.kind === "Error") {
    sdk.window.showToast(`Failed to ${newValue ? 'enable' : 'disable'} plugin: ${result.error}`, { variant: "error" });
  } else {
    if (newValue) {
      // Save current auth headers when turning on
      await saveAuthHeaders();
      sdk.window.showToast("Plugin enabled - monitoring new requests", { variant: "success" });
    } else {
      sdk.window.showToast("Plugin disabled - stopped monitoring", { variant: "info" });
    }
  }
});

// Watch for scope changes and notify backend
watch(selectedScope, async (newScope) => {
  await scopesManager.handleScopeChange(newScope, rows, selected);
});

// Watch for filter settings changes and notify backend
watch(filterSettings, async (newSettings) => {
  const result = await sdk.backend.setFilterSettings(newSettings);
  if (result.kind === "Error") {
    sdk.window.showToast(`Failed to update filters: ${result.error}`, { variant: "error" });
  } else {
    sdk.window.showToast("Filter settings updated", { variant: "success" });
  }
}, { deep: true });

// Watch for auth headers changes and auto-save
watch(auth, () => {
  // Only auto-save if plugin is not enabled (to avoid saving while monitoring)
  if (!isEnabled.value) {
    autoSaveAuthHeaders();
  }
});

// Watch for selection changes and update editors
watch(selected, () => {
  void updateEditors();
});

// Watch for view mode changes and update editors
watch(showModified, () => {
  void updateEditors();
});

// Watch for JSON prettification toggle changes and update editors
watch(enableJsonPrettify, () => {
  void updateEditors();
});

// Function to save auth headers to backend and storage
const saveAuthHeaders = async () => {
  await authConfigManager.handleAuthHeadersChange(auth.value);
};

// Auto-save auth headers when user types (with debouncing)
let authSaveTimeout: ReturnType<typeof setTimeout> | undefined = undefined;
const autoSaveAuthHeaders = () => {
  // Clear existing timeout
  if (authSaveTimeout !== undefined) {
    clearTimeout(authSaveTimeout);
  }
  
  // Set new timeout to save after 500ms of no typing
  authSaveTimeout = setTimeout(async () => {
    await saveAuthHeaders();
  }, 500);
};

// Match & Replace functions (delegated to manager)
const addMatchReplaceRule = () => {
  matchReplaceManager.addMatchReplaceRule(matchReplaceRules);
};

const removeMatchReplaceRule = (id: string) => {
  matchReplaceManager.removeMatchReplaceRule(matchReplaceRules, id);
};

const toggleMatchReplaceRule = (id: string) => {
  matchReplaceManager.toggleMatchReplaceRule(matchReplaceRules, id);
};

const updateMatchReplaceRule = (id: string, field: 'match' | 'replace', value: string) => {
  matchReplaceManager.updateMatchReplaceRule(matchReplaceRules, id, field, value);
};

// Auto-refresh scopes every 5 seconds
let scopeRefreshTimeout: ReturnType<typeof setTimeout> | undefined = undefined;
const autoRefreshScopes = () => {
  // Clear existing timeout
  if (scopeRefreshTimeout !== undefined) {
    clearTimeout(scopeRefreshTimeout);
  }
  
  // Set new timeout to refresh after 5 seconds
  scopeRefreshTimeout = setTimeout(async () => {
    await scopesManager.refreshScopes();
    await scopesManager.handleScopeChange(selectedScope.value, rows, selected);
    // Schedule next refresh
    autoRefreshScopes();
  }, 5000);
};

// How to Use tab data and handlers
const configOptions = [
  { label: "Authentication Headers", value: "auth-headers" },
  { label: "Scope Selection", value: "scope-selection" },
  { label: "Match & Replace", value: "match-replace" },
  { label: "Request Filters", value: "request-filters" },
  { label: "HTTPQL Filtering", value: "httpql-filtering" }
];

const trafficOptions = [
  { label: "Table Layout", value: "table-layout" },
  { label: "Traffic Comparison", value: "traffic-comparison" },
  { label: "Sending to Replay", value: "sending-to-replay" }
];

const tipsAndTricks = [
  { label: "Process with Authify", value: "send-to-authify" },
  { label: "Send Headers to Authify", value: "send-headers" },
  { label: "Apply Headers to Replay", value: "apply-headers-replay" }
];

const onConfigSelect = () => {
  const configs: Record<string, string> = {
    "auth-headers": "Configure your authentication headers in the textarea. Paste headers one per line in the format 'Header-Name: value'. These headers will be automatically added to requests when the plugin is enabled. Headers are auto-saved as you type and persist between sessions.",
    "scope-selection": "Set a workspace scope to focus on specific domains or applications. You can select any scope from the workspace. Use 'Unset Scope' to process all HTTP traffic (though this might slow down the plugin).",
    "match-replace": "Configure automatic string replacements in the body of replayed requests and enable/disable them individually. Useful for replacing CSRF tokens or other values in the request body.",
    "request-filters": "Enable filters to reduce noise in your traffic view. Ignore styling files (CSS, SCSS), JavaScript files, images, and OPTIONS requests.",
    "httpql-filtering": "Create custom filters using HTTPQL for advanced request filtering. After creating a filter, it will appear in Caido's Overview > Filters sidebar. Use the toggle to enable/disable the filter."
  };
  selectedConfigContent.value = configs[selectedConfig.value || ""] || undefined;
};

const onTrafficSelect = () => {
  const traffic: Record<string, string> = {
    "table-layout": "The traffic table shows captured requests with columns for method, URL, status, content length, and comparison results. Select a request to view its details in the right panel. Use the 'Show Modified' toggle to switch between original and modified request/response views.",
    "traffic-comparison": "Authify automatically compares responses and indicates if they are the same, different, similar, or unknown. The comparison considers status codes, content length, and response content.",
    "sending-to-replay": "Select any request in the traffic table and click 'Send to Replay' to send it to Caido's Replay feature. Choose between sending the original request or the modified version (with your auth headers applied) using the 'Show Modified' toggle."
  };
  selectedTrafficContent.value = traffic[selectedTraffic.value || ""] || undefined;
};

const onTipSelect = () => {
  const tips: Record<string, string> = {
    "send-to-authify": "Right-click on any request anywhere in Caido and select 'Process with Authify' to quickly add it to the Authify traffic table. This lets you manually test or replay specific requests with your configured authentication headers.",
    "send-headers": "Right-click on any request anywhere in Caido to 'Send headers to Authify'. This automatically extracts authentication headers from the selected request and updates your configuration. Perfect for refreshing tokens after expiry or logout!",
    "apply-headers-replay": "Right-click on any request in Caido's Replay tab or HTTP History and select 'Apply headers to Replay' to automatically inject your configured authentication headers into a new Replay session.",
  };
  selectedTipContent.value = tips[selectedTip.value || ""] || undefined;
};

// Function to clear the traffic table
const clearTable = async () => {
  const result = await sdk.backend.clearTraffic();
  if (result.kind === "Error") {
    sdk.window.showToast(`Failed to clear table: ${result.error}`, { variant: "error" });
  } else {
    sdk.window.showToast("Traffic table cleared", { variant: "success" });
    // Clear the local rows and selection
    rows.value = [];
    selected.value = undefined;
  }
};

// Function to create Authify filter
const createAuthifyFilter = async () => {
  try {
    const filter = await httpqlManager.createAuthifyFilter();
    if (filter) {
      sdk.window.showToast(`Authify filter created successfully! Configure it in Overview > Filters.`, { variant: "success" });
    } else {
      sdk.window.showToast(`Failed to create Authify filter`, { variant: "error" });
    }
  } catch (error) {
    sdk.window.showToast(`Error creating Authify filter: ${error}`, { variant: "error" });
  }
};

// Start HTTPQL filter polling
const startHttpqlPolling = () => {
  if (httpqlPollingInterval !== undefined) {
    return; // Already running
  }
  
  httpqlPollingInterval = setInterval(async () => {
    if (isCustomFilterEnabled.value) {
      await httpqlManager.syncFilterWithBackend();
    } else {
      // When disabled, always set filter to null
      await sdk.backend.storeHttpqlFilter(null);
    }
  }, 3000); // Poll every 3 seconds
  
  console.log("Started HTTPQL filter polling (every 5 seconds)");
};

// Stop HTTPQL filter polling
const stopHttpqlPolling = () => {
  if (httpqlPollingInterval !== undefined) {
    clearInterval(httpqlPollingInterval);
    httpqlPollingInterval = undefined;
    console.log("Stopped HTTPQL filter polling");
  }
};

// Check if custom filter is active
const checkFilterStatus = async () => {
  try {
    if (!isCustomFilterEnabled.value) {
      isCustomFilterActive.value = false;
      return;
    }
    
    const result = await sdk.backend.isHttpqlFilterActive();
    if (result.kind === "Ok") {
      isCustomFilterActive.value = result.value;
    } else {
      console.error("Error checking filter status:", result.error);
      isCustomFilterActive.value = false;
    }
  } catch (error) {
    console.error("Error checking filter status:", error);
    isCustomFilterActive.value = false;
  }
};

// Start filter status polling
const startFilterStatusPolling = () => {
  if (filterStatusPollingInterval !== undefined) {
    return; // Already running
  }
  
  // Check immediately
  void checkFilterStatus();
  
  filterStatusPollingInterval = setInterval(async () => {
    await checkFilterStatus();
  }, 2000); // Poll every 2 seconds
  
  console.log("Started filter status polling (every 2 seconds)");
};

// Stop filter status polling
const stopFilterStatusPolling = () => {
  if (filterStatusPollingInterval !== undefined) {
    clearInterval(filterStatusPollingInterval);
    filterStatusPollingInterval = undefined;
    console.log("Stopped filter status polling");
  }
};

// Handle custom filter toggle change
const toggleCustomFilter = async () => {
  console.log("toggleCustomFilter called, isCustomFilterEnabled:", isCustomFilterEnabled.value);
  
  if (!isCustomFilterEnabled.value) {
    // When disabling, immediately set filter to null
    try {
      console.log("Disabling filter - setting to null");
      await sdk.backend.storeHttpqlFilter(null);
      isCustomFilterActive.value = false;
      console.log("Custom filter disabled, set to null");
    } catch (error) {
      console.error("Error disabling custom filter:", error);
    }
  } else {
    // When enabling, sync filter with backend immediately
    console.log("Enabling filter - syncing with backend");
    await httpqlManager.syncFilterWithBackend();
    await checkFilterStatus();
    console.log("Custom filter enabled and synced");
  }
};

// Force set filter to null (for debugging)
const forceSetFilterToNull = async () => {
  try {
    console.log("Force setting filter to null");
    await sdk.backend.storeHttpqlFilter(null);
    isCustomFilterActive.value = false;
    console.log("Filter force-set to null");
  } catch (error) {
    console.error("Error force-setting filter to null:", error);
  }
};

// Watch for changes in filter enabled state
watch(isCustomFilterEnabled, async (newValue) => {
  console.log("Filter enabled state changed to:", newValue);
  await toggleCustomFilter();
  
  // Force set to null when disabled
  if (!newValue) {
    await forceSetFilterToNull();
  }
});

// Function to send selected request to replay
const sendToReplay = async () => {
  if (!selected.value) {
    sdk.window.showToast("No request selected", { variant: "error" });
    return;
  }

  const result = await sdk.backend.sendToReplay(selected.value.id, showModified.value);
  if (result.kind === "Error") {
    sdk.window.showToast(`Failed to send to replay: ${result.error}`, { variant: "error" });
  } else {
    const requestType = showModified.value ? "modified" : "original";
    sdk.window.showToast(`Sent ${requestType} request to replay`, { variant: "success" });
    sdk.replay.openTab(result.value.id);
  }
};

// Function to load filter settings
const loadFilterSettings = async () => {
  try {
    const result = await sdk.backend.getFilterSettings();
    if (result.kind === "Ok") {
      ignoreStyling.value = result.value.ignoreStyling;
      ignoreJavaScript.value = result.value.ignoreJavaScript;
      ignoreImages.value = result.value.ignoreImages;
      ignoreOptions.value = result.value.ignoreOptions;
    } else {
      sdk.window.showToast(`Failed to load filter settings: ${result.error}`, { variant: "error" });
    }
  } catch (error) {
    console.warn('Could not load filter settings:', error);
    sdk.window.showToast('Could not load filter settings', { variant: "error" });
  }
};


// Function to reinitialize editors
const reinitializeEditors = async () => {
  try {
    // Clear existing editors
    if (reqEditorElement.value) {
      reqEditorElement.value.innerHTML = '';
    }
    if (respEditorElement.value) {
      respEditorElement.value.innerHTML = '';
    }
    
    // Recreate editors
    reqEditor.value = sdk.ui.httpRequestEditor();
    respEditor.value = sdk.ui.httpResponseEditor();
    
    // Wait for next tick
    await nextTick();
    
    // Remount editors
    const reqElement = reqEditor.value.getElement();
    const respElement = respEditor.value.getElement();
    
    if (reqEditorElement.value && reqElement) {
      reqEditorElement.value.appendChild(reqElement);
    }
    if (respEditorElement.value && respElement) {
      respEditorElement.value.appendChild(respElement);
    }
  } catch (error) {
    console.warn("Error reinitializing editors:", error);
  }
};

// Function to update editors with selected request/response data
const updateEditors = async () => {
  if (!selected.value) {
    return;
  }
  
  try {
    // Reinitialize editors on every update to prevent state corruption
    await reinitializeEditors();
    
    // Wait a bit for editors to be ready
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Get the current request/response data based on showModified toggle
    const rawReqData = showModified.value ? selected.value?.modifiedReqRaw : selected.value?.reqRaw;
    const rawRespData = showModified.value ? selected.value?.modifiedRespRaw : selected.value?.respRaw;
    
    // Prettify JSON in the data before displaying (if enabled)
    const reqData = rawReqData && enableJsonPrettify.value ? prettifyHttpData(rawReqData) : rawReqData;
    const respData = rawRespData && enableJsonPrettify.value ? prettifyHttpData(rawRespData) : rawRespData;
    
    // Update the editors with the raw HTTP data using the correct Caido API
    if (reqData && reqEditor.value) {
      try {
        const view = reqEditor.value.getEditorView();
        if (view && view.state) {
          const currentLength = view.state.doc.length;
          view.dispatch({
            changes: {
              from: 0,
              to: currentLength,
              insert: reqData,
            },
          });
        }
      } catch (error) {
        console.warn("Error updating request editor:", error);
      }
    }
    
    if (respData && respEditor.value) {
      try {
        const view = respEditor.value.getEditorView();
        if (view && view.state) {
          const currentLength = view.state.doc.length;
          view.dispatch({
            changes: {
              from: 0,
              to: currentLength,
              insert: respData,
            },
          });
        }
      } catch (error) {
        console.warn("Error updating response editor:", error);
      }
    }
  } catch (error) {
    console.warn("Error updating editors:", error);
  }
};


// Function to handle table keyboard navigation
const handleTableKeydown = (event: KeyboardEvent) => {
  if (rows.value.length === 0) return;
  
  const currentIndex = selected.value ? rows.value.findIndex(row => row.id === selected.value?.id) : -1;
  
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (currentIndex > 0) {
      selected.value = rows.value[currentIndex - 1];
    } else if (currentIndex === -1 && rows.value.length > 0) {
      // If nothing is selected, select the last row
      selected.value = rows.value[rows.value.length - 1];
    }
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (currentIndex < rows.value.length - 1) {
      selected.value = rows.value[currentIndex + 1];
    } else if (currentIndex === -1 && rows.value.length > 0) {
      // If nothing is selected, select the first row
      selected.value = rows.value[0];
    }
  }
};

// Function to handle global keyboard shortcuts
const handleGlobalKeydown = (event: KeyboardEvent) => {
  // Only react if Caido window is focused and visible
  if (!document.hasFocus() || document.visibilityState !== 'visible') return;

  // Only react if our plugin panel is present and visible
  const panel = document.querySelector('#plugin--authify') as HTMLElement | null;
  if (!panel || panel.offsetParent === null) return;

  // Check if CTRL+R is pressed and we're in the Traffic tab with a selected row
  if (event.ctrlKey && event.key === 'r' && activeTabIndex.value === 1 && selected.value) {
    event.preventDefault();
    event.stopPropagation();
    
    // Send the current row to replay (original or modified based on showModified toggle)
    void sendToReplay();
  }
};

// Context menu items
const contextMenuItems = ref([
  {
    label: "Repeat Request",
    icon: "fas fa-redo",
    command: () => {
      if (contextMenuRow.value) {
        repeatRequest(contextMenuRow.value);
      }
    }
  },
  {
    label: "Ignore path in HTTPQL Filter",
    icon: "fas fa-ban",
    command: () => {
      if (contextMenuRow.value) {
        ignorePathInHttpql(contextMenuRow.value);
      }
    }
  }
]);

// Handle right-click on table
const handleTableContextMenu = (event: MouseEvent) => {
  // Find the row that was right-clicked
  const target = event.target as HTMLElement;
  const rowElement = target.closest('tr');
  
  if (!rowElement) {
    return;
  }
  
  // Skip header rows (they're in thead)
  if (rowElement.closest('thead')) {
    return;
  }
  
  // Find the tbody element and get row index
  const tbody = rowElement.closest('tbody');
  if (!tbody) {
    return;
  }
  
  const rowIndex = Array.from(tbody.querySelectorAll('tr')).indexOf(rowElement);
  
  // Match row by index (excluding header)
  if (rowIndex >= 0 && rowIndex < rows.value.length) {
    const row = rows.value[rowIndex];
    event.preventDefault();
    contextMenuRow.value = row;
    contextMenu.value.show(event);
  }
};

// Placeholder functions for context menu actions
const repeatRequest = async (row: Row) => {
  const result = await sdk.backend.processRequestFromHistory(row.id);
  if (result.kind === "Error") {
    sdk.window.showToast(`Failed to repeat request: ${result.error}`, { variant: "error" });
  } else {
    sdk.window.showToast("Request repeated successfully", { variant: "success" });
  }
};

const ignorePathInHttpql = async (row: Row) => {
  // Get the current authify filter
  const authifyFilter = await httpqlManager.getAuthifyFilter();
  
  if (!authifyFilter) {
    sdk.window.showToast("Please create an Authify filter first in the Configuration tab", { variant: "error" });
    return;
  }
  
  // Extract just the path (without query params)
  // The row.path field might include query params, so we need to parse it
  let pathWithoutQuery = row.path;
  try {
    // If path contains query params (has '?'), extract just the pathname
    const queryIndex = pathWithoutQuery.indexOf('?');
    if (queryIndex !== -1) {
      pathWithoutQuery = pathWithoutQuery.substring(0, queryIndex);
    }
  } catch (error) {
    console.warn("Error parsing path:", error);
  }
  
  // Build the new query
  // Note: In HTTPQL, paths are request properties, so use req.path
  // ncont means "does not contain" - this will exclude requests with this path
  let newQuery = `req.path.ncont:"${pathWithoutQuery}"`;
  
  // If there's already a query, prepend with " AND "
  const currentQuery = authifyFilter.query?.trim() || '';
  if (currentQuery !== '') {
    newQuery = `${currentQuery} AND ${newQuery}`;
  }
  
  // Update the filter
  const updatedFilter = await httpqlManager.updateFilter(authifyFilter.id, {
    name: authifyFilter.name,
    alias: authifyFilter.alias,
    query: newQuery
  });
  
  if (!updatedFilter) {
    sdk.window.showToast("Failed to update HTTPQL filter", { variant: "error" });
    return;
  }
  
  // Sync with backend
  await httpqlManager.syncFilterWithBackend();
  
  sdk.window.showToast(`Path "${pathWithoutQuery}" added to HTTPQL filter`, { variant: "success" });
};

</script>

<template>
  <div class="h-full w-full flex flex-col overflow-auto">
    <!-- Header with toggle button -->
    <div class="flex items-center justify-between p-3 border-b border-surface-700 bg-surface-800">
      <div class="flex items-center gap-4">
        <h2 class="text-lg font-semibold text-surface-0">Authify</h2>
        
        <!-- Workspace Scope Dropdown -->
        <div class="flex items-center gap-2">
          <span class="text-sm text-surface-300">Scope:</span>
          <Dropdown
            v-model="selectedScope"
            :options="workspaceScopes"
            optionLabel="label"
            optionValue="value"
            placeholder="Unset Scope"
            :pt="{
              root: { style: 'min-width: 120px; max-width: 320px; width: auto;' },
              input: { class: 'text-xs bg-surface-700 border-surface-600 text-surface-0 rounded-lg', style: 'min-width: 120px; max-width: 320px; width: 100%;' },
              panel: { class: 'bg-surface-700 border-surface-600 rounded-lg', style: 'min-width: 120px; max-width: 320px; width: auto;' },
              item: { class: 'text-xs text-surface-0 hover:bg-surface-600' }
            }"
            style="min-width: 120px; max-width: 320px; width: auto;"
            @click="refreshScopes"
          />
          
          <!-- Custom Filter Status Info Box -->
          <div 
            class="flex items-center gap-1 px-2 py-1 rounded-md"
            :class="!isCustomFilterEnabled 
              ? 'bg-gray-900/20 border border-gray-500/30'
              : isCustomFilterActive 
                ? 'bg-green-900/20 border border-green-500/30' 
                : 'bg-red-900/20 border border-red-500/30'"
          >
            <i 
              class="fas fa-sliders-h text-xs"
              :class="!isCustomFilterEnabled 
                ? 'text-gray-400'
                : isCustomFilterActive 
                  ? 'text-green-400' 
                  : 'text-red-400'"
            ></i>
            <span 
              class="text-xs"
              :class="!isCustomFilterEnabled 
                ? 'text-gray-300'
                : isCustomFilterActive 
                  ? 'text-green-300' 
                  : 'text-red-300'"
            >
              {{ !isCustomFilterEnabled 
                ? 'HTTPQL Filter Disabled' 
                : isCustomFilterActive 
                  ? 'HTTPQL Filter Active' 
                  : 'HTTPQL Filter Not Found' }}
            </span>
          </div>
        </div>
      </div>
      
      <!-- Plugin Status in the middle -->
      <div class="flex items-center gap-2">
        <span class="text-sm text-surface-300">Plugin Status:</span>
        <ToggleButton
          v-model="isEnabled"
          onLabel="ON"
          offLabel="OFF"
          onIcon="fas fa-check"
          offIcon="fas fa-times"
          class="w-40"
          :pt="{
            root: { 
              class: `w-40 h-8 rounded-lg ${isEnabled ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'} border-0` 
            },
            label: { class: 'text-xs font-medium text-white' }
          }"
        />
      </div>
      
      <!-- View Toggle and JSON Prettify on the right -->
      <div class="flex items-center gap-3">
        <span class="text-sm text-surface-300">View:</span>
        <ToggleButton
          v-model="showModified"
          onLabel="Modified"
          offLabel="Original"
          onIcon="fas fa-edit"
          offIcon="fas fa-eye"
          class="w-24"
          :pt="{
            root: { 
              class: `w-24 h-8 rounded-lg ${showModified ? 'bg-blue-600 hover:bg-blue-700' : 'bg-surface-600 hover:bg-surface-700'} border-0` 
            },
            label: { class: 'text-xs font-medium text-white' }
          }"
        />
        <span class="text-sm text-surface-300">JSON:</span>
        <ToggleButton
          v-model="enableJsonPrettify"
          onLabel="Pretty"
          offLabel="Raw"
          onIcon="fas fa-code"
          offIcon="fas fa-align-left"
          class="w-20"
          :pt="{
            root: { 
              class: `w-20 h-8 rounded-lg ${enableJsonPrettify ? 'bg-green-600 hover:bg-green-700' : 'bg-surface-600 hover:bg-surface-700'} border-0` 
            },
            label: { class: 'text-xs font-medium text-white' }
          }"
        />
      </div>
    </div>
    
    <TabView
      v-model:activeIndex="activeTabIndex"
      class="flex-1 min-h-0 flex flex-col"
      :pt="{
        root: { class: 'h-full flex flex-col' },
        panelContainer: { class: 'flex-1 min-h-0 flex flex-col' },
        panel: { class: 'flex-1 min-h-0 p-0 flex flex-col' }
      }"
    >
      <TabPanel header="Configuration">
        <div class="flex-1 min-h-0 flex flex-col p-4">
          <!-- Auth Headers Section -->
          <div class="mb-6 w-full">
            <div class="flex items-center gap-2 mb-3">
              <h3 class="text-lg font-semibold text-surface-0">Auth Headers</h3>
              <div class="relative group">
                <i class="fas fa-info-circle text-surface-400 text-sm cursor-help"></i>
                <div class="absolute top-full left-0 mt-2 px-3 py-2 bg-surface-900 text-surface-0 text-sm rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                  Paste authentication headers (Cookie, Authorization, etc. - one per line). These headers will be automatically added to replayed requests. Read-only while monitoring is active.
                  <div class="absolute bottom-full left-4 w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-surface-900"></div>
                </div>
              </div>
              <span v-if="isEnabled" class="text-xs text-amber-400">(Read-only while monitoring)</span>
            </div>
            <div class="w-full">
              <Textarea
                v-model="auth"
                class="w-full"
                rows="8"
                :readonly="isEnabled"
                placeholder="Paste authentication headers (Cookie, Authorization, etc. - one per line)...
                
e.g. 
Cookie: session_id=abc123;
X-CSRF-Token: def456"
                @input="autoSaveAuthHeaders"
                :pt="{
                  root: { 
                    class: `w-full bg-surface-800 border-surface-700 text-surface-0 rounded-lg ${isEnabled ? 'opacity-75' : ''}` 
                  },
                  input: {
                    class: 'w-full bg-surface-800 text-surface-0 placeholder:text-surface-400 resize-none overflow-auto rounded-lg'
                  }
                }"
              />
            </div>
          </div>
          
          <!-- Match & Replace Section -->
          <div class="mb-6 w-full">
            <div class="flex items-center gap-2 mb-3">
              <h3 class="text-lg font-semibold text-surface-0">Match & Replace</h3>
              <div class="relative group">
                <i class="fas fa-info-circle text-surface-400 text-sm cursor-help"></i>
                <div class="absolute top-full left-0 mt-2 px-3 py-2 bg-surface-900 text-surface-0 text-sm rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                  Configure automatic string replacements in the request body of replayed requests. This uses string based matching to replace content before sending modified requests.
                  <div class="absolute bottom-full left-4 w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-surface-900"></div>
                </div>
              </div>
            </div>
            
            <!-- Add Rule Button -->
            <div class="mb-4">
              <Button
                @click="addMatchReplaceRule"
                label="Add Rule"
                icon="fas fa-plus"
                size="small"
                :pt="{
                  root: { class: 'bg-blue-600 hover:bg-blue-700 border-blue-600 hover:border-blue-700 h-8 px-4 text-sm rounded-lg' },
                  label: { class: 'text-sm' }
                }"
              />
            </div>
            
            <!-- Rules List -->
            <div v-if="matchReplaceRules.length > 0" class="space-y-3">
              <div 
                v-for="rule in matchReplaceRules" 
                :key="rule.id"
                class="bg-surface-800 border border-surface-700 rounded-lg p-4"
              >
                <div class="flex items-start gap-3">
                  <!-- Enable/Disable Toggle -->
                  <div class="flex-shrink-0 mt-1">
                    <input
                      type="checkbox"
                      :id="`rule-enabled-${rule.id}`"
                      :checked="rule.enabled"
                      @change="toggleMatchReplaceRule(rule.id)"
                      class="w-4 h-4 text-blue-600 bg-surface-700 border-surface-600 rounded focus:ring-blue-500 focus:ring-2"
                    />
                  </div>
                  
                  <!-- Rule Content -->
                  <div class="flex-1">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <!-- Match Pattern -->
                      <div>
                        <label :for="`rule-match-${rule.id}`" class="block text-sm font-medium text-surface-0 mb-1">
                          Match String:
                        </label>
                        <input
                          :id="`rule-match-${rule.id}`"
                          type="text"
                          :value="rule.match"
                          @input="updateMatchReplaceRule(rule.id, 'match', ($event.target as HTMLInputElement).value)"
                          placeholder="Enter text to match..."
                          class="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded-lg text-surface-0 placeholder:text-surface-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      
                      <!-- Replace With -->
                      <div>
                        <label :for="`rule-replace-${rule.id}`" class="block text-sm font-medium text-surface-0 mb-1">
                          Replace With:
                        </label>
                        <input
                          :id="`rule-replace-${rule.id}`"
                          type="text"
                          :value="rule.replace"
                          @input="updateMatchReplaceRule(rule.id, 'replace', ($event.target as HTMLInputElement).value)"
                          placeholder="Enter replacement text..."
                          class="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded-lg text-surface-0 placeholder:text-surface-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                    </div>
                  </div>
                  
                  <!-- Remove Button -->
                  <div class="flex-shrink-0">
                    <Button
                      @click="removeMatchReplaceRule(rule.id)"
                      icon="fas fa-trash"
                      severity="danger"
                      size="small"
                      :pt="{
                        root: { class: 'bg-red-600 hover:bg-red-700 border-red-600 hover:border-red-700 h-8 w-8 p-0 rounded-lg' }
                      }"
                    />
                  </div>
                </div>
              </div>
            </div>
            
            <!-- Empty State -->
            <div v-else class="text-center py-8 text-surface-400">
              <i class="fas fa-search text-2xl mb-2 block"></i>
              <p>No match & replace rules configured</p>
              <p class="text-sm">Click "Add Rule" to create your first rule</p>
            </div>
          </div>
          
          <!-- Filter Settings Section -->
          <div class="flex-1 min-h-0 flex flex-col">
            <div class="flex items-center gap-2 mb-3">
              <h3 class="text-lg font-semibold text-surface-0">Request Filters</h3>
              <div class="relative group">
                <i class="fas fa-info-circle text-surface-400 text-sm cursor-help"></i>
                <div class="absolute top-full left-0 mt-2 px-3 py-2 bg-surface-900 text-surface-0 text-sm rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                  Choose which file types and HTTP methods to ignore when monitoring requests.
                  <div class="absolute bottom-full left-4 w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-surface-900"></div>
                </div>
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <!-- Styling Files -->
              <div class="bg-surface-800 border border-surface-700 rounded-lg p-4">
                <div class="flex items-start">
                  <div class="flex-shrink-0 mr-3">
                    <input
                      type="checkbox"
                      id="filter-styling"
                      v-model="ignoreStyling"
                      class="w-4 h-4 text-blue-600 bg-surface-700 border-surface-600 rounded focus:ring-blue-500 focus:ring-2"
                    />
                  </div>
                  <div class="flex-1">
                    <label for="filter-styling" class="text-sm font-medium text-surface-0 cursor-pointer block mb-1">Styling Files</label>
                    <p class="text-xs text-surface-400">CSS, SCSS, fonts (.css, .scss, .woff, .ttf, etc.)</p>
                  </div>
                </div>
              </div>
              
              <!-- JavaScript Files -->
              <div class="bg-surface-800 border border-surface-700 rounded-lg p-4">
                <div class="flex items-start">
                  <div class="flex-shrink-0 mr-3">
                    <input
                      type="checkbox"
                      id="filter-javascript"
                      v-model="ignoreJavaScript"
                      class="w-4 h-4 text-blue-600 bg-surface-700 border-surface-600 rounded focus:ring-blue-500 focus:ring-2"
                    />
                  </div>
                  <div class="flex-1">
                    <label for="filter-javascript" class="text-sm font-medium text-surface-0 cursor-pointer block mb-1">JavaScript Files</label>
                    <p class="text-xs text-surface-400">JS, TS, source maps (.js, .ts, .js.map, etc.)</p>
                  </div>
                </div>
              </div>
              
              <!-- Image Files -->
              <div class="bg-surface-800 border border-surface-700 rounded-lg p-4">
                <div class="flex items-start">
                  <div class="flex-shrink-0 mr-3">
                    <input
                      type="checkbox"
                      id="filter-images"
                      v-model="ignoreImages"
                      class="w-4 h-4 text-blue-600 bg-surface-700 border-surface-600 rounded focus:ring-blue-500 focus:ring-2"
                    />
                  </div>
                  <div class="flex-1">
                    <label for="filter-images" class="text-sm font-medium text-surface-0 cursor-pointer block mb-1">Image Files</label>
                    <p class="text-xs text-surface-400">Images, icons (.png, .jpg, .svg, .ico, etc.)</p>
                  </div>
                </div>
              </div>
              
              <!-- OPTIONS Requests -->
              <div class="bg-surface-800 border border-surface-700 rounded-lg p-4">
                <div class="flex items-start">
                  <div class="flex-shrink-0 mr-3">
                    <input
                      type="checkbox"
                      id="filter-options"
                      v-model="ignoreOptions"
                      class="w-4 h-4 text-blue-600 bg-surface-700 border-surface-600 rounded focus:ring-blue-500 focus:ring-2"
                    />
                  </div>
                  <div class="flex-1">
                    <label for="filter-options" class="text-sm font-medium text-surface-0 cursor-pointer block mb-1">OPTIONS Requests</label>
                    <p class="text-xs text-surface-400">CORS preflight requests (OPTIONS method)</p>
                  </div>
                </div>
              </div>
            </div>
            
          </div>
          
          <!-- HTTPQL Filtering Section -->
          <div class="flex-1 min-h-0 flex flex-col mt-8">
            <div class="flex items-center gap-2 mb-3">
              <h3 class="text-lg font-semibold text-surface-0">HTTPQL Filtering</h3>
              <div class="relative group">
                <i class="fas fa-info-circle text-surface-400 text-sm cursor-help"></i>
                <div class="absolute top-full left-0 mt-2 px-3 py-2 bg-surface-900 text-surface-0 text-sm rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                  For advanced filtering, create a filter using the button below configure it from the "Custom Authify filter" in the Overview > Filters sidebar.
                  <div class="absolute bottom-full left-4 w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-surface-900"></div>
                </div>
              </div>
            </div>
            
            <!-- HTTPQL Filter Buttons -->
            <div class="flex justify-start gap-3">
              <Button
                @click="createAuthifyFilter"
                label="Create HTTPQL Authify Filter"
                icon="fas fa-sliders-h"
                :pt="{
                  root: { class: 'bg-blue-600 hover:bg-blue-700 border-blue-600 hover:border-blue-700 h-10 px-6 text-sm rounded-lg' },
                  label: { class: 'text-sm' }
                }"
              />
              
              <ToggleButton
                v-model="isCustomFilterEnabled"
                :pt="{
                  root: { 
                    class: `h-10 px-4 text-sm rounded-lg border transition-colors ${
                      isCustomFilterEnabled 
                        ? 'bg-green-600 hover:bg-green-700 border-green-600 hover:border-green-700' 
                        : 'bg-red-600 hover:bg-red-700 border-red-600 hover:border-red-700'
                    }`
                  },
                  label: { class: 'text-sm text-white' }
                }"
                :onLabel="'Filter Enabled'"
                :offLabel="'Filter Disabled'"
                :onIcon="'fas fa-check'"
                :offIcon="'fas fa-times'"
              />
            </div>
          </div>
        </div>
      </TabPanel>

      <TabPanel header="Traffic">
        <div class="h-full flex flex-col" :style="{ height: trafficHeight + 'px' }">
          <Splitter class="flex-1 min-h-0 h-full">
            <!-- Left: full-height table -->
            <SplitterPanel class="flex flex-col min-h-0 h-full basis-1/2">
              <div class="flex-1 min-h-0 h-full flex flex-col">
                <ContextMenu ref="contextMenu" :model="contextMenuItems" :pt="{
                  root: { class: 'bg-surface-800 border border-surface-700 rounded-lg' },
                  item: { class: 'text-surface-0 hover:bg-surface-700' },
                  itemIcon: { class: 'text-surface-300 mr-2' },
                  itemLabel: { class: 'text-surface-0' }
                }" />
                <div ref="tableWrapper" @contextmenu="handleTableContextMenu" class="h-full">
                  <DataTable
                    v-model:selection="selected"
                    :value="rows"
                    dataKey="id"
                    selectionMode="single"
                    :metaKeySelection="false"
                    :keyboardSelection="true"
                    stripedRows
                    scrollable
                    scrollHeight="flex"
                    resizableColumns
                    columnResizeMode="fit"
                    tableStyle="table-layout: fixed; border-collapse: separate; border-spacing: 0;"
                    @keydown="handleTableKeydown"
                    :pt="{ 
                      root: { class: 'h-full flex flex-col' }, 
                      wrapper: { class: 'h-full' }, 
                      table: { class: 'text-sm' },
                      headerCell: { class: 'border-r border-surface-600' },
                      bodyCell: { class: 'border-r border-surface-600' }
                    }"
                  >
                    <Column
                    field="id"
                    header="ID"
                    style="width: 40px"
                    :pt="{
                      headerCell: { style: 'min-width: 0; width: 40px; max-width: 40px; padding: 0 6px' },
                      headerCellContent: { style: 'min-width: 0; width: 100%; max-width: 40px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' },
                      bodyCell: { style: 'min-width: 0; width: 40px; max-width: 40px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 6px' },
                      bodyCellContent: { style: 'min-width: 0; width: 100%; max-width: 40px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' }
                    }"
                  />
                  <Column
                    field="method"
                    header="Method"
                    style="width: 40px"
                    :pt="{
                      headerCell: { style: 'min-width: 0; width: 40px; max-width: 40px; padding: 0 6px' },
                      headerCellContent: { style: 'min-width: 0; width: 100%; max-width: 40px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' },
                      bodyCell: { style: 'min-width: 0; width: 40px; max-width: 40px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 6px' },
                      bodyCellContent: { style: 'min-width: 0; width: 100%; max-width: 40px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' }
                    }"
                  />
                  <Column
                    field="hostname"
                    header="Hostname"
                    style="width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                    :pt="{
                      headerCell: { style: 'min-width: 0; width: 100px; max-width: 100px; padding: 0 6px' },
                      headerCellContent: { style: 'min-width: 0; width: 100%; max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' },
                      bodyCell: { style: 'min-width: 0; width: 100px; max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 6px' },
                      bodyCellContent: { style: 'min-width: 0; width: 100%; max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' }
                    }"
                  />
                  <Column
                    field="path"
                    header="Path"
                    style="width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                    :pt="{
                      headerCell: { style: 'min-width: 0; width: 150px; max-width: 150px; padding: 0 6px' },
                      headerCellContent: { style: 'min-width: 0; width: 100%; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' },
                      bodyCell: { style: 'min-width: 0; width: 150px; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 6px' },
                      bodyCellContent: { style: 'min-width: 0; width: 100%; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' }
                    }"
                  />
                  <Column
                    field="code"
                    header="Status"
                    style="width: 40px"
                    :pt="{
                      headerCell: { style: 'min-width: 0; width: 40px; max-width: 40px; padding: 0 6px' },
                      headerCellContent: { style: 'min-width: 0; width: 100%; max-width: 40px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' },
                      bodyCell: { style: 'min-width: 0; width: 40px; max-width: 40px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 6px' },
                      bodyCellContent: { style: 'min-width: 0; width: 100%; max-width: 40px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' }
                    }"
                  />
                  <Column
                    field="modifiedCode"
                    header="M. Status"
                    style="width: 40px"
                    :pt="{
                      headerCell: { style: 'min-width: 0; width: 40px; max-width: 40px; padding: 0 6px' },
                      headerCellContent: { style: 'min-width: 0; width: 100%; max-width: 40px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' },
                      bodyCell: { style: 'min-width: 0; width: 40px; max-width: 40px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 6px' },
                      bodyCellContent: { style: 'min-width: 0; width: 100%; max-width: 40px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' }
                    }"
                  />
                  <Column
                    field="length"
                    header="Length"
                    style="width: 50px"
                    :pt="{
                      headerCell: { style: 'min-width: 0; width: 50px; max-width: 50px; padding: 0 6px' },
                      headerCellContent: { style: 'min-width: 0; width: 100%; max-width: 50px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' },
                      bodyCell: { style: 'min-width: 0; width: 50px; max-width: 50px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 6px' },
                      bodyCellContent: { style: 'min-width: 0; width: 100%; max-width: 50px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' }
                    }"
                  />
                  <Column
                    field="modifiedLength"
                    header="M. Length"
                    style="width: 50px"
                    :pt="{
                      headerCell: { style: 'min-width: 0; width: 50px; max-width: 50px; padding: 0 6px' },
                      headerCellContent: { style: 'min-width: 0; width: 100%; max-width: 50px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' },
                      bodyCell: { style: 'min-width: 0; width: 50px; max-width: 50px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 6px' },
                      bodyCellContent: { style: 'min-width: 0; width: 100%; max-width: 50px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' }
                    }"
                  />
                  <Column
                    field="comparison"
                    header="Compare"
                    style="width: 50px"
                    :pt="{
                      headerCell: { style: 'min-width: 0; width: 50px; max-width: 50px; padding: 0 6px' },
                      headerCellContent: { style: 'min-width: 0; width: 100%; max-width: 50px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' },
                      bodyCell: { style: 'min-width: 0; width: 50px; max-width: 50px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 6px' },
                      bodyCellContent: { style: 'min-width: 0; width: 100%; max-width: 50px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' }
                    }"
                  >
                    <template #body="slotProps">
                      <span 
                        :class="{
                          'text-red-400': slotProps.data.comparison === 'same',
                          'text-green-400': slotProps.data.comparison === 'different',
                          'text-yellow-400': slotProps.data.comparison === 'similar',
                          'text-gray-400': slotProps.data.comparison === 'unknown'
                        }"
                        class="font-medium"
                      >
                        {{ slotProps.data.comparison.toUpperCase() }}
                      </span>
                    </template>
                  </Column>
                  </DataTable>
                </div>
              </div>
            </SplitterPanel>

            <!-- Right: request (top) and response (bottom) viewers -->
            <SplitterPanel class="flex flex-col min-h-0 h-full basis-1/2">
              <Splitter layout="vertical" class="flex-1 min-h-0 h-full">
                <SplitterPanel size="50" class="flex flex-col min-h-0 h-full">
                  <div class="h-full w-full p-2 flex flex-col">
                    <label class="text-sm text-surface-300 mb-2 block">
                      Request
                      <span v-if="showModified" class="text-xs text-blue-400 ml-2">(Modified)</span>
                      <span v-else class="text-xs text-surface-400 ml-2">(Original)</span>
                    </label>
                    <div class="h-full flex-1 min-h-0">
                      <div ref="reqEditorElement" class="h-full w-full"></div>
                    </div>
                  </div>
                </SplitterPanel>
                <SplitterPanel size="50" class="flex flex-col min-h-0 h-full">
                  <div class="h-full w-full p-2 flex flex-col">
                    <label class="text-sm text-surface-300 mb-2 block">
                      Response
                      <span v-if="showModified" class="text-xs text-blue-400 ml-2">(Modified)</span>
                      <span v-else class="text-xs text-surface-400 ml-2">(Original)</span>
                    </label>
                    <div class="h-full flex-1 min-h-0">
                      <div ref="respEditorElement" class="h-full w-full"></div>
                    </div>
                  </div>
                </SplitterPanel>
              </Splitter>
            </SplitterPanel>
          </Splitter>
          
          <!-- Button bar below the splitter -->
          <div class="flex items-center justify-between p-3 border-t border-surface-700 bg-surface-800">
            <div class="flex items-center justify-center flex-1">
              <Button
                @click="clearTable"
                label="Clear Table"
                icon="fas fa-trash"
                severity="danger"
                size="small"
                :pt="{
                  root: { class: 'bg-red-600 hover:bg-red-700 border-red-600 hover:border-red-700 h-8 px-6 text-sm rounded-lg w-50' },
                  label: { class: 'text-sm' }
                }"
              />
            </div>
            <div class="flex items-center justify-center flex-1">
              <Button
                @click="sendToReplay"
                label="Send to Replay (CTRL+R)"
                icon="fas fa-paper-plane"
                severity="secondary"
                size="small"
                :disabled="!selected"
                :pt="{
                  root: { class: 'bg-blue-600 hover:bg-blue-700 border-blue-600 hover:border-blue-700 h-8 px-6 text-sm rounded-lg w-50' },
                  label: { class: 'text-sm' }
                }"
              />
            </div>
          </div>
        </div>
      </TabPanel>

      <TabPanel header="How to Use">
        <div class="flex-1 min-h-0 flex flex-col p-4">
          <div class="mb-6">
            <h3 class="text-lg font-semibold mb-4">Getting Started with Authify</h3>
            
            <!-- Quick Setup Guide -->
            <div class="mb-6">
              <h4 class="text-md font-medium mb-3">Quick Setup Guide</h4>
              <div class="space-y-3">
                <div class="flex items-center gap-3">
                  <span class="bg-blue-600 text-blue-100 px-2 py-1 rounded text-sm font-medium">1</span>
                  <span class="text-surface-100">Configure your authentication headers in the Configuration tab</span>
                </div>
                <div class="flex items-center gap-3">
                  <span class="bg-blue-600 text-blue-100 px-2 py-1 rounded text-sm font-medium">2</span>
                  <span class="text-surface-100">Set your workspace scope to filter relevant requests</span>
                </div>
                <div class="flex items-center gap-3">
                  <span class="bg-blue-600 text-blue-100 px-2 py-1 rounded text-sm font-medium">3</span>
                  <span class="text-surface-100">Enable the plugin to start processing traffic</span>
                </div>
                <div class="flex items-center gap-3">
                  <span class="bg-blue-600 text-blue-100 px-2 py-1 rounded text-sm font-medium">4</span>
                  <span class="text-surface-100">View and analyze traffic in the Traffic tab</span>
                </div>
              </div>
            </div>

            <!-- Configuration -->
            <div class="mb-6">
              <h4 class="text-md font-medium mb-3">Configuration</h4>
              <Dropdown 
                v-model="selectedConfig" 
                :options="configOptions" 
                optionLabel="label" 
                optionValue="value"
                placeholder="Select a configuration topic"
                class="w-full max-w-md"
                :pt="{
                  input: { class: 'rounded-lg' },
                  panel: { class: 'rounded-lg' }
                }"
                @change="onConfigSelect"
              />
              <div v-if="selectedConfigContent" class="mt-3 p-3 bg-surface-700 rounded border border-surface-600">
                <div class="text-md text-surface-100">{{ selectedConfigContent }}</div>
              </div>
            </div>

            <!-- Traffic -->
            <div class="mb-6">
              <h4 class="text-md font-medium mb-3">Traffic</h4>
              <Dropdown 
                v-model="selectedTraffic" 
                :options="trafficOptions" 
                optionLabel="label" 
                optionValue="value"
                placeholder="Select a traffic topic"
                class="w-full max-w-md"
                :pt="{
                  input: { class: 'rounded-lg' },
                  panel: { class: 'rounded-lg' }
                }"
                @change="onTrafficSelect"
              />
              <div v-if="selectedTrafficContent" class="mt-3 p-3 bg-surface-700 rounded border border-surface-600">
                <div class="text-md text-surface-100">{{ selectedTrafficContent }}</div>
              </div>
            </div>

            <!-- Tips and Tricks -->
            <div class="mb-6">
              <h4 class="text-md font-medium mb-3">Tips & Tricks</h4>
              <Dropdown 
                v-model="selectedTip" 
                :options="tipsAndTricks" 
                optionLabel="label" 
                optionValue="value"
                placeholder="Select a tip to learn more"
                class="w-full max-w-md"
                :pt="{
                  input: { class: 'rounded-lg' },
                  panel: { class: 'rounded-lg' }
                }"
                @change="onTipSelect"
              />
              <div v-if="selectedTipContent" class="mt-3 p-3 bg-surface-700 rounded border border-surface-600">
                <div class="text-md text-surface-100">{{ selectedTipContent }}</div>
              </div>
            </div>
          </div>
        </div>
      </TabPanel>
    </TabView>

  </div>
</template>

