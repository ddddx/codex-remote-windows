export type ExperimentalFeatureListParams = {
    /**
     * Opaque pagination cursor returned by a previous call.
     */
    cursor?: string | null;
    /**
     * Optional page size; defaults to a reasonable server-side value.
     */
    limit?: number | null;
};
