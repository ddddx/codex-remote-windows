import type { ThreadRealtimeAudioChunk } from "./ThreadRealtimeAudioChunk.js";
/**
 * EXPERIMENTAL - append audio input to thread realtime.
 */
export type ThreadRealtimeAppendAudioParams = {
    threadId: string;
    audio: ThreadRealtimeAudioChunk;
};
