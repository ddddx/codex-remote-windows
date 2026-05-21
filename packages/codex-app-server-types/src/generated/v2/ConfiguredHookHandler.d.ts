export type ConfiguredHookHandler = {
    "type": "command";
    command: string;
    timeoutSec: bigint | null;
    async: boolean;
    statusMessage: string | null;
} | {
    "type": "prompt";
} | {
    "type": "agent";
};
