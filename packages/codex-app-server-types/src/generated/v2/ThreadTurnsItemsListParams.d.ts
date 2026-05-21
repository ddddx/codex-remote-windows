import type { SortDirection } from "./SortDirection.js";
export type ThreadTurnsItemsListParams = {
    threadId: string;
    turnId: string;
    /**
     * Opaque cursor to pass to the next call to continue after the last item.
     */
    cursor?: string | null;
    /**
     * Optional item page size.
     */
    limit?: number | null;
    /**
     * Optional item pagination direction; defaults to ascending.
     */
    sortDirection?: SortDirection | null;
};
