/**
 * EXPERIMENTAL - app metadata summary for plugin responses.
 */
export type AppSummary = {
    id: string;
    name: string;
    description: string | null;
    installUrl: string | null;
    needsAuth: boolean;
};
