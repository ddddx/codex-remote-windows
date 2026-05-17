export type ClientMessage =
  | {
    type: 'tab_create';
    name?: string;
    cwd?: string;
    model?: string;
    approvalPolicy?: string;
    sandboxMode?: string;
  }
  | {
    type: 'tab_close';
    threadId: string;
  }
  | {
    type: 'turn_send';
    threadId: string;
    text: string;
    attachments: Array<{ path: string; name?: string }>;
    clientMessageId?: string;
    model?: string;
    effort?: string;
    approvalPolicy?: string;
    sandboxMode?: string;
  }
  | {
    type: 'command_send';
    threadId: string;
    text: string;
    clientMessageId?: string;
  }
  | {
    type: 'thread_sync';
    threadId: string;
  }
  | {
    type: 'server_request_respond';
    requestId: string;
    response: unknown;
  };
