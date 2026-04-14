import { type Caido } from "@caido/sdk-frontend";
import { type API, type BackendEvents } from "backend";

export type FrontendSDK = Caido<API, BackendEvents>;

export type Row = {
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
