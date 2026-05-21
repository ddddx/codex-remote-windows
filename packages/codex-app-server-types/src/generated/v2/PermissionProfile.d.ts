import type { PermissionProfileFileSystemPermissions } from "./PermissionProfileFileSystemPermissions.js";
import type { PermissionProfileNetworkPermissions } from "./PermissionProfileNetworkPermissions.js";
export type PermissionProfile = {
    "type": "managed";
    network: PermissionProfileNetworkPermissions;
    fileSystem: PermissionProfileFileSystemPermissions;
} | {
    "type": "disabled";
} | {
    "type": "external";
    network: PermissionProfileNetworkPermissions;
};
