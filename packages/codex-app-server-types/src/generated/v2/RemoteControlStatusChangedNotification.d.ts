import type { RemoteControlConnectionStatus } from "./RemoteControlConnectionStatus.js";
/**
 * Current remote-control connection status and environment id exposed to clients.
 */
export type RemoteControlStatusChangedNotification = {
    status: RemoteControlConnectionStatus;
    environmentId: string | null;
};
