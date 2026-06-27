typedef JsonMap = Map<String, dynamic>;

String readString(JsonMap map, String key, [String fallback = '']) {
  final value = map[key];
  return value is String ? value : fallback;
}

int readInt(JsonMap map, String key, [int fallback = 0]) {
  final value = map[key];
  if (value is int) {
    return value;
  }
  if (value is num) {
    return value.round();
  }
  return fallback;
}

bool readBool(JsonMap map, String key, [bool fallback = false]) {
  final value = map[key];
  return value is bool ? value : fallback;
}

JsonMap readMap(JsonMap map, String key) {
  final value = map[key];
  if (value is JsonMap) {
    return value;
  }
  if (value is Map) {
    final converted = <String, dynamic>{};
    for (final entry in value.entries) {
      if (entry.key is String) {
        converted[entry.key as String] = entry.value;
      }
    }
    return converted;
  }
  return const {};
}

List<JsonMap> readMapList(JsonMap map, String key) {
  final value = map[key];
  if (value is! List) {
    return const [];
  }
  final result = <JsonMap>[];
  for (final item in value) {
    if (item is JsonMap) {
      result.add(item);
      continue;
    }
    if (item is Map) {
      final converted = <String, dynamic>{};
      for (final entry in item.entries) {
        if (entry.key is String) {
          converted[entry.key as String] = entry.value;
        }
      }
      if (converted.isNotEmpty || item.isEmpty) {
        result.add(converted);
      }
    }
  }
  return result;
}

class AuthSessionItem {
  AuthSessionItem({
    required this.sessionId,
    required this.deviceName,
    this.createdAt = 0,
    this.lastSeenAt = 0,
    this.expiresAt = 0,
    this.current = false,
    this.online = false,
  });

  factory AuthSessionItem.fromJson(JsonMap json) {
    return AuthSessionItem(
      sessionId: readString(json, 'sessionId'),
      deviceName: readString(json, 'deviceName', '未知设备'),
      createdAt: readInt(json, 'createdAt'),
      lastSeenAt: readInt(json, 'lastSeenAt'),
      expiresAt: readInt(json, 'expiresAt'),
      current: readBool(json, 'current'),
      online: readBool(json, 'online'),
    );
  }

  final String sessionId;
  final String deviceName;
  final int createdAt;
  final int lastSeenAt;
  final int expiresAt;
  final bool current;
  final bool online;
}

class SessionItem {
  SessionItem({
    required this.threadId,
    required this.name,
    this.cwd = '',
    this.status = '',
    this.windowStatus = '',
    this.approvalPolicy = '',
    this.sandboxMode = '',
    this.model = '',
    this.reasoningEffort = '',
    this.tokenUsage,
    this.createdAt = 0,
    this.updatedAt = 0,
  });

  factory SessionItem.fromJson(JsonMap json) {
    return SessionItem(
      threadId: readString(json, 'threadId', readString(json, 'id')),
      name: readString(json, 'name', '未命名会话'),
      cwd: readString(json, 'cwd'),
      status: readString(json, 'status'),
      windowStatus: readString(
        json,
        'windowStatus',
        readString(json, 'window_status'),
      ),
      approvalPolicy: readString(
        json,
        'approvalPolicy',
        readString(json, 'approval_policy'),
      ),
      sandboxMode: readString(
        json,
        'sandboxMode',
        readString(json, 'sandbox_mode'),
      ),
      model: readString(json, 'model'),
      reasoningEffort: readString(
        json,
        'reasoningEffort',
        readString(json, 'reasoning_effort'),
      ),
      tokenUsage: json['tokenUsage'] is JsonMap
          ? json['tokenUsage'] as JsonMap
          : null,
      createdAt: readInt(json, 'createdAt', readInt(json, 'created_at')),
      updatedAt: readInt(json, 'updatedAt', readInt(json, 'updated_at')),
    );
  }

  final String threadId;
  final String name;
  final String cwd;
  final String status;
  final String windowStatus;
  final String approvalPolicy;
  final String sandboxMode;
  final String model;
  final String reasoningEffort;
  final JsonMap? tokenUsage;
  final int createdAt;
  final int updatedAt;

