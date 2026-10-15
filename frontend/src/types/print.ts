// Reconstructed type declarations; original type-only files were erased by compilation.
// Assignments derived from frontend usage. Do not edit by hand.


export interface CreatePrintTemplateInput {
  "doc_type"?: string;
  "name"?: string;
  "is_default"?: boolean;
  "paper_size"?: string;
  "paper_width"?: number;
  "paper_height"?: number;
  "font_size"?: number;
  "title_size"?: number;
  "header_size"?: number;
  "row_height"?: number;
  "margin"?: number;
  "print_mode"?: string;
  "show_border"?: boolean;
  "label_per_row"?: number;
  "show_barcode"?: boolean;
  "label_field"?: string;
  "label_sub_field"?: string;
  "show_logo"?: boolean;
  "show_company"?: boolean;
  "show_status"?: boolean;
  "show_totals"?: boolean;
  "show_remark"?: boolean;
  "show_signatures"?: boolean;
  "footer_text"?: string;
  "header_fields"?: PrintHeaderField[];
  "columns"?: PrintColumn[];
}

export interface PrintColumn {
  "key"?: string;
  "label"?: string;
  "show"?: boolean;
  "width"?: number;
  "align"?: string;
}

export interface PrintHeaderField {
  "key"?: string;
  "label"?: string;
  "show"?: boolean;
}

export interface PrintTemplate {
  "id": string;
  "created_at"?: string;
  "updated_at"?: string;
  "deleted_at"?: string;
  "doc_type"?: string;
  "name"?: string;
  "is_default"?: boolean;
  "is_system"?: boolean;
  "paper_size"?: string;
  "paper_width"?: number;
  "paper_height"?: number;
  "font_size"?: number;
  "title_size"?: number;
  "header_size"?: number;
  "row_height"?: number;
  "margin"?: number;
  "print_mode"?: string;
  "show_border"?: boolean;
  "label_per_row"?: number;
  "show_barcode"?: boolean;
  "label_field"?: string;
  "label_sub_field"?: string;
  "show_logo"?: boolean;
  "show_company"?: boolean;
  "show_status"?: boolean;
  "show_totals"?: boolean;
  "show_remark"?: boolean;
  "show_signatures"?: boolean;
  "footer_text"?: string;
  "header_fields"?: PrintHeaderField[];
  "columns"?: PrintColumn[];
  "[field]"?: string;
}

export interface UpdatePrintTemplateInput {
  "code"?: string;
  "name"?: string;
  "is_default"?: boolean;
  "columns"?: PrintColumn[];
  "header_fields"?: PrintHeaderField[];
}
