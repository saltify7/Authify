export const configOptions = [
  { label: "Authentication Headers", value: "auth-headers" },
  { label: "Scope Selection", value: "scope-selection" },
  { label: "Match & Replace", value: "match-replace" },
  { label: "Request Filters", value: "request-filters" },
  { label: "HTTPQL Filtering", value: "httpql-filtering" },
];

export const trafficOptions = [
  { label: "Table Layout", value: "table-layout" },
  { label: "Traffic Comparison", value: "traffic-comparison" },
  { label: "Sending to Replay", value: "sending-to-replay" },
];

export const tipsAndTricks = [
  { label: "Process with Authify", value: "send-to-authify" },
  { label: "Send Headers to Authify", value: "send-headers" },
  { label: "Apply Headers to Replay", value: "apply-headers-replay" },
];

const configContent: Record<string, string> = {
  "auth-headers":
    "Configure your authentication headers in the textarea. Paste headers one per line in the format 'Header-Name: value'. These headers will be automatically added to requests when the plugin is enabled. Headers are auto-saved as you type and persist between sessions.",
  "scope-selection":
    "Set a workspace scope to focus on specific domains or applications. You can select any scope from the workspace. Use 'Unset Scope' to process all HTTP traffic (though this might slow down the plugin).",
  "match-replace":
    "Configure automatic string replacements in raw replayed requests and enable/disable them individually. Useful for replacing CSRF tokens or other values in the request body. Each rule supports two modes — String (literal match) or Regex. In Regex mode, use capture groups in your pattern (e.g. (csrf_token=)[^&]+) and reference them in the replacement (e.g. $1NEW_VALUE).",
  "request-filters":
    "Enable filters to reduce noise in your traffic view. Ignore styling files (CSS, SCSS), JavaScript files, images, and OPTIONS requests.",
  "httpql-filtering":
    "Create custom filters using HTTPQL for advanced request filtering. After creating a filter, it will appear in Caido's Overview > Filters sidebar. Use the toggle to enable/disable the filter.",
};

const trafficContent: Record<string, string> = {
  "table-layout":
    "The traffic table shows captured requests with columns for method, URL, status, content length, and comparison results. Select a request to view its details in the right panel. Use the 'Show Modified' toggle to switch between original and modified request/response views.",
  "traffic-comparison":
    "Authify automatically compares responses and indicates if they are the same, different, similar, or unknown. The comparison considers status codes, content length, and response content.",
  "sending-to-replay":
    "Select any request in the traffic table and click 'Send to Replay' to send it to Caido's Replay feature. Choose between sending the original request or the modified version (with your auth headers applied) using the 'Show Modified' toggle.",
};

const tipsContent: Record<string, string> = {
  "send-to-authify":
    "Right-click on any request anywhere in Caido and select 'Process with Authify' to quickly add it to the Authify traffic table. This lets you manually test or replay specific requests with your configured authentication headers.",
  "send-headers":
    "Right-click on any request anywhere in Caido to 'Send headers to Authify'. This automatically extracts authentication headers from the selected request and updates your configuration. Perfect for refreshing tokens after expiry or logout!",
  "apply-headers-replay":
    "Right-click on any request in Caido's Replay tab or HTTP History and select 'Apply headers to Replay' to automatically inject your configured authentication headers into a new Replay session.",
};

export const getConfigContent = (key: string): string | undefined => configContent[key];
export const getTrafficContent = (key: string): string | undefined => trafficContent[key];
export const getTipsContent = (key: string): string | undefined => tipsContent[key];
