import type { PermissionProfileModificationParams } from "./PermissionProfileModificationParams.js";
export type PermissionProfileSelectionParams = {
    "type": "profile";
    id: string;
    modifications?: Array<PermissionProfileModificationParams> | null;
};
