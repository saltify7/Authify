import { ref, nextTick } from "vue";
import { useSDK } from "@/plugins/sdk";
import { prettifyHttpData } from "@/utils/json-prettify";
import type { Row } from "@/types";

export function useEditors() {
  const sdk = useSDK();

  const reqEditor = ref<any>(null);
  const respEditor = ref<any>(null);
  const reqEditorElement = ref<HTMLElement | null>(null);
  const respEditorElement = ref<HTMLElement | null>(null);

  const initEditors = async () => {
    reqEditor.value = sdk.ui.httpRequestEditor();
    respEditor.value = sdk.ui.httpResponseEditor();

    await nextTick();

    const reqElement = reqEditor.value.getElement();
    const respElement = respEditor.value.getElement();

    if (reqEditorElement.value && reqElement) {
      reqEditorElement.value.appendChild(reqElement);
    }
    if (respEditorElement.value && respElement) {
      respEditorElement.value.appendChild(respElement);
    }
  };

  const reinitializeEditors = async () => {
    try {
      if (reqEditorElement.value) reqEditorElement.value.innerHTML = "";
      if (respEditorElement.value) respEditorElement.value.innerHTML = "";

      reqEditor.value = sdk.ui.httpRequestEditor();
      respEditor.value = sdk.ui.httpResponseEditor();

      await nextTick();

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

  const updateEditors = async (
    selected: Row | undefined,
    showModified: boolean,
    enableJsonPrettify: boolean
  ) => {
    if (!selected) return;

    try {
      await reinitializeEditors();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const rawReqData = showModified ? selected.modifiedReqRaw : selected.reqRaw;
      const rawRespData = showModified ? selected.modifiedRespRaw : selected.respRaw;

      const reqData = rawReqData && enableJsonPrettify ? prettifyHttpData(rawReqData) : rawReqData;
      const respData = rawRespData && enableJsonPrettify ? prettifyHttpData(rawRespData) : rawRespData;

      if (reqData && reqEditor.value) {
        try {
          const view = reqEditor.value.getEditorView();
          if (view?.state) {
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: reqData } });
          }
        } catch (error) {
          console.warn("Error updating request editor:", error);
        }
      }

      if (respData && respEditor.value) {
        try {
          const view = respEditor.value.getEditorView();
          if (view?.state) {
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: respData } });
          }
        } catch (error) {
          console.warn("Error updating response editor:", error);
        }
      }
    } catch (error) {
      console.warn("Error updating editors:", error);
    }
  };

  return { reqEditor, respEditor, reqEditorElement, respEditorElement, initEditors, updateEditors };
}
