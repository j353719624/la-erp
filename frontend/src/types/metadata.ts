// Reconstructed type declarations; original type-only files were erased by compilation.
// Schema evidence: evidence/go-structs.json.gz; assignments refined from frontend usage.


export interface BatchCreateFieldsInput {
  "fields"?: CreateFieldInput[];
}

export interface CreateFieldInput {
  "entity_id"?: string;
  "code"?: string;
  "name"?: string;
  "field_type"?: string;
  "is_core"?: boolean;
  "is_required"?: boolean;
  "is_indexed"?: boolean;
  "is_unique"?: boolean;
  "default_value"?: string;
  "validation"?: Record<string, unknown>;
  "ref_entity"?: string;
  "ref_display"?: string;
  "sort_order"?: number;
  "group_name"?: string;
  "[name]"?: string;
}

export interface Entity {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "code"?: string;
  "name"?: string;
  "table_name": string;
  "category"?: string;
  "is_system"?: boolean;
  "ext_schema"?: Record<string, unknown>;
  "edges"?: { "fields"?: Field[]; "layouts"?: Layout[] };
  "[name]"?: string;
  "fields"?: Field[];
  "layouts"?: Layout[];
}

export interface Field {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "entity_id"?: string;
  "code"?: string;
  "name"?: string;
  "field_type"?: string;
  "is_core"?: boolean;
  "is_required"?: boolean;
  "is_indexed"?: boolean;
  "is_unique"?: boolean;
  "default_value"?: string;
  "validation"?: { options?: (string | { label?: string; value?: string })[]; [key: string]: unknown };
  "ref_entity"?: string;
  "ref_display"?: string;
  "sort_order"?: number;
  "group_name"?: string;
  "edges"?: { "entity"?: Entity };
  "options"?: Record<string, unknown>;
}

export interface IndustryTemplate {
  "category"?: string;
  "name"?: string;
  "description"?: string;
  "icon"?: string;
  "entity_code"?: string;
  "is_system"?: boolean;
  "fields"?: ({ "code"?: string; "name"?: string; "field_type"?: string; "is_required"?: boolean; "is_indexed"?: boolean; "is_unique"?: boolean; "default_value"?: string; "group_name"?: string; "sort_order"?: number; "options"?: (string)[] })[];
  "categories"?: ({ "name"?: string; "children"?: (string)[] })[];
  "units"?: ({ "name"?: string; "is_base"?: boolean })[];
  "id": string;
  "entities"?: Record<string, unknown>[];
}

export interface Layout {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "entity_id"?: string;
  "name"?: string;
  "layout_type"?: string;
  "scope"?: string;
  "scope_id"?: string;
  "is_default"?: boolean;
  "config"?: { table?: { columns?: Record<string, unknown>[] }; header?: { searchFields?: string[] }; [key: string]: unknown };
  "edges"?: { "entity"?: Entity };
}

export interface UpdateFieldInput {
  "name"?: string;
  "field_type"?: string;
  "is_core"?: boolean;
  "is_required"?: boolean;
  "is_indexed"?: boolean;
  "is_unique"?: boolean;
  "default_value"?: string;
  "validation"?: Record<string, unknown>;
  "ref_entity"?: string;
  "ref_display"?: string;
  "sort_order"?: number;
  "group_name"?: string;
}
