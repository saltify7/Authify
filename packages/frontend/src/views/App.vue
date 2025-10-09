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

import { useSDK } from "@/plugins/sdk";
import { prettifyHttpData } from "@/utils/json-prettify";
import { StorageManager } from "@/utils/storage";

// SDK instance
const sdk = useSDK();

// Storage manager instance
const storage = new StorageManager(sdk);

// Caido request/response editors
const reqEditor = ref<any>(null);
const respEditor = ref<any>(null);
const reqEditorElement = ref<HTMLElement | null>(null);
const respEditorElement = ref<HTMLElement | null>(null);

// Pane 1 state: user-provided auth materials
const auth = ref("");

// Plugin state: on/off toggle
const isEnabled = ref(false);

// View toggle for original vs modified request/response
const showModified = ref(false);

// JSON prettification toggle
const enableJsonPrettify = ref(true);

// Dynamic height for traffic container
const trafficHeight = ref(600);

// Workspace scopes state
const workspaceScopes = ref<Array<{label: string, value: string}>>([]);
const selectedScope = ref<string | undefined>(undefined);

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
    
    // Save to storage for persistence
    await storage.saveAuthHeaders(event.detail.headers);
  }
};

// Function to refresh scopes (can be called manually or on project change)
const refreshScopes = async () => {
  console.log("Refreshing scopes");
  try {
    // Store the current selected scope before refreshing
    const currentScope = selectedScope.value;
    
    // Refresh scopes from the backend
    const result = await sdk.backend.refreshScopes();
    if (result.kind === "Error") {
      console.warn("Failed to refresh scopes:", result.error);
    }
    
    // Reload workspace scopes
    await loadWorkspaceScopes();
    
    // If the previously selected scope no longer exists, clear it from storage
    if (currentScope && currentScope !== selectedScope.value) {
      await clearStoredScope();
      console.log("Cleared stored scope because it no longer exists");
    }
    
    // Clear existing traffic when scopes are refreshed to avoid confusion
    rows.value = [];
    selected.value = undefined;
    
  } catch (error) {
    console.warn("Error refreshing scopes:", error);
    sdk.window.showToast("Failed to refresh scopes", { variant: "error" });
  }
};

// Load all settings from storage at once
const loadAllSettings = async () => {
  const settings = await storage.loadAllSettings();
  
  // Load auth headers
  if (settings.authHeaders) {
    auth.value = settings.authHeaders;
  }
  
  // Note: selected scope is loaded separately in loadWorkspaceScopes()
  // because it depends on the available scopes being loaded first
};

// Save selected scope to storage
const saveSelectedScope = async () => {
  await storage.saveSelectedScope(selectedScope.value || '');
};

// Clear stored scope from storage
const clearStoredScope = async () => {
  await storage.clearSelectedScope();
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
  void loadWorkspaceScopes();
  
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
  
  // Clean up ResizeObserver
  if (resizeObserver !== undefined) {
    resizeObserver.disconnect();
  }
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
  const result = await sdk.backend.setSelectedScope(newScope || '');
  if (result.kind === "Error") {
    sdk.window.showToast(`Failed to set scope: ${result.error}`, { variant: "error" });
  } else {
    // Clear existing traffic when scope changes to avoid confusion
    rows.value = [];
    selected.value = undefined;
    
    // Save the new scope to storage
    saveSelectedScope();
  }
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
  // Save to backend
  const result = await sdk.backend.saveAuthHeaders(auth.value);
  if (result.kind === "Error") {
    sdk.window.showToast(`Failed to save auth headers: ${result.error}`, { variant: "error" });
    return;
  }
  
  // Save to storage for persistence
  await storage.saveAuthHeaders(auth.value);
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

// How to Use tab data and handlers
const configOptions = [
  { label: "Authentication Headers", value: "auth-headers" },
  { label: "Scope Selection", value: "scope-selection" },
  { label: "Request Filters", value: "request-filters" }
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
    "request-filters": "Enable filters to reduce noise in your traffic view. Ignore styling files (CSS, SCSS), JavaScript files, images, and OPTIONS requests."
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

// Function to load workspace scopes
const loadWorkspaceScopes = async () => {
  try {
    // Get workspace scopes from Caido SDK
    const scopes = await sdk.scopes?.getScopes?.() || [];
    
    // Add "Unset Scope" as the first option
    workspaceScopes.value = [
      { label: 'Unset Scope', value: '' },
      ...scopes.map((scope: any) => ({
        label: scope.name || scope.id || scope,
        value: scope.id || scope
      }))
    ];
    
    // Restore previously selected scope from storage, or default to "Unset Scope"
    const storedScope = await storage.loadSelectedScope();
    if (storedScope !== null) {
      // Verify the stored scope still exists in the available scopes
      const scopeExists = workspaceScopes.value.some(scope => scope.value === storedScope);
      if (scopeExists) {
        selectedScope.value = storedScope;
        console.log("Restored previously selected scope:", storedScope);
      } else {
        // Stored scope no longer exists, default to "Unset Scope"
        selectedScope.value = '';
        console.log("Previously selected scope no longer exists, defaulting to 'Unset Scope'");
        sdk.window.showToast("Previously selected scope no longer available", { variant: "warning" });
      }
    } else {
      // No stored scope, default to "Unset Scope"
      selectedScope.value = '';
    }
  } catch (error) {
    console.warn('Could not load workspace scopes:', error);
    sdk.window.showToast('Could not load workspace scopes', { variant: "error" });
    // Fallback to "Unset Scope"
    workspaceScopes.value = [{ label: 'Unset Scope', value: '' }];
    selectedScope.value = '';
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
            <h3 class="text-lg font-semibold text-surface-0 mb-3">Auth Headers</h3>
            <p class="text-sm text-surface-300 mb-4">
              <span v-if="isEnabled" class="text-xs text-amber-400 ml-2">(Read-only while monitoring)</span>
            </p>
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
          
          <!-- Filter Settings Section -->
          <div class="flex-1 min-h-0 flex flex-col">
            <h3 class="text-lg font-semibold text-surface-0 mb-3">Request Filters</h3>
            <p class="text-sm text-surface-300 mb-4">Choose which file types and HTTP methods to ignore when monitoring requests (selected = requests will be ignored):</p>
            
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
        </div>
      </TabPanel>

      <TabPanel header="Traffic">
        <div class="h-full flex flex-col" :style="{ height: trafficHeight + 'px' }">
          <Splitter class="flex-1 min-h-0 h-full">
            <!-- Left: full-height table -->
            <SplitterPanel class="flex flex-col min-h-0 h-full basis-1/2">
              <div class="flex-1 min-h-0 h-full flex flex-col">
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

