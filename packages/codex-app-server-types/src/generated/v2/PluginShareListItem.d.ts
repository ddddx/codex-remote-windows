import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";
import type { PluginSummary } from "./PluginSummary.js";
export type PluginShareListItem = {
    plugin: PluginSummary;
    shareUrl: string;
    localPluginPath: AbsolutePathBuf | null;
};
