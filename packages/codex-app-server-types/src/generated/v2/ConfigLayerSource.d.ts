import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";
export type ConfigLayerSource = {
    "type": "mdm";
    domain: string;
    key: string;
} | {
    "type": "system";
    /**
     * This is the path to the system config.toml file, though it is not
     * guaranteed to exist.
     */
    file: AbsolutePathBuf;
} | {
    "type": "user";
    /**
     * This is the path to the user's config.toml file, though it is not
     * guaranteed to exist.
     */
    file: AbsolutePathBuf;
} | {
    "type": "project";
    dotCodexFolder: AbsolutePathBuf;
} | {
    "type": "sessionFlags";
} | {
    "type": "legacyManagedConfigTomlFromFile";
    file: AbsolutePathBuf;
} | {
    "type": "legacyManagedConfigTomlFromMdm";
};
