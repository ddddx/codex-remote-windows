import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";
import type { AppSummary } from "./AppSummary.js";
import type { PluginHookSummary } from "./PluginHookSummary.js";
import type { PluginSummary } from "./PluginSummary.js";
import type { SkillSummary } from "./SkillSummary.js";
export type PluginDetail = {
    marketplaceName: string;
    marketplacePath: AbsolutePathBuf | null;
    summary: PluginSummary;
    description: string | null;
    skills: Array<SkillSummary>;
    hooks: Array<PluginHookSummary>;
    apps: Array<AppSummary>;
    mcpServers: Array<string>;
};
