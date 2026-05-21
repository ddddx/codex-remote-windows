import type { PluginAuthPolicy } from "./PluginAuthPolicy.js";
import type { PluginAvailability } from "./PluginAvailability.js";
import type { PluginInstallPolicy } from "./PluginInstallPolicy.js";
import type { PluginInterface } from "./PluginInterface.js";
import type { PluginShareContext } from "./PluginShareContext.js";
import type { PluginSource } from "./PluginSource.js";
export type PluginSummary = {
    id: string;
    name: string;
    /**
     * Remote sharing context associated with this plugin when available.
     */
    shareContext: PluginShareContext | null;
    source: PluginSource;
    installed: boolean;
    enabled: boolean;
    installPolicy: PluginInstallPolicy;
    authPolicy: PluginAuthPolicy;
    /**
     * Availability state for installing and using the plugin.
     */
    availability: PluginAvailability;
    interface: PluginInterface | null;
    keywords: Array<string>;
};