  bool get isClosed {
    final normalizedWindowStatus = windowStatus.trim().toLowerCase();
    if (normalizedWindowStatus.isNotEmpty) {
      return normalizedWindowStatus != 'attached' &&
          normalizedWindowStatus != 'opening' &&
          normalizedWindowStatus != 'pending';
    }
    final normalizedStatus = status.trim().toLowerCase();
    return normalizedStatus == 'closed' ||
        normalizedStatus == 'detached' ||
        normalizedStatus == 'archived';
  }
}

class TimelineEntry {
  TimelineEntry({
    required this.id,
    required this.type,
    required this.title,
    this.role = '',
    this.text = '',
    this.status = '',
    this.turnId = '',
    this.itemId = '',
    this.meta = const [],
    this.patch = '',
    this.changes = const [],
    this.attachments = const [],
    this.createdAt = 0,
    this.sequence = 0,
    this.partial = false,
    this.details,
    this.raw,
  });

  final String id;
  final String type;
  final String title;
  final String role;
  final String text;
  final String status;
  final String turnId;
  final String itemId;
  final List<String> meta;
  final String patch;
  final List<JsonMap> changes;
  final List<AttachmentItem> attachments;
  final int createdAt;
  final int sequence;
  final bool partial;
  final JsonMap? details;
  final JsonMap? raw;

  TimelineEntry copyWith({
    String? title,
    String? role,
    String? text,
    String? status,
    String? patch,
    bool? partial,
    List<String>? meta,
    List<JsonMap>? changes,
    List<AttachmentItem>? attachments,
    int? sequence,
    JsonMap? details,
    JsonMap? raw,
  }) {
    return TimelineEntry(
      id: id,
      type: type,
      title: title ?? this.title,
      role: role ?? this.role,
      text: text ?? this.text,
      status: status ?? this.status,
      turnId: turnId,
      itemId: itemId,
      meta: meta ?? this.meta,
      patch: patch ?? this.patch,
      changes: changes ?? this.changes,
      attachments: attachments ?? this.attachments,
      createdAt: createdAt,
      sequence: sequence ?? this.sequence,
      partial: partial ?? this.partial,
      details: details ?? this.details,
      raw: raw ?? this.raw,
    );
  }
}

class ServerRequestItem {
  ServerRequestItem(this.raw);

  final JsonMap raw;

  String get requestId => readString(raw, 'requestId');
  String get method => readString(raw, 'method');
  String get threadId => readString(raw, 'threadId');
  String get turnId => readString(raw, 'turnId');
  String get kind => readString(raw, 'kind');
  String get status => readString(raw, 'status', 'pending');
  String get message => readString(raw, 'message');
  String get command => readString(raw, 'command');
  String get cwd => readString(raw, 'cwd');
  String get tool => readString(raw, 'tool');
  String get namespace => readString(raw, 'namespace');
  String get serverName => readString(raw, 'serverName');
  String get url => readString(raw, 'url');
  String get mode => readString(raw, 'mode');
  String get patch => readString(raw, 'patch');

  List<JsonMap> get questions => readMapList(raw, 'questions');
  List<JsonMap> get changes => readMapList(raw, 'changes');

  JsonMap get arguments =>
      raw['arguments'] is JsonMap ? raw['arguments'] as JsonMap : const {};
  JsonMap get requestedSchema => raw['requestedSchema'] is JsonMap
      ? raw['requestedSchema'] as JsonMap
      : const {};
  JsonMap get responseSchema => raw['responseSchema'] is JsonMap
      ? raw['responseSchema'] as JsonMap
      : const {};
  List<dynamic> get availableDecisions => raw['availableDecisions'] is List
      ? raw['availableDecisions'] as List<dynamic>
      : const [];

  String get displayTitle {
    if (kind.contains('command') ||
        method.contains('commandExecution') ||
        method == 'execCommandApproval') {
      return '命令审批';
    }
    if (method.contains('fileChange') || method == 'applyPatchApproval') {
      return '文件变更审批';
    }
    if (method.contains('permissions')) {
      return '权限审批';
    }
    if (method.contains('requestUserInput')) {
      return '需要输入';
    }
    if (method.contains('dynamicTool')) {
      return '动态工具';
    }
    if (method.contains('elicitation')) {
      return mode == 'url' ? '外部授权' : '表单请求';
    }
    return kind.isNotEmpty ? kind : method;
  }

