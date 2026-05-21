/**
 * Client-declared capabilities negotiated during initialize.
 */
export type InitializeCapabilities = {
    /**
     * Opt into receiving experimental API methods and fields.
     */
    experimentalApi: boolean;
    /**
     * Exact notification method names that should be suppressed for this
     * connection (for example `thread/started`).
     */
    optOutNotificationMethods?: Array<string> | null;
};
