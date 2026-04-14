<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from "vue";
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
import { StorageManager } from "@/utils/storage";
import { ScopesManager } from "@/configs/scopes";
import { AuthConfigManager } from "@/configs/auth-config";
import { MatchReplaceManager, type MatchReplaceRule } from "@/configs/match-replace";
import { HTTPQLManager } from "@/configs/httpql";
import { useEditors } from "@/composables/useEditors";
import { useHttpqlFilter } from "@/composables/useHttpqlFilter";
import { useFilterSettings } from "@/composables/useFilterSettings";
import { useTrafficTable } from "@/composables/useTrafficTable";
import { configOptions, trafficOptions, tipsAndTricks, getConfigContent, getTrafficContent, getTipsContent } from "@/data/how-to-use";
import type { Row } from "@/types";

// Managers
const sdk = useSDK();
const storage = new StorageManager(sdk);
const scopesManager = new ScopesManager(sdk, storage);
const authConfigManager = new AuthConfigManager(sdk, storage);
const matchReplaceManager = new MatchReplaceManager(sdk, storage);
const httpqlManager = new HTTPQLManager(sdk);

// Plugin toggles
const isEnabled = ref(false);
const isDropOriginalEnabled = ref(false);
const showModified = ref(false);
const enableJsonPrettify = ref(true);
const activeTabIndex = ref(0);

// Traffic container height
const trafficHeight = ref(600);
let resizeObserver: ResizeObserver | undefined = undefined;
const updateTrafficHeight = () => {
  trafficHeight.value = Math.max(window.innerHeight - 175, 400);
};

// Auth & scopes
const auth = authConfigManager.authHeaders;
const workspaceScopes = scopesManager.workspaceScopes;
const selectedScope = scopesManager.selectedScope;

// Match & Replace
const matchReplaceRules = ref<MatchReplaceRule[]>([]);

// Composables
const { reqEditorElement, respEditorElement, initEditors, updateEditors } = useEditors();

const {
  isCustomFilterActive,
  isCustomFilterEnabled,
  createAuthifyFilter,
  startHttpqlPolling,
  stopHttpqlPolling,
  startFilterStatusPolling,
  stopFilterStatusPolling,
  ignorePathInHttpql,
} = useHttpqlFilter(httpqlManager);

const { ignoreStyling, ignoreJavaScript, ignoreImages, ignoreOptions, loadFilterSettings } = useFilterSettings();

const {
  rows,
  selected,
  contextMenu,
  contextMenuItems,
  clearTable,
  sendToReplay,
  handleTableContextMenu,
  handleTableKeydown,
  handleGlobalKeydown,
} = useTrafficTable({ showModified, activeTabIndex, onIgnorePathInHttpql: ignorePathInHttpql });

// How to Use tab
const selectedConfig = ref<string | undefined>(undefined);
const selectedConfigContent = ref<string | undefined>(undefined);
const selectedTraffic = ref<string | undefined>(undefined);
const selectedTrafficContent = ref<string | undefined>(undefined);
const selectedTip = ref<string | undefined>(undefined);
const selectedTipContent = ref<string | undefined>(undefined);

const onConfigSelect = () => { selectedConfigContent.value = getConfigContent(selectedConfig.value ?? ""); };
const onTrafficSelect = () => { selectedTrafficContent.value = getTrafficContent(selectedTraffic.value ?? ""); };
const onTipSelect = () => { selectedTipContent.value = getTipsContent(selectedTip.value ?? ""); };

// Auth save
const saveAuthHeaders = async () => {
  await authConfigManager.handleAuthHeadersChange(auth.value);
};

let authSaveTimeout: ReturnType<typeof setTimeout> | undefined = undefined;
const autoSaveAuthHeaders = () => {
  if (authSaveTimeout !== undefined) clearTimeout(authSaveTimeout);
  authSaveTimeout = setTimeout(() => saveAuthHeaders(), 500);
};

// Match & Replace wrappers
const addMatchReplaceRule = () => matchReplaceManager.addMatchReplaceRule(matchReplaceRules);
const removeMatchReplaceRule = (id: string) => matchReplaceManager.removeMatchReplaceRule(matchReplaceRules, id);
const toggleMatchReplaceRule = (id: string) => matchReplaceManager.toggleMatchReplaceRule(matchReplaceRules, id);
const updateMatchReplaceRule = (id: string, field: "match" | "replace" | "type", value: string) =>
  matchReplaceManager.updateMatchReplaceRule(matchReplaceRules, id, field, value);

