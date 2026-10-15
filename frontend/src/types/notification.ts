// Reconstructed type declarations; original type-only files were erased by compilation.
// Assignments derived from frontend usage. Do not edit by hand.


export interface NotificationItem {
  "id"?: string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "user_id"?: string;
  "role_code"?: string;
  "type"?: string;
  "title"?: string;
  "content"?: string;
  "entity_type"?: string;
  "entity_id"?: string;
  "entity_no"?: string;
  "is_read"?: boolean;
  "read_at"?: string;
}

export interface NotificationListResult {
  "total"?: number;
  "list"?: NotificationItem[];
  "items"?: NotificationItem[];
}

export interface UnreadCountResult {
  "filename"?: string;
  "count"?: number;
  "unread_count"?: number;
}
