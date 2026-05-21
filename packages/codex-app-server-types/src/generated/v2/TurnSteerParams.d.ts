import type { UserInput } from "./UserInput.js";
export type TurnSteerParams = {
    threadId: string;
    input: Array<UserInput>;
    /**
     * Optional turn-scoped Responses API client metadata.
     */
    responsesapiClientMetadata?: {
        [key in string]?: string;
    } | null;
    /**
     * Required active turn id precondition. The request fails when it does not
     * match the currently active turn.
     */
    expectedTurnId: string;
};