// Scope auto-refresh
let scopeRefreshTimeout: ReturnType<typeof setTimeout> | undefined = undefined;
const autoRefreshScopes = () => {
  if (scopeRefreshTimeout !== undefined) clearTimeout(scopeRefreshTimeout);
  scopeRefreshTimeout = setTimeout(async () => {
    await scopesManager.refreshScopes();
    await scopesManager.handleScopeChange(selectedScope.value, rows, selected);
    autoRefreshScopes();
  }, 5000);
};

const refreshScopes = async () => {
  const result = await scopesManager.refreshScopes();
  if (result?.shouldClearTraffic) {
    rows.value = [];
    selected.value = undefined;
  }
};

const handleAuthHeadersUpdate = async (event: CustomEvent) => {
  if (event.detail?.headers) {
    auth.value = event.detail.headers;
    await authConfigManager.handleAuthHeadersChange(event.detail.headers);
  }
};

const syncMatchReplaceRules = async (rules: MatchReplaceRule[]) => {
  if (rules.length === 0) return;
  try {
    const result = await sdk.backend.saveMatchReplaceRules(rules);
    if (result.kind === "Error") {
      sdk.window.showToast(`Failed to sync match & replace rules to backend: ${result.error}`, { variant: "error" });
    }
  } catch (error) {
    console.warn("Error syncing match & replace rules to backend:", error);
    sdk.window.showToast("Failed to sync match & replace rules to backend", { variant: "error" });
  }
};

const loadAllSettings = async () => {
  await authConfigManager.loadProjectAuthConfig();
  const loadedRules = await matchReplaceManager.loadProjectMatchReplaceRules();
  matchReplaceRules.value = loadedRules;
  await syncMatchReplaceRules(loadedRules);
};

