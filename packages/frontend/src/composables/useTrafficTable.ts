import { ref } from "vue";
import { useSDK } from "@/plugins/sdk";
import type { Row } from "@/types";

export function useTrafficTable(options: {
  showModified: { value: boolean };
  activeTabIndex: { value: number };
  onIgnorePathInHttpql: (row: Row) => Promise<void>;
}) {
  const sdk = useSDK();

  const rows = ref<Row[]>([]);
  const selected = ref<Row | undefined>(undefined);
  const contextMenu = ref<any>(null);
  const contextMenuRow = ref<Row | undefined>(undefined);

  const clearTable = async () => {
    const result = await sdk.backend.clearTraffic();
    if (result.kind === "Error") {
      sdk.window.showToast(`Failed to clear table: ${result.error}`, { variant: "error" });
    } else {
      sdk.window.showToast("Traffic table cleared", { variant: "success" });
      rows.value = [];
      selected.value = undefined;
    }
  };

  const sendToReplay = async () => {
    if (!selected.value) {
      sdk.window.showToast("No request selected", { variant: "error" });
      return;
    }
    const result = await sdk.backend.sendToReplay(selected.value.id, options.showModified.value);
    if (result.kind === "Error") {
      sdk.window.showToast(`Failed to send to replay: ${result.error}`, { variant: "error" });
    } else {
      const requestType = options.showModified.value ? "modified" : "original";
      sdk.window.showToast(`Sent ${requestType} request to replay`, { variant: "success" });
      sdk.replay.openTab(result.value.id);
    }
  };

  const repeatRequest = async (row: Row) => {
    const result = await sdk.backend.processRequestFromHistory(row.id);
    if (result.kind === "Error") {
      sdk.window.showToast(`Failed to repeat request: ${result.error}`, { variant: "error" });
    } else {
      sdk.window.showToast("Request repeated successfully", { variant: "success" });
    }
  };

  const contextMenuItems = ref([
    {
      label: "Repeat Request",
      icon: "fas fa-redo",
      command: () => {
        if (contextMenuRow.value) repeatRequest(contextMenuRow.value);
      },
    },
    {
      label: "Ignore path in HTTPQL Filter",
      icon: "fas fa-ban",
      command: () => {
        if (contextMenuRow.value) options.onIgnorePathInHttpql(contextMenuRow.value);
      },
    },
  ]);

  const handleTableContextMenu = (event: MouseEvent) => {
    const rowElement = (event.target as HTMLElement).closest("tr");
    if (!rowElement || rowElement.closest("thead")) return;

    const tbody = rowElement.closest("tbody");
    if (!tbody) return;

    const rowIndex = Array.from(tbody.querySelectorAll("tr")).indexOf(rowElement);
    if (rowIndex >= 0 && rowIndex < rows.value.length) {
      event.preventDefault();
      contextMenuRow.value = rows.value[rowIndex];
      contextMenu.value.show(event);
    }
  };

  const handleTableKeydown = (event: KeyboardEvent) => {
    if (rows.value.length === 0) return;

    const currentIndex = selected.value
      ? rows.value.findIndex((row) => row.id === selected.value?.id)
      : -1;

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (currentIndex > 0) {
        selected.value = rows.value[currentIndex - 1];
      } else if (currentIndex === -1 && rows.value.length > 0) {
        selected.value = rows.value[rows.value.length - 1];
      }
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      if (currentIndex < rows.value.length - 1) {
        selected.value = rows.value[currentIndex + 1];
      } else if (currentIndex === -1 && rows.value.length > 0) {
        selected.value = rows.value[0];
      }
    }
  };

  const handleGlobalKeydown = (event: KeyboardEvent) => {
    if (!document.hasFocus() || document.visibilityState !== "visible") return;
    const panel = document.querySelector("#plugin--authify") as HTMLElement | null;
    if (!panel || panel.offsetParent === null) return;

    if (event.ctrlKey && event.key === "r" && options.activeTabIndex.value === 1 && selected.value) {
      event.preventDefault();
      event.stopPropagation();
      void sendToReplay();
    }
  };

  return {
    rows,
    selected,
    contextMenu,
    contextMenuItems,
    clearTable,
    sendToReplay,
    handleTableContextMenu,
    handleTableKeydown,
    handleGlobalKeydown,
  };
}
