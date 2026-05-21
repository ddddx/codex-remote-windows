import type { WebSearchMode } from "../WebSearchMode.js";
import type { ApprovalsReviewer } from "./ApprovalsReviewer.js";
import type { AskForApproval } from "./AskForApproval.js";
import type { ManagedHooksRequirements } from "./ManagedHooksRequirements.js";
import type { NetworkRequirements } from "./NetworkRequirements.js";
import type { ResidencyRequirement } from "./ResidencyRequirement.js";
import type { SandboxMode } from "./SandboxMode.js";
export type ConfigRequirements = {
    allowedApprovalPolicies: Array<AskForApproval> | null;
    allowedApprovalsReviewers: Array<ApprovalsReviewer> | null;
    allowedSandboxModes: Array<SandboxMode> | null;
    allowedWebSearchModes: Array<WebSearchMode> | null;
    featureRequirements: {
        [key in string]?: boolean;
    } | null;
    hooks: ManagedHooksRequirements | null;
    enforceResidency: ResidencyRequirement | null;
    network: NetworkRequirements | null;
};
