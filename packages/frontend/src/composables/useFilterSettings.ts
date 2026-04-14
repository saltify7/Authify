import { ref, computed, watch } from "vue";
import { useSDK } from "@/plugins/sdk";

export function useFilterSettings() {
  const sdk = useSDK();

  const ignoreStyling = ref(true);
  const ignoreJavaScript = ref(true);
  const ignoreImages = ref(true);
  const ignoreOptions = ref(true);

  const filterSettings = computed(() => ({
    ignoreStyling: ignoreStyling.value,
    ignoreJavaScript: ignoreJavaScript.value,
    ignoreImages: ignoreImages.value,
    ignoreOptions: ignoreOptions.value,
  }));

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
      console.warn("Could not load filter settings:", error);
      sdk.window.showToast("Could not load filter settings", { variant: "error" });
    }
  };

  watch(
    filterSettings,
    async (newSettings) => {
      const result = await sdk.backend.setFilterSettings(newSettings);
      if (result.kind === "Error") {
        sdk.window.showToast(`Failed to update filters: ${result.error}`, { variant: "error" });
      } else {
        sdk.window.showToast("Filter settings updated", { variant: "success" });
      }
    },
    { deep: true }
  );

  return { ignoreStyling, ignoreJavaScript, ignoreImages, ignoreOptions, filterSettings, loadFilterSettings };
}