onMounted(async () => {
  await initEditors();

  void scopesManager.loadWorkspaceScopes();
  autoRefreshScopes();
  startHttpqlPolling();
  startFilterStatusPolling();
  void loadFilterSettings();
  void loadAllSettings();

  const initial = await sdk.backend.getTraffic();
  if (initial.kind === "Ok") {
    rows.value = initial.value as unknown as Row[];
  }

  sdk.backend.onEvent("tableChanged", (traffic) => {
    rows.value = traffic as unknown as Row[];
  });

  sdk.backend.onEvent("projectChanged", async () => {
    const [scopesResult, authResult, matchReplaceResult] = await Promise.all([
      refreshScopes(),
      authConfigManager.refreshAuthConfig(),
      matchReplaceManager.refreshMatchReplaceRules(),
    ]);

    const loadedRules = await matchReplaceManager.loadProjectMatchReplaceRules();
    matchReplaceRules.value = loadedRules;
    await syncMatchReplaceRules(loadedRules);

    if (
      (scopesResult as any)?.shouldClearTraffic ||
      (authResult as any)?.shouldClearTraffic ||
      (matchReplaceResult as any)?.shouldClearTraffic
    ) {
      rows.value = [];
      selected.value = undefined;
    }
  });

  updateTrafficHeight();
  window.addEventListener("resize", updateTrafficHeight);
  const container = document.querySelector("#plugin--authify");
  if (container) {
    resizeObserver = new ResizeObserver(updateTrafficHeight);
    resizeObserver.observe(container);
  }
  window.addEventListener("authify-update-headers", handleAuthHeadersUpdate as unknown as EventListener);
  window.addEventListener("keydown", handleGlobalKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", updateTrafficHeight);
  window.removeEventListener("authify-update-headers", handleAuthHeadersUpdate as unknown as EventListener);
  window.removeEventListener("keydown", handleGlobalKeydown);
  if (scopeRefreshTimeout !== undefined) clearTimeout(scopeRefreshTimeout);
  stopHttpqlPolling();
  stopFilterStatusPolling();
  resizeObserver?.disconnect();
  matchReplaceManager.destroy();
});

watch(isEnabled, async (newValue) => {
  const result = await sdk.backend.setPluginEnabled(newValue);
  if (result.kind === "Error") {
    sdk.window.showToast(`Failed to ${newValue ? "enable" : "disable"} plugin: ${result.error}`, { variant: "error" });
  } else if (newValue) {
    await saveAuthHeaders();
    sdk.window.showToast("Plugin enabled - monitoring new requests", { variant: "success" });
  } else {
    sdk.window.showToast("Plugin disabled - stopped monitoring", { variant: "info" });
  }
});

watch(isDropOriginalEnabled, async (newValue) => {
  const result = await sdk.backend.setDropOriginalEnabled(newValue);
  if (result.kind === "Error") {
    sdk.window.showToast(`Failed to ${newValue ? "enable" : "disable"} Drop Original mode: ${result.error}`, { variant: "error" });
  } else {
    sdk.window.showToast(`Drop Original mode ${newValue ? "enabled" : "disabled"}`, { variant: "info" });
  }
});

watch(selectedScope, async (newScope) => {
  await scopesManager.handleScopeChange(newScope, rows, selected);
});

watch(auth, () => {
  if (!isEnabled.value) autoSaveAuthHeaders();
});

watch(selected, () => { void updateEditors(selected.value, showModified.value, enableJsonPrettify.value); });
watch(showModified, () => { void updateEditors(selected.value, showModified.value, enableJsonPrettify.value); });
watch(enableJsonPrettify, () => { void updateEditors(selected.value, showModified.value, enableJsonPrettify.value); });
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
      
      <!-- Plugin Status and Drop Original mode in the middle -->
      <div class="flex items-center gap-4">
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
        <div class="hidden">
          <span class="text-sm text-surface-300">Drop Original:</span>
          <ToggleButton
            v-model="isDropOriginalEnabled"
            :disabled="!isEnabled"
            onLabel="Drop"
            offLabel="Keep"
            onIcon="fas fa-minus-circle"
            offIcon="fas fa-retweet"
            class="w-32"
            :pt="{
              root: {
                class: `w-32 h-8 rounded-lg ${isDropOriginalEnabled && isEnabled ? 'bg-amber-600 hover:bg-amber-700' : 'bg-surface-600 hover:bg-surface-700'} border-0`
              },
              label: { class: 'text-xs font-medium text-white' }
            }"
          />
        </div>
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
            <div class="bg-surface-800 border border-surface-700 rounded-lg p-4">
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
                      class: `w-full bg-surface-700 border border-surface-600 text-surface-0 rounded-lg ${isEnabled ? 'opacity-75' : ''}` 
                    },
                    input: {
                      class: 'w-full bg-surface-700 text-surface-0 placeholder:text-surface-400 resize-none overflow-auto rounded-lg'
                    }
                  }"
                />
              </div>
            </div>
          </div>
          
          <!-- Match & Replace Section -->
          <div class="mb-6 w-full">
            <div class="flex items-center gap-2 mb-3">
              <h3 class="text-lg font-semibold text-surface-0">Match & Replace</h3>
              <div class="relative group">
                <i class="fas fa-info-circle text-surface-400 text-sm cursor-help"></i>
                <div class="absolute top-full left-0 mt-2 px-3 py-2 bg-surface-900 text-surface-0 text-sm rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                  Configure replacements applied to modified requests. Each rule can match a literal string or a regex pattern (supports capture groups in replace).
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
                    <!-- Type selector -->
                    <div class="flex items-center gap-2 mb-3">
                      <label class="text-xs font-medium text-surface-300">Mode:</label>
                      <select
                        :value="rule.type ?? 'string'"
                        @change="updateMatchReplaceRule(rule.id, 'type', ($event.target as HTMLSelectElement).value)"
                        class="px-2 py-1 text-xs bg-surface-700 border border-surface-600 rounded text-surface-0 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="string">String</option>
                        <option value="regex">Regex</option>
                      </select>
                      <span v-if="(rule.type ?? 'string') === 'regex'" class="text-xs text-surface-400">
                        supports capture groups ($1, $2…)
                      </span>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <!-- Match Pattern -->
                      <div>
                        <label :for="`rule-match-${rule.id}`" class="block text-sm font-medium text-surface-0 mb-1">
                          {{ (rule.type ?? 'string') === 'regex' ? 'Regex Pattern:' : 'Match String:' }}
                        </label>
                        <input
                          :id="`rule-match-${rule.id}`"
                          type="text"
                          :value="rule.match"
                          @input="updateMatchReplaceRule(rule.id, 'match', ($event.target as HTMLInputElement).value)"
                          :placeholder="(rule.type ?? 'string') === 'regex' ? 'e.g. (csrf_token=)[^&]+' : 'Enter text to match...'"
                          class="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded-lg text-surface-0 placeholder:text-surface-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
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
                          :placeholder="(rule.type ?? 'string') === 'regex' ? 'e.g. $1NEW_VALUE' : 'Enter replacement text...'"
                          class="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded-lg text-surface-0 placeholder:text-surface-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
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
                  For advanced filtering, create a filter using the button below and configure it from the "Custom Authify filter" in the Overview > Filters sidebar.
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
                <div @contextmenu="handleTableContextMenu" class="h-full">
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
                    :rowClass="(row: Row) => row.id === selected?.id ? '!bg-blue-700/40 !text-surface-0' : ''"
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

