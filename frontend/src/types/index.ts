// Reconstructed type declarations; original type-only files were erased by compilation.
// Assignments derived from frontend usage. Do not edit by hand.


export interface Department {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "code"?: string;
  "name": string;
  "parent_id"?: string;
  "status"?: string;
  "headcount"?: number;
  "remark"?: string;
  "sort"?: number;
}

export interface PaginationParams { page?: number; page_size?: number; pageSize?: number; start_date?: string; end_date?: string; keyword?: string; status?: string; }

export interface PaginationResult<T> { list: T[]; items?: T[]; total: number; page: number; page_size: number; }

export interface Permission {
  "id": string;
  "code"?: string;
  "name"?: string;
  "module"?: string;
  "type"?: string;
  "parent_id"?: string;
  "sort_order"?: number;
  "children"?: (Permission)[];
  "created_at"?: string;
  "updated_at"?: string;
  "[name]"?: string;
}

export interface Role {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "code"?: string;
  "name"?: string;
  "remark"?: string;
  "is_system"?: boolean;
  "data_scope"?: string;
  "edges"?: { "users"?: User[]; "permissions"?: Permission[]; "field_permissions"?: ({ "id"?: string; "created_at"?: string; "updated_at"?: string; "role_id"?: string; "entity_id"?: string; "field_code"?: string; "access_level"?: string; "edges"?: string })[]; "user_roles"?: ({ "id"?: number; "created_at"?: string; "updated_at"?: string; "user_id"?: string; "role_id"?: string; "edges"?: string })[]; "role_permissions"?: ({ "id"?: number; "created_at"?: string; "updated_at"?: string; "role_id"?: string; "permission_id"?: string; "edges"?: string })[] };
  "permissions"?: Permission[];
  "[name]"?: string;
  "users"?: User[];
}

export interface User {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "username"?: string;
  "name"?: string;
  "email"?: string;
  "phone"?: string;
  "avatar"?: string;
  "status"?: string;
  "department_id"?: string;
  "last_login_at"?: string;
  "token_version"?: number;
  "edges"?: { "roles"?: Role[]; "user_roles"?: ({ "id"?: number; "created_at"?: string; "updated_at"?: string; "user_id"?: string; "role_id"?: string; "edges"?: string })[] };
  "role"?: Role;
  "ID"?: string;
  "roles"?: Role[];
  "[name]"?: string;
  "department"?: Department;
}
