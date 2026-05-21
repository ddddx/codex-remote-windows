import type { FileSystemSandboxEntry } from "./FileSystemSandboxEntry.js";
export type PermissionProfileFileSystemPermissions = {
    "type": "restricted";
    entries: Array<FileSystemSandboxEntry>;
    globScanMaxDepth?: number;
} | {
    "type": "unrestricted";
};
