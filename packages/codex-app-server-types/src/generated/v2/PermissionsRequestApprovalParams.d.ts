import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";
import type { RequestPermissionProfile } from "./RequestPermissionProfile.js";
export type PermissionsRequestApprovalParams = {
    threadId: string;
    turnId: string;
    itemId: string;
    /**
     * Unix timestamp (in milliseconds) when this approval request started.
     */
    startedAtMs: number;
    cwd: AbsolutePathBuf;
    reason: string | null;
    permissions: RequestPermissionProfile;
};
