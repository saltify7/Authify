import { ref, watch } from "vue";
import { useSDK } from "@/plugins/sdk";
import type { HTTPQLManager } from "@/configs/httpql";
import type { Row } from "@/types";

export function useHttpqlFilter(httpqlManager: HTTPQLManager) {
  const sdk = useSDK();

  let httpqlPollingInterval: ReturnType<typeof setInterval> | undefined = undefined;
  let filterStatusPollingInterval: ReturnType<typeof setInterval> | undefined = undefined;

  const isCustomFilterActive = ref(false);
  const isCustomFilterEnabled = ref(false);

  const createAuthifyFilter = async () => {
    try {
      const filter = await httpqlManager.createAuthifyFilter();
      if (filter) {
        sdk.window.showToast("Authify filter created successfully! Configure it in Overview > Filters.", { variant: "success" });
      } else {
        sdk.window.showToast("Failed to create Authify filter", { variant: "error" });
      }
    } catch (error) {
      sdk.window.showToast(`Error creating Authify filter: ${error}`, { variant: "error" });
    }
  };

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

  const forceSetFilterToNull = async () => {
    try {
      await sdk.backend.storeHttpqlFilter(null);
      isCustomFilterActive.value = false;
    } catch (error) {
      console.error("Error force-setting filter to null:", error);
    }
  };

  const toggleCustomFilter = async () => {
    if (!isCustomFilterEnabled.value) {
      try {
        await sdk.backend.storeHttpqlFilter(null);
        isCustomFilterActive.value = false;
      } catch (error) {
        console.error("Error disabling custom filter:", error);
      }
    } else {
      await httpqlManager.syncFilterWithBackend();
      await checkFilterStatus();
    }
  };

  const startHttpqlPolling = () => {
    if (httpqlPollingInterval !== undefined) return;
    httpqlPollingInterval = setInterval(async () => {
      if (isCustomFilterEnabled.value) {
        await httpqlManager.syncFilterWithBackend();
      } else {
        await sdk.backend.storeHttpqlFilter(null);
      }
    }, 3000);
  };

  const stopHttpqlPolling = () => {
    if (httpqlPollingInterval !== undefined) {
      clearInterval(httpqlPollingInterval);
      httpqlPollingInterval = undefined;
    }
  };

  const startFilterStatusPolling = () => {
    if (filterStatusPollingInterval !== undefined) return;
    void checkFilterStatus();
    filterStatusPollingInterval = setInterval(async () => {
      await checkFilterStatus();
    }, 2000);
  };

  const stopFilterStatusPolling = () => {
    if (filterStatusPollingInterval !== undefined) {
      clearInterval(filterStatusPollingInterval);
      filterStatusPollingInterval = undefined;
    }
  };

  const ignorePathInHttpql = async (row: Pick<Row, "path">) => {
    const authifyFilter = await httpqlManager.getAuthifyFilter();
    if (!authifyFilter) {
      sdk.window.showToast("Please create an Authify filter first in the Configuration tab", { variant: "error" });
      return;
    }

    let pathWithoutQuery = row.path;
    const queryIndex = pathWithoutQuery.indexOf("?");
    if (queryIndex !== -1) {
      pathWithoutQuery = pathWithoutQuery.substring(0, queryIndex);
    }

    const currentQuery = authifyFilter.query?.trim() || "";
    const newQuery = currentQuery
      ? `${currentQuery} AND req.path.ncont:"${pathWithoutQuery}"`
      : `req.path.ncont:"${pathWithoutQuery}"`;

    const updatedFilter = await httpqlManager.updateFilter(authifyFilter.id, {
      name: authifyFilter.name,
      alias: authifyFilter.alias,
      query: newQuery,
    });

    if (!updatedFilter) {
      sdk.window.showToast("Failed to update HTTPQL filter", { variant: "error" });
      return;
    }

    await httpqlManager.syncFilterWithBackend();
    sdk.window.showToast(`Path "${pathWithoutQuery}" added to HTTPQL filter`, { variant: "success" });
  };

  watch(isCustomFilterEnabled, async (newValue) => {
    await toggleCustomFilter();
    if (!newValue) await forceSetFilterToNull();
  });

  return {
    isCustomFilterActive,
    isCustomFilterEnabled,
    createAuthifyFilter,
    startHttpqlPolling,
    stopHttpqlPolling,
    startFilterStatusPolling,
    stopFilterStatusPolling,
    ignorePathInHttpql,
  };
}
