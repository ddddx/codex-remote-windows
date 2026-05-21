import type { PlanType } from "../PlanType.js";
import type { CreditsSnapshot } from "./CreditsSnapshot.js";
import type { RateLimitReachedType } from "./RateLimitReachedType.js";
import type { RateLimitWindow } from "./RateLimitWindow.js";
export type RateLimitSnapshot = {
    limitId: string | null;
    limitName: string | null;
    primary: RateLimitWindow | null;
    secondary: RateLimitWindow | null;
    credits: CreditsSnapshot | null;
    planType: PlanType | null;
    rateLimitReachedType: RateLimitReachedType | null;
};