  String get displayBody {
    if (command.isNotEmpty) {
      return command;
    }
    if (tool.isNotEmpty || namespace.isNotEmpty) {
      return [namespace, tool].where((item) => item.isNotEmpty).join('.');
    }
    if (serverName.isNotEmpty) {
      return serverName;
    }
    if (message.isNotEmpty) {
      return message;
    }
    if (url.isNotEmpty) {
      return url;
    }
    if (patch.isNotEmpty) {
      return patch.length > 240 ? patch.substring(0, 240) : patch;
    }
    return requestId;
  }
}

class CodexModelOption {
  CodexModelOption({
    required this.id,
    required this.model,
    required this.displayName,
    this.description = '',
    this.defaultReasoningEffort = '',
    this.supportedReasoningEfforts = const [],
    this.isDefault = false,
  });

  factory CodexModelOption.fromJson(JsonMap json) {
    return CodexModelOption(
      id: readString(json, 'id'),
      model: readString(json, 'model'),
      displayName: readString(json, 'displayName', readString(json, 'model')),
      description: readString(json, 'description'),
      defaultReasoningEffort: readString(json, 'defaultReasoningEffort'),
      supportedReasoningEfforts: json['supportedReasoningEfforts'] is List
          ? (json['supportedReasoningEfforts'] as List)
                .whereType<String>()
                .toList(growable: false)
          : const [],
      isDefault: json['isDefault'] == true,
    );
  }

  final String id;
  final String model;
  final String displayName;
  final String description;
  final String defaultReasoningEffort;
  final List<String> supportedReasoningEfforts;
  final bool isDefault;
}

class ComposerPrefs {
  const ComposerPrefs({
    this.model = '',
    this.reasoningEffort = 'medium',
    this.approvalPolicy = 'on-request',
    this.sandboxMode = 'workspace-write',
  });

  final String model;
  final String reasoningEffort;
  final String approvalPolicy;
  final String sandboxMode;

  ComposerPrefs copyWith({
    String? model,
    String? reasoningEffort,
    String? approvalPolicy,
    String? sandboxMode,
  }) {
    return ComposerPrefs(
      model: model ?? this.model,
      reasoningEffort: reasoningEffort ?? this.reasoningEffort,
      approvalPolicy: approvalPolicy ?? this.approvalPolicy,
      sandboxMode: sandboxMode ?? this.sandboxMode,
    );
  }
}

class AttachmentItem {
  AttachmentItem({
    required this.id,
    required this.name,
    required this.contentType,
    required this.filePath,
    required this.url,
  });

  factory AttachmentItem.fromJson(JsonMap json) {
    return AttachmentItem(
      id: readString(json, 'id'),
      name: readString(json, 'name'),
      contentType: readString(json, 'contentType'),
      filePath: readString(json, 'filePath'),
      url: readString(json, 'url'),
    );
  }

  final String id;
  final String name;
  final String contentType;
  final String filePath;
  final String url;
}

class WorkspaceListing {
  WorkspaceListing({
    required this.path,
    required this.parentPath,
    required this.entries,
  });

  factory WorkspaceListing.fromJson(JsonMap json) {
    final entries = json['entries'] is List
        ? (json['entries'] as List)
              .whereType<JsonMap>()
              .map(WorkspaceEntry.fromJson)
              .toList(growable: false)
        : <WorkspaceEntry>[];
    return WorkspaceListing(
      path: readString(json, 'path'),
      parentPath: readString(json, 'parentPath'),
      entries: entries,
    );
  }

  final String path;
  final String parentPath;
  final List<WorkspaceEntry> entries;
}

class WorkspaceEntry {
  WorkspaceEntry({required this.name, required this.path});

  factory WorkspaceEntry.fromJson(JsonMap json) {
    return WorkspaceEntry(
      name: readString(json, 'name'),
      path: readString(json, 'path'),
    );
  }

  final String name;
  final String path;
}
