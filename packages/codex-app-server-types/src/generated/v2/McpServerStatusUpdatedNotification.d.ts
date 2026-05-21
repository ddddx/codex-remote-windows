import type { McpServerStartupState } from "./McpServerStartupState.js";
export type McpServerStatusUpdatedNotification = {
    name: string;
    status: McpServerStartupState;
    error: string | null;
};
