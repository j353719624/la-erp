-- LA-ERP database schema (SQLite). Generated from a fresh initialised database.

CREATE TABLE `account_balances` (`id` uuid NOT NULL, `period` datetime NOT NULL, `begin_balance` numeric NOT NULL, `debit_amount` numeric NOT NULL, `credit_amount` numeric NOT NULL, `end_balance` numeric NOT NULL, `tenant_id` uuid NOT NULL, `account_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `account_balances_accounts_balances` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE NO ACTION);

CREATE TABLE `account_journal_entries` (`account_id` uuid NOT NULL, `journal_entry_id` uuid NOT NULL, PRIMARY KEY (`account_id`, `journal_entry_id`), CONSTRAINT `account_journal_entries_account_id` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE, CONSTRAINT `account_journal_entries_journal_entry_id` FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries` (`id`) ON DELETE CASCADE);

CREATE TABLE `accounting_periods` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `period` text NOT NULL, `start_date` datetime NOT NULL, `end_date` datetime NOT NULL, `status` text NOT NULL DEFAULT ('open'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, PRIMARY KEY (`id`));

CREATE TABLE `accounts` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `code` text NOT NULL, `name` text NOT NULL, `category` text NOT NULL DEFAULT ('asset'), `sub_category` text NULL, `is_leaf` bool NOT NULL DEFAULT (true), `currency` text NOT NULL DEFAULT ('CNY'), `is_enabled` bool NOT NULL DEFAULT (true), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `parent_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `accounts_accounts_children` FOREIGN KEY (`parent_id`) REFERENCES `accounts` (`id`) ON DELETE SET NULL);

CREATE TABLE `ap_invoices` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `invoice_no` text NOT NULL, `supplier_name` text NULL, `invoice_date` datetime NOT NULL, `total_amount` numeric NOT NULL, `paid_amount` numeric NOT NULL, `balance` numeric NOT NULL, `source_type` text NULL, `source_id` uuid NULL, `source_no` text NULL, `status` text NOT NULL DEFAULT ('unpaid'), `due_date` datetime NULL, `purchase_invoice_no` text NULL, `invoice_status` text NOT NULL DEFAULT ('uninvoiced'), `tax_rate` numeric NULL, `tax_amount` numeric NULL, `invoiced_at` datetime NULL, `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `department_id` uuid NULL, `supplier_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `ap_invoices_suppliers_ap_invoices` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`) ON DELETE SET NULL);

CREATE TABLE `approval_flows` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `code` text NOT NULL, `name` text NOT NULL, `biz_type` text NOT NULL, `is_active` bool NOT NULL DEFAULT (true), `config` json NULL, `remark` text NULL, `tenant_id` uuid NOT NULL, PRIMARY KEY (`id`));

CREATE TABLE `approval_records` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `flow_code` text NOT NULL, `biz_type` text NOT NULL, `biz_id` uuid NULL, `biz_no` text NULL, `initiator_id` uuid NULL, `initiator_name` text NULL, `current_status` text NOT NULL DEFAULT ('pending'), `current_step` integer NOT NULL DEFAULT (0), `next_approver_ids` text NULL, `history` json NULL, `remark` text NULL, `tenant_id` uuid NOT NULL, PRIMARY KEY (`id`));

CREATE TABLE `approval_steps` (`id` uuid NOT NULL, `step_no` integer NOT NULL DEFAULT (1), `name` text NOT NULL, `approver_type` text NOT NULL DEFAULT ('role'), `approver_id` uuid NULL, `approver_name` text NULL, `action_type` text NOT NULL DEFAULT ('approve'), `timeout_hours` integer NOT NULL DEFAULT (24), `is_optional` bool NOT NULL DEFAULT (false), `condition` text NULL, `remark` text NULL, `approval_flow_steps` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `approval_steps_approval_flows_steps` FOREIGN KEY (`approval_flow_steps`) REFERENCES `approval_flows` (`id`) ON DELETE NO ACTION);

CREATE TABLE `ar_invoices` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `invoice_no` text NOT NULL, `customer_name` text NULL, `invoice_date` datetime NOT NULL, `total_amount` numeric NOT NULL, `received_amount` numeric NOT NULL, `balance` numeric NOT NULL, `source_type` text NULL, `source_id` uuid NULL, `source_no` text NULL, `status` text NOT NULL DEFAULT ('unpaid'), `due_date` datetime NULL, `sales_invoice_no` text NULL, `invoice_status` text NOT NULL DEFAULT ('uninvoiced'), `tax_rate` numeric NULL, `tax_amount` numeric NULL, `invoiced_at` datetime NULL, `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `department_id` uuid NULL, `customer_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `ar_invoices_customers_ar_invoices` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE SET NULL);

CREATE TABLE `assembly_order_lines` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `line_no` integer NOT NULL DEFAULT (1), `unit_id` uuid NULL, `product_name` text NULL, `product_code` text NULL, `spec` text NULL, `qty` numeric NOT NULL, `unit_cost` numeric NOT NULL, `batch_no` text NULL, `remark` text NULL, `tenant_id` uuid NOT NULL, `assembly_id` uuid NOT NULL, `product_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `assembly_order_lines_assembly_orders_lines` FOREIGN KEY (`assembly_id`) REFERENCES `assembly_orders` (`id`) ON DELETE NO ACTION, CONSTRAINT `assembly_order_lines_products_assembly_order_lines` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION);

CREATE TABLE `assembly_orders` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `assembly_no` text NOT NULL, `asm_type` text NOT NULL DEFAULT ('assemble'), `warehouse_id` uuid NOT NULL, `product_id` uuid NOT NULL, `product_name` text NULL, `product_code` text NULL, `spec` text NULL, `qty` numeric NOT NULL, `unit_cost` numeric NOT NULL, `total_cost` numeric NOT NULL, `asm_date` datetime NULL, `status` text NOT NULL DEFAULT ('draft'), `remark` text NULL, `confirmed_at` datetime NULL, `confirmed_by` uuid NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `department_id` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE `attendance_requests` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `code` text NOT NULL, `employee_id` uuid NULL, `employee_name` text NOT NULL, `department` text NULL, `request_type` text NOT NULL, `category` text NULL, `start_date` datetime NOT NULL, `end_date` datetime NULL, `days` numeric NOT NULL, `hours` numeric NOT NULL, `reason` text NULL, `status` text NOT NULL DEFAULT ('draft'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE `audit_logs` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `user_id` uuid NULL, `username` text NOT NULL DEFAULT (''), `action` text NOT NULL, `method` text NOT NULL DEFAULT (''), `path` text NOT NULL DEFAULT (''), `entity_type` text NULL, `entity_id` text NULL, `summary` text NOT NULL DEFAULT (''), `ip` text NOT NULL DEFAULT (''), `user_agent` text NOT NULL DEFAULT (''), `status_code` integer NOT NULL DEFAULT (0), `duration_ms` integer NOT NULL DEFAULT (0), PRIMARY KEY (`id`));

CREATE TABLE `bank_accounts` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `account_no` text NOT NULL, `bank_name` text NULL, `account_name` text NULL, `currency` text NOT NULL DEFAULT ('CNY'), `opening_balance` numeric NOT NULL, `is_active` bool NOT NULL DEFAULT (true), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, PRIMARY KEY (`id`));

CREATE TABLE `bank_statements` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `statement_date` datetime NOT NULL, `transaction_no` text NULL, `description` text NULL, `amount` numeric NOT NULL, `balance_after` numeric NOT NULL, `reconciled` bool NOT NULL DEFAULT (false), `matched_ref` text NULL, `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `account_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `bank_statements_bank_accounts_statements` FOREIGN KEY (`account_id`) REFERENCES `bank_accounts` (`id`) ON DELETE NO ACTION);

CREATE TABLE `bo_ms` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `code` text NOT NULL, `status` text NOT NULL DEFAULT ('active'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `product_name` text NULL, `product_code` text NULL, `qty_per` numeric NOT NULL, `version` text NOT NULL DEFAULT ('1.0'), `department_id` uuid NULL, `product_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `bo_ms_products_boms` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE SET NULL);

CREATE TABLE `bom_items` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `line_no` integer NOT NULL DEFAULT (1), `product_name` text NULL, `product_code` text NULL, `qty` numeric NOT NULL, `scrap_rate` numeric NOT NULL, `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `bom_id` uuid NOT NULL, `product_id` uuid NOT NULL, `unit_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `bom_items_bo_ms_items` FOREIGN KEY (`bom_id`) REFERENCES `bo_ms` (`id`) ON DELETE NO ACTION, CONSTRAINT `bom_items_products_bom_items` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION, CONSTRAINT `bom_items_units_bom_items` FOREIGN KEY (`unit_id`) REFERENCES `units` (`id`) ON DELETE SET NULL);

CREATE TABLE `categories` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `code` text NOT NULL, `status` text NOT NULL DEFAULT ('active'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `entity_code` text NOT NULL, `name` text NOT NULL, `tree_path` text NULL, `level` integer NOT NULL DEFAULT (1), `sort_order` integer NOT NULL DEFAULT (0), `parent_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `categories_categories_children` FOREIGN KEY (`parent_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL);

CREATE TABLE `commission_settlements` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `settlement_no` text NOT NULL, `period` text NOT NULL, `salesperson_id` uuid NOT NULL, `salesperson_name` text NULL, `amount` numeric NOT NULL, `base` text NOT NULL DEFAULT ('revenue'), `status` text NOT NULL DEFAULT ('unpaid'), `paid_at` datetime NULL, `remark` text NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE `consignment_order_lines` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `line_no` integer NOT NULL DEFAULT (1), `product_name` text NULL, `product_code` text NULL, `spec` text NULL, `qty` numeric NOT NULL, `sold_qty` numeric NOT NULL, `returned_qty` numeric NOT NULL, `unit_cost` numeric NOT NULL, `amount` numeric NOT NULL, `batch_no` text NULL, `serial_nos` json NULL, `remark` text NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `order_id` uuid NOT NULL, `product_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `consignment_order_lines_consignment_orders_lines` FOREIGN KEY (`order_id`) REFERENCES `consignment_orders` (`id`) ON DELETE NO ACTION, CONSTRAINT `consignment_order_lines_products_consignment_order_lines` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION);

CREATE TABLE `consignment_orders` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `consignment_no` text NOT NULL, `party_id` uuid NULL, `party_name` text NULL, `location_id` uuid NULL, `rack_id` uuid NULL, `status` text NOT NULL DEFAULT ('draft'), `consignment_date` datetime NULL, `expected_return_date` datetime NULL, `total_qty` numeric NOT NULL, `sold_qty` numeric NOT NULL, `returned_qty` numeric NOT NULL, `total_amount` numeric NOT NULL, `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `warehouse_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `consignment_orders_warehouses_consignment_orders` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses` (`id`) ON DELETE NO ACTION);

CREATE TABLE `crm_activities` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `target_type` text NOT NULL, `target_id` uuid NOT NULL, `target_name` text NULL, `type` text NOT NULL DEFAULT ('call'), `content` text NOT NULL, `activity_at` datetime NOT NULL, `next_follow_at` datetime NULL, `created_by` uuid NULL, `tenant_id` uuid NOT NULL, `crm_opportunity_activities` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `crm_activities_crm_opportunities_activities` FOREIGN KEY (`crm_opportunity_activities`) REFERENCES `crm_opportunities` (`id`) ON DELETE SET NULL);

CREATE TABLE `crm_opportunities` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `code` text NOT NULL, `name` text NOT NULL, `customer_id` uuid NULL, `customer_name` text NULL, `lead_id` uuid NULL, `contact_name` text NULL, `contact_phone` text NULL, `amount` numeric NOT NULL, `stage` text NOT NULL DEFAULT ('prospecting'), `probability` integer NOT NULL DEFAULT (10), `expected_close_date` datetime NULL, `source` text NULL, `owner` text NULL, `won_at` datetime NULL, `lost_reason` text NULL, `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE `currencies` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `code` text NOT NULL, `name` text NULL, `symbol` text NULL, `is_base` bool NOT NULL DEFAULT (false), `exchange_rate` numeric NOT NULL, `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, PRIMARY KEY (`id`));

CREATE TABLE customer (
			id TEXT PRIMARY KEY,
			code TEXT UNIQUE NOT NULL,
			name TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'active',
			remark TEXT,
			ext TEXT DEFAULT '{}',
			created_by TEXT,
			updated_by TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			deleted_at DATETIME
		);

CREATE TABLE `customers` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `code` text NOT NULL, `status` text NOT NULL DEFAULT ('active'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `name` text NOT NULL, `contact` text NULL, `phone` text NULL, `email` text NULL, `address` text NULL, `credit_limit` numeric NULL, `credit_balance` numeric NULL, `tax_no` text NULL, `bank_account` text NULL, `payment_term` integer NOT NULL DEFAULT (30), `department_id` uuid NULL, `login_account` text NULL, `password_hash` text NULL, `last_login_at` datetime NULL, `portal_enabled` bool NOT NULL DEFAULT (true), `token_version` integer NOT NULL DEFAULT (0), `category_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `customers_categories_customers` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL);

CREATE TABLE `data_dicts` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `type_code` text NOT NULL, `type_name` text NOT NULL DEFAULT (''), `item_code` text NOT NULL, `item_name` text NOT NULL, `sort_order` integer NOT NULL DEFAULT (0), `status` text NOT NULL DEFAULT ('active'), `remark` text NULL, PRIMARY KEY (`id`));

CREATE TABLE `departments` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `code` text NOT NULL, `name` text NOT NULL, `parent_id` uuid NULL, `status` text NOT NULL DEFAULT ('active'), `headcount` integer NULL, `remark` text NULL, PRIMARY KEY (`id`));

CREATE TABLE `depreciation_entries` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `period` text NOT NULL, `amount` numeric NOT NULL, `status` text NOT NULL DEFAULT ('posted'), `remark` text NULL, `ext` json NULL, `asset_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `depreciation_entries_fixed_assets_depreciation_entries` FOREIGN KEY (`asset_id`) REFERENCES `fixed_assets` (`id`) ON DELETE NO ACTION);

CREATE TABLE `employee_changes` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `employee_id` uuid NOT NULL, `employee_name` text NOT NULL, `change_type` text NOT NULL, `before_value` text NULL, `after_value` text NULL, `effective_date` datetime NOT NULL, `reason` text NULL, `remark` text NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE `employees` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `code` text NOT NULL, `name` text NOT NULL, `gender` text NOT NULL DEFAULT (''), `id_card` text NULL, `birth_date` datetime NULL, `phone` text NULL, `email` text NULL, `address` text NULL, `education` text NULL, `department_id` uuid NULL, `position` text NULL, `employment_type` text NOT NULL DEFAULT ('full_time'), `status` text NOT NULL DEFAULT ('probation'), `hire_date` datetime NOT NULL, `probation_end_date` datetime NULL, `regular_date` datetime NULL, `leave_date` datetime NULL, `leave_reason` text NULL, `base_salary` numeric NULL, `bank_name` text NULL, `bank_account` text NULL, `emergency_contact` text NULL, `emergency_phone` text NULL, `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE `entity_defs` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `code` text NOT NULL, `name` text NOT NULL, `table_name` text NOT NULL, `category` text NOT NULL, `is_system` bool NOT NULL DEFAULT (false), `ext_schema` json NULL, PRIMARY KEY (`id`));

CREATE TABLE `equipment_maintenances` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `equipment_no` text NULL, `equipment_name` text NULL, `record_type` text NOT NULL DEFAULT ('maintain'), `plan_date` datetime NULL, `done_date` datetime NULL, `content` text NULL, `result` text NULL, `cost` numeric NOT NULL, `executor` text NULL, `next_date` datetime NULL, `status` text NOT NULL DEFAULT ('planned'), `remark` text NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `equipment_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `equipment_maintenances_production_equipments_maintenances` FOREIGN KEY (`equipment_id`) REFERENCES `production_equipments` (`id`) ON DELETE NO ACTION);

CREATE TABLE `expense_claim_lines` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `line_no` integer NOT NULL DEFAULT (1), `expense_type` text NOT NULL DEFAULT ('other'), `description` text NULL, `amount` numeric NOT NULL, `remark` text NULL, `ext` json NULL, `claim_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `expense_claim_lines_expense_claims_lines` FOREIGN KEY (`claim_id`) REFERENCES `expense_claims` (`id`) ON DELETE NO ACTION);

CREATE TABLE `expense_claims` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `claim_no` text NOT NULL, `employee_id` uuid NULL, `employee_name` text NOT NULL, `department` text NULL, `claim_date` datetime NOT NULL, `total_amount` numeric NOT NULL, `status` text NOT NULL DEFAULT ('draft'), `payment_status` text NOT NULL DEFAULT ('unpaid'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, PRIMARY KEY (`id`));

CREATE TABLE `export_files` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `filename` text NOT NULL, `kind` text NOT NULL, `permission` text NOT NULL, `expires_at` datetime NULL, PRIMARY KEY (`id`));

CREATE TABLE `field_defs` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `code` text NOT NULL, `name` text NOT NULL, `field_type` text NOT NULL, `is_core` bool NOT NULL DEFAULT (false), `is_required` bool NOT NULL DEFAULT (false), `is_indexed` bool NOT NULL DEFAULT (false), `is_unique` bool NOT NULL DEFAULT (false), `default_value` text NULL, `validation` json NULL, `ref_entity` text NULL, `ref_display` text NULL, `sort_order` integer NOT NULL DEFAULT (0), `group_name` text NULL, `entity_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `field_defs_entity_defs_fields` FOREIGN KEY (`entity_id`) REFERENCES `entity_defs` (`id`) ON DELETE NO ACTION);

CREATE TABLE `fixed_assets` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `asset_no` text NOT NULL, `name` text NOT NULL, `category` text NOT NULL DEFAULT ('equipment'), `acquisition_date` datetime NOT NULL, `original_value` numeric NOT NULL, `useful_life_months` integer NOT NULL DEFAULT (60), `salvage_rate` numeric NOT NULL, `monthly_depreciation` numeric NOT NULL, `accumulated_depreciation` numeric NOT NULL, `net_value` numeric NOT NULL, `status` text NOT NULL DEFAULT ('in_use'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, PRIMARY KEY (`id`));

CREATE TABLE `industry_template_fields` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `code` text NOT NULL, `name` text NOT NULL, `field_type` text NOT NULL, `is_required` bool NOT NULL DEFAULT (false), `is_indexed` bool NOT NULL DEFAULT (false), `is_unique` bool NOT NULL DEFAULT (false), `default_value` text NULL, `group_name` text NULL, `sort_order` integer NOT NULL DEFAULT (0), `options` json NULL, `industry_template_fields` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `industry_template_fields_industry_templates_fields` FOREIGN KEY (`industry_template_fields`) REFERENCES `industry_templates` (`id`) ON DELETE SET NULL);

CREATE TABLE `industry_templates` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `category` text NOT NULL, `name` text NOT NULL, `description` text NULL, `icon` text NULL, `entity_code` text NOT NULL, `is_system` bool NOT NULL DEFAULT (false), `is_active` bool NOT NULL DEFAULT (true), `is_applied` bool NOT NULL DEFAULT (false), `categories` json NULL, `units` json NULL, PRIMARY KEY (`id`));

CREATE TABLE `inventory_balances` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `location_id` uuid NULL, `rack_id` uuid NULL, `batch_no` text NULL, `production_date` datetime NULL, `expiry_date` datetime NULL, `qty_available` numeric NOT NULL, `qty_locked` numeric NOT NULL, `qty_in_transit` numeric NOT NULL, `avg_cost` numeric NOT NULL, `last_in_at` datetime NULL, `last_out_at` datetime NULL, `tenant_id` uuid NOT NULL, `department_id` uuid NULL, `product_id` uuid NOT NULL, `warehouse_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `inventory_balances_products_inventory_balances` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION, CONSTRAINT `inventory_balances_warehouses_inventory_balances` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses` (`id`) ON DELETE NO ACTION);

CREATE TABLE `inventory_check_lines` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `line_no` integer NOT NULL DEFAULT (1), `unit_id` uuid NULL, `product_name` text NULL, `product_code` text NULL, `batch_no` text NULL, `book_qty` numeric NOT NULL, `actual_qty` numeric NOT NULL, `diff_qty` numeric NOT NULL, `diff_type` text NOT NULL DEFAULT ('none'), `unit_cost` numeric NOT NULL, `diff_amount` numeric NOT NULL, `remark` text NULL, `tenant_id` uuid NOT NULL, `check_id` uuid NOT NULL, `product_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `inventory_check_lines_inventory_checks_lines` FOREIGN KEY (`check_id`) REFERENCES `inventory_checks` (`id`) ON DELETE NO ACTION, CONSTRAINT `inventory_check_lines_products_inventory_check_lines` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION);

CREATE TABLE `inventory_checks` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `check_no` text NOT NULL, `location_id` uuid NULL, `status` text NOT NULL DEFAULT ('draft'), `check_date` datetime NULL, `completed_at` datetime NULL, `total_items` integer NOT NULL DEFAULT (0), `profit_items` integer NOT NULL DEFAULT (0), `loss_items` integer NOT NULL DEFAULT (0), `profit_amount` numeric NOT NULL, `loss_amount` numeric NOT NULL, `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `warehouse_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `inventory_checks_warehouses_inventory_checks` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses` (`id`) ON DELETE NO ACTION);

CREATE TABLE `journal_entries` (`id` uuid NOT NULL, `entry_date` datetime NOT NULL, `account_code` text NOT NULL, `account_name` text NOT NULL, `direction` text NOT NULL DEFAULT ('debit'), `amount` numeric NOT NULL, `voucher_no` text NOT NULL, `source_id` uuid NULL, `source_type` text NULL, `remark` text NULL, `created_at` datetime NOT NULL, `tenant_id` uuid NOT NULL, PRIMARY KEY (`id`));

CREATE TABLE `labor_contracts` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `code` text NOT NULL, `contract_type` text NOT NULL DEFAULT ('fixed'), `start_date` datetime NOT NULL, `end_date` datetime NULL, `sign_date` datetime NULL, `probation_months` integer NOT NULL DEFAULT (0), `status` text NOT NULL DEFAULT ('active'), `terminated_date` datetime NULL, `terminate_reason` text NULL, `previous_contract_id` uuid NULL, `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `employee_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `labor_contracts_employees_contracts` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE NO ACTION);

CREATE TABLE `layout_defs` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `name` text NOT NULL, `layout_type` text NOT NULL, `scope` text NOT NULL DEFAULT ('system'), `scope_id` uuid NULL, `is_default` bool NOT NULL DEFAULT (false), `config` json NULL, `entity_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `layout_defs_entity_defs_layouts` FOREIGN KEY (`entity_id`) REFERENCES `entity_defs` (`id`) ON DELETE NO ACTION);

CREATE TABLE `leads` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `lead_no` text NOT NULL, `name` text NOT NULL, `company` text NULL, `phone` text NULL, `email` text NULL, `source` text NOT NULL DEFAULT ('other'), `status` text NOT NULL DEFAULT ('new'), `owner` text NULL, `customer_id` uuid NULL, `converted_at` datetime NULL, `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, PRIMARY KEY (`id`));

CREATE TABLE `loan_order_lines` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `line_no` integer NOT NULL DEFAULT (1), `product_name` text NULL, `product_code` text NULL, `spec` text NULL, `qty` numeric NOT NULL, `returned_qty` numeric NOT NULL, `unit_cost` numeric NOT NULL, `amount` numeric NOT NULL, `batch_no` text NULL, `serial_nos` json NULL, `remark` text NULL, `tenant_id` uuid NOT NULL, `loan_order_id` uuid NOT NULL, `product_id` uuid NOT NULL, `unit_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `loan_order_lines_loan_orders_lines` FOREIGN KEY (`loan_order_id`) REFERENCES `loan_orders` (`id`) ON DELETE NO ACTION, CONSTRAINT `loan_order_lines_products_loan_order_lines` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION, CONSTRAINT `loan_order_lines_units_loan_order_lines` FOREIGN KEY (`unit_id`) REFERENCES `units` (`id`) ON DELETE SET NULL);

CREATE TABLE `loan_orders` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `loan_no` text NOT NULL, `loan_type` text NOT NULL DEFAULT ('out'), `party_name` text NULL, `location_id` uuid NULL, `rack_id` uuid NULL, `status` text NOT NULL DEFAULT ('draft'), `loan_date` datetime NULL, `expected_return_date` datetime NULL, `total_qty` numeric NOT NULL, `total_amount` numeric NOT NULL, `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `warehouse_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `loan_orders_warehouses_loan_orders` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses` (`id`) ON DELETE NO ACTION);

CREATE TABLE `locations` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `code` text NOT NULL, `status` text NOT NULL DEFAULT ('active'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `name` text NOT NULL, `area` real NULL, `warehouse_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `locations_warehouses_locations` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses` (`id`) ON DELETE SET NULL);

CREATE TABLE `material_requirement_lines` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `product_code` text NULL, `product_name` text NULL, `requirement_type` text NOT NULL DEFAULT ('purchase'), `gross_demand` numeric NOT NULL, `available_qty` numeric NOT NULL, `on_order_qty` numeric NOT NULL, `wip_qty` numeric NOT NULL, `safety_stock` numeric NOT NULL, `net_requirement` numeric NOT NULL, `suggested_qty` numeric NOT NULL, `status` text NOT NULL DEFAULT ('suggested'), `source_no` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `mrp_id` uuid NOT NULL, `product_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `material_requirement_lines_material_requirements_lines` FOREIGN KEY (`mrp_id`) REFERENCES `material_requirements` (`id`) ON DELETE NO ACTION, CONSTRAINT `material_requirement_lines_products_material_requirement_lines` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION);

CREATE TABLE `material_requirements` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `mrp_no` text NOT NULL, `plan_date` datetime NOT NULL, `status` text NOT NULL DEFAULT ('draft'), `demand_source_count` integer NOT NULL DEFAULT (0), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, PRIMARY KEY (`id`));

CREATE TABLE `mps_plan_lines` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `product_id` uuid NULL, `product_code` text NULL, `product_name` text NULL, `qty_demand` numeric NOT NULL, `qty_onhand` numeric NOT NULL, `qty_wip` numeric NOT NULL, `net_qty` numeric NOT NULL, `status` text NOT NULL DEFAULT ('pending'), `plan_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `mps_plan_lines_mps_plans_lines` FOREIGN KEY (`plan_id`) REFERENCES `mps_plans` (`id`) ON DELETE NO ACTION);

CREATE TABLE `mps_plans` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `code` text NOT NULL, `status` text NOT NULL DEFAULT ('active'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `period_start` datetime NULL, `period_end` datetime NULL, `department_id` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE `notifications` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `user_id` uuid NULL, `role_code` text NULL, `type` text NOT NULL, `title` text NOT NULL, `content` text NOT NULL DEFAULT (''), `entity_type` text NULL, `entity_id` uuid NULL, `entity_no` text NULL, `is_read` bool NOT NULL DEFAULT (false), `read_at` datetime NULL, PRIMARY KEY (`id`));

CREATE TABLE `number_counters` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `prefix` text NOT NULL, `seq` integer NOT NULL DEFAULT (0), PRIMARY KEY (`id`));

CREATE TABLE `order_change_logs` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `order_type` text NOT NULL, `order_id` uuid NOT NULL, `order_no` text NULL, `change_type` text NOT NULL DEFAULT ('lines_changed'), `reason` text NULL, `before_lines` json NULL, `after_lines` json NULL, `operator_id` uuid NULL, `tenant_id` uuid NOT NULL, PRIMARY KEY (`id`));

CREATE TABLE `payment_payment_lines` (`id` uuid NOT NULL, `line_no` integer NOT NULL DEFAULT (1), `ap_invoice_no` text NULL, `amount` numeric NOT NULL, `remark` text NULL, `ap_invoice_id` uuid NULL, `payment_payment_lines` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `payment_payment_lines_ap_invoices_payment_lines` FOREIGN KEY (`ap_invoice_id`) REFERENCES `ap_invoices` (`id`) ON DELETE SET NULL, CONSTRAINT `payment_payment_lines_payment_payments_lines` FOREIGN KEY (`payment_payment_lines`) REFERENCES `payment_payments` (`id`) ON DELETE NO ACTION);

CREATE TABLE `payment_payments` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `payment_no` text NOT NULL, `supplier_name` text NULL, `payment_date` datetime NOT NULL, `amount` numeric NOT NULL, `payment_type` text NOT NULL DEFAULT ('normal'), `currency_code` text NULL, `exchange_rate` numeric NULL, `cash_account_id` uuid NULL, `cash_account_code` text NULL, `cash_account_name` text NULL, `status` text NOT NULL DEFAULT ('draft'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `supplier_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `payment_payments_suppliers_payment_payments` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`) ON DELETE SET NULL);

CREATE TABLE `payment_plan_items` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `seq` integer NOT NULL, `due_date` datetime NOT NULL, `planned_amount` numeric NOT NULL, `received_amount` numeric NOT NULL, `status` text NOT NULL DEFAULT ('pending'), `remark` text NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `payment_plan_items` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `payment_plan_items_payment_plans_items` FOREIGN KEY (`payment_plan_items`) REFERENCES `payment_plans` (`id`) ON DELETE NO ACTION);

CREATE TABLE `payment_plans` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `plan_no` text NOT NULL, `plan_type` text NOT NULL DEFAULT ('receivable'), `party_id` uuid NULL, `party_name` text NULL, `source_type` text NULL, `source_id` uuid NULL, `source_no` text NULL, `total_amount` numeric NOT NULL, `received_amount` numeric NOT NULL, `status` text NOT NULL DEFAULT ('active'), `start_date` datetime NULL, `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE `payment_receipt_lines` (`id` uuid NOT NULL, `line_no` integer NOT NULL DEFAULT (1), `ar_invoice_no` text NULL, `amount` numeric NOT NULL, `remark` text NULL, `ar_invoice_id` uuid NULL, `payment_receipt_lines` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `payment_receipt_lines_ar_invoices_receipt_lines` FOREIGN KEY (`ar_invoice_id`) REFERENCES `ar_invoices` (`id`) ON DELETE SET NULL, CONSTRAINT `payment_receipt_lines_payment_receipts_lines` FOREIGN KEY (`payment_receipt_lines`) REFERENCES `payment_receipts` (`id`) ON DELETE NO ACTION);

CREATE TABLE `payment_receipts` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `receipt_no` text NOT NULL, `customer_name` text NULL, `receipt_date` datetime NOT NULL, `amount` numeric NOT NULL, `receipt_type` text NOT NULL DEFAULT ('normal'), `currency_code` text NULL, `exchange_rate` numeric NULL, `cash_account_id` uuid NULL, `cash_account_code` text NULL, `cash_account_name` text NULL, `status` text NOT NULL DEFAULT ('draft'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `customer_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `payment_receipts_customers_payment_receipts` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE SET NULL);

CREATE TABLE `payroll_batches` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `batch_no` text NOT NULL, `period` text NOT NULL, `status` text NOT NULL DEFAULT ('draft'), `total_amount` numeric NOT NULL, `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, PRIMARY KEY (`id`));

CREATE TABLE `payroll_items` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `line_no` integer NOT NULL DEFAULT (1), `employee_id` uuid NULL, `employee_name` text NOT NULL, `department` text NULL, `base_salary` numeric NOT NULL, `bonus` numeric NOT NULL, `allowance` numeric NOT NULL, `deduction` numeric NOT NULL, `net_pay` numeric NOT NULL, `remark` text NULL, `ext` json NULL, `batch_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `payroll_items_payroll_batches_items` FOREIGN KEY (`batch_id`) REFERENCES `payroll_batches` (`id`) ON DELETE NO ACTION);

CREATE TABLE `perf_assessment_items` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `indicator` text NOT NULL, `weight` numeric NOT NULL, `score` numeric NOT NULL, `remark` text NULL, `tenant_id` uuid NOT NULL, `assessment_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `perf_assessment_items_perf_assessments_items` FOREIGN KEY (`assessment_id`) REFERENCES `perf_assessments` (`id`) ON DELETE NO ACTION);

CREATE TABLE `perf_assessments` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `code` text NOT NULL, `employee_id` uuid NULL, `employee_name` text NOT NULL, `department` text NULL, `template_id` uuid NULL, `template_name` text NULL, `period` text NOT NULL, `total_score` numeric NOT NULL, `level` text NULL, `status` text NOT NULL DEFAULT ('draft'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE `perf_template_items` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `indicator` text NOT NULL, `weight` numeric NOT NULL, `description` text NULL, `tenant_id` uuid NOT NULL, `template_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `perf_template_items_perf_templates_items` FOREIGN KEY (`template_id`) REFERENCES `perf_templates` (`id`) ON DELETE NO ACTION);

CREATE TABLE `perf_templates` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `name` text NOT NULL, `remark` text NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE `piece_rates` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `name` text NOT NULL, `product_id` uuid NULL, `unit_price` numeric NOT NULL, `status` text NOT NULL DEFAULT ('active'), `remark` text NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE `piecework_records` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `code` text NOT NULL, `employee_id` uuid NULL, `employee_name` text NOT NULL, `department` text NULL, `item_name` text NOT NULL, `rate_id` uuid NULL, `qty` numeric NOT NULL, `unit_price` numeric NOT NULL, `amount` numeric NOT NULL, `work_date` datetime NOT NULL, `source` text NOT NULL DEFAULT ('manual'), `work_order_process_id` uuid NULL, `remark` text NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE `price_list_lines` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `product_id` uuid NOT NULL, `product_name` text NULL, `product_code` text NULL, `price` numeric NOT NULL, `min_qty` numeric NOT NULL, `remark` text NULL, `tenant_id` uuid NOT NULL, `price_list_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `price_list_lines_price_lists_lines` FOREIGN KEY (`price_list_id`) REFERENCES `price_lists` (`id`) ON DELETE NO ACTION);

CREATE TABLE `price_lists` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `name` text NOT NULL, `list_type` text NOT NULL DEFAULT ('customer'), `entity_id` uuid NULL, `entity_name` text NULL, `currency` text NOT NULL DEFAULT ('CNY'), `effective_date` datetime NULL, `expiry_date` datetime NULL, `status` text NOT NULL DEFAULT ('active'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE `print_templates` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `doc_type` text NOT NULL, `name` text NOT NULL, `is_default` bool NOT NULL DEFAULT (false), `is_system` bool NOT NULL DEFAULT (false), `paper_size` text NOT NULL DEFAULT ('A4'), `paper_width` integer NOT NULL DEFAULT (210), `paper_height` integer NOT NULL DEFAULT (297), `font_size` integer NOT NULL DEFAULT (14), `title_size` integer NOT NULL DEFAULT (24), `header_size` integer NOT NULL DEFAULT (14), `row_height` integer NOT NULL DEFAULT (34), `margin` integer NOT NULL DEFAULT (14), `print_mode` text NOT NULL DEFAULT ('normal'), `show_border` bool NOT NULL DEFAULT (true), `label_per_row` integer NOT NULL DEFAULT (2), `show_barcode` bool NOT NULL DEFAULT (false), `label_field` text NOT NULL DEFAULT ('product_name'), `label_sub_field` text NOT NULL DEFAULT ('spec'), `show_logo` bool NOT NULL DEFAULT (true), `show_company` bool NOT NULL DEFAULT (true), `show_status` bool NOT NULL DEFAULT (true), `show_totals` bool NOT NULL DEFAULT (true), `show_remark` bool NOT NULL DEFAULT (true), `show_signatures` bool NOT NULL DEFAULT (true), `footer_text` text NULL, `header_fields` json NULL, `columns` json NULL, PRIMARY KEY (`id`));

CREATE TABLE product (
			id TEXT PRIMARY KEY,
			code TEXT UNIQUE NOT NULL,
			name TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'active',
			remark TEXT,
			ext TEXT DEFAULT '{}',
			created_by TEXT,
			updated_by TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			deleted_at DATETIME
		);

CREATE TABLE `product_combo_items` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `product_id` uuid NOT NULL, `component_id` uuid NOT NULL, `component_code` text NULL, `component_name` text NULL, `spec` text NULL, `unit_id` uuid NULL, `unit_name` text NULL, `qty` numeric NOT NULL, `line_no` integer NOT NULL DEFAULT (1), `remark` text NULL, `tenant_id` uuid NOT NULL, PRIMARY KEY (`id`));

CREATE TABLE `product_documents` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `doc_no` text NOT NULL, `product_id` uuid NULL, `product_name` text NULL, `doc_type` text NOT NULL DEFAULT ('instruction'), `title` text NOT NULL, `version` text NOT NULL DEFAULT ('A'), `content` text NULL, `file_url` text NULL, `effective_date` datetime NULL, `status` text NOT NULL DEFAULT ('draft'), `author` text NULL, `remark` text NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE `product_spus` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `code` text NOT NULL, `status` text NOT NULL DEFAULT ('active'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `name` text NOT NULL, `category_id` uuid NULL, `unit_id` uuid NULL, `description` text NULL, `images` json NULL, `dims` json NULL, PRIMARY KEY (`id`));

CREATE TABLE `production_equipments` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `equipment_no` text NOT NULL, `name` text NOT NULL, `category` text NULL, `model` text NULL, `spec` text NULL, `manufacturer` text NULL, `serial_no` text NULL, `location` text NULL, `work_center_id` uuid NULL, `work_center_name` text NULL, `status` text NOT NULL DEFAULT ('idle'), `capacity_per_hour` real NOT NULL DEFAULT (0), `purchase_date` datetime NULL, `warranty_until` datetime NULL, `responsible` text NULL, `is_active` bool NOT NULL DEFAULT (true), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE `production_picking_lines` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `line_no` integer NOT NULL DEFAULT (1), `product_name` text NULL, `product_code` text NULL, `qty` numeric NOT NULL, `picked_qty` numeric NOT NULL, `unit_cost` numeric NOT NULL, `batch_no` text NULL, `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `product_id` uuid NOT NULL, `picking_id` uuid NOT NULL, `unit_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `production_picking_lines_products_production_picking_lines` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION, CONSTRAINT `production_picking_lines_production_pickings_lines` FOREIGN KEY (`picking_id`) REFERENCES `production_pickings` (`id`) ON DELETE NO ACTION, CONSTRAINT `production_picking_lines_units_production_picking_lines` FOREIGN KEY (`unit_id`) REFERENCES `units` (`id`) ON DELETE SET NULL);

CREATE TABLE `production_pickings` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `picking_no` text NOT NULL, `work_order_no` text NULL, `status` text NOT NULL DEFAULT ('draft'), `picking_date` datetime NULL, `confirmed_at` datetime NULL, `total_qty` numeric NOT NULL, `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `warehouse_id` uuid NULL, `work_order_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `production_pickings_warehouses_production_pickings` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses` (`id`) ON DELETE SET NULL, CONSTRAINT `production_pickings_work_orders_pickings` FOREIGN KEY (`work_order_id`) REFERENCES `work_orders` (`id`) ON DELETE SET NULL);

CREATE TABLE `production_receipt_lines` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `line_no` integer NOT NULL DEFAULT (1), `product_name` text NULL, `product_code` text NULL, `qty` numeric NOT NULL, `unit_cost` numeric NOT NULL, `total_cost` numeric NOT NULL, `batch_no` text NULL, `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `product_id` uuid NOT NULL, `receipt_id` uuid NOT NULL, `unit_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `production_receipt_lines_products_production_receipt_lines` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION, CONSTRAINT `production_receipt_lines_production_receipts_lines` FOREIGN KEY (`receipt_id`) REFERENCES `production_receipts` (`id`) ON DELETE NO ACTION, CONSTRAINT `production_receipt_lines_units_production_receipt_lines` FOREIGN KEY (`unit_id`) REFERENCES `units` (`id`) ON DELETE SET NULL);

CREATE TABLE `production_receipts` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `receipt_no` text NOT NULL, `work_order_no` text NULL, `status` text NOT NULL DEFAULT ('draft'), `receipt_date` datetime NULL, `confirmed_at` datetime NULL, `total_qty` numeric NOT NULL, `total_cost` numeric NOT NULL, `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `warehouse_id` uuid NULL, `work_order_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `production_receipts_warehouses_production_receipts` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses` (`id`) ON DELETE SET NULL, CONSTRAINT `production_receipts_work_orders_receipts` FOREIGN KEY (`work_order_id`) REFERENCES `work_orders` (`id`) ON DELETE SET NULL);

CREATE TABLE `production_return_lines` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `line_no` integer NOT NULL DEFAULT (1), `product_name` text NULL, `product_code` text NULL, `qty` numeric NOT NULL, `unit_cost` numeric NOT NULL, `batch_no` text NULL, `reason` text NULL, `remark` text NULL, `tenant_id` uuid NOT NULL, `product_id` uuid NOT NULL, `return_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `production_return_lines_products_production_return_lines` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION, CONSTRAINT `production_return_lines_production_returns_lines` FOREIGN KEY (`return_id`) REFERENCES `production_returns` (`id`) ON DELETE NO ACTION);

CREATE TABLE `production_returns` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `return_no` text NOT NULL, `work_order_no` text NULL, `warehouse_id` uuid NULL, `return_date` datetime NOT NULL, `status` text NOT NULL DEFAULT ('draft'), `reason` text NOT NULL DEFAULT ('excess'), `remark` text NULL, `created_by` uuid NULL, `tenant_id` uuid NOT NULL, `work_order_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `production_returns_work_orders_returns` FOREIGN KEY (`work_order_id`) REFERENCES `work_orders` (`id`) ON DELETE SET NULL);

CREATE TABLE `production_team_members` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `employee_id` uuid NULL, `name` text NOT NULL, `employee_no` text NULL, `skill` text NULL, `skill_level` text NULL, `phone` text NULL, `is_active` bool NOT NULL DEFAULT (true), `remark` text NULL, `tenant_id` uuid NOT NULL, `team_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `production_team_members_production_teams_members` FOREIGN KEY (`team_id`) REFERENCES `production_teams` (`id`) ON DELETE NO ACTION);

CREATE TABLE `production_teams` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `code` text NOT NULL, `name` text NOT NULL, `workshop` text NULL, `leader` text NULL, `shift` text NOT NULL DEFAULT ('day'), `member_count` integer NOT NULL DEFAULT (0), `is_active` bool NOT NULL DEFAULT (true), `remark` text NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE `products` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `code` text NOT NULL, `status` text NOT NULL DEFAULT ('active'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `name` text NOT NULL, `spec` text NULL, `barcode` text NULL, `product_type` text NOT NULL DEFAULT ('goods'), `is_batch` bool NOT NULL DEFAULT (false), `is_serial` bool NOT NULL DEFAULT (false), `shelf_life_days` integer NULL, `safety_stock` numeric NOT NULL, `min_order_qty` numeric NOT NULL, `cost_method` text NOT NULL DEFAULT ('weighted_avg'), `sale_price` numeric NULL, `purchase_price` numeric NULL, `image_url` text NULL, `images` json NULL, `description` text NULL, `ext_fields` json NULL, `is_combo` bool NOT NULL DEFAULT (false), `department_id` uuid NULL, `category_id` uuid NULL, `spu_id` uuid NULL, `unit_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `products_categories_products` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL, CONSTRAINT `products_product_spus_products` FOREIGN KEY (`spu_id`) REFERENCES `product_spus` (`id`) ON DELETE SET NULL, CONSTRAINT `products_units_products` FOREIGN KEY (`unit_id`) REFERENCES `units` (`id`) ON DELETE SET NULL);

CREATE TABLE `purchase_contracts` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `contract_no` text NOT NULL, `supplier_id` uuid NULL, `supplier_name` text NULL, `contract_date` datetime NULL, `start_date` datetime NULL, `end_date` datetime NULL, `total_amount` numeric NOT NULL, `status` text NOT NULL DEFAULT ('draft'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE purchase_order (
			id TEXT PRIMARY KEY,
			code TEXT UNIQUE NOT NULL,
			name TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'active',
			remark TEXT,
			ext TEXT DEFAULT '{}',
			created_by TEXT,
			updated_by TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			deleted_at DATETIME
		);

CREATE TABLE `purchase_order_lines` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `line_no` integer NOT NULL DEFAULT (1), `product_name` text NULL, `product_code` text NULL, `spec` text NULL, `qty` numeric NOT NULL, `delivered_qty` numeric NOT NULL, `returned_qty` numeric NOT NULL, `price` numeric NOT NULL, `discount` numeric NOT NULL, `tax_rate` numeric NOT NULL, `amount` numeric NOT NULL, `tax_amount` numeric NOT NULL, `remark` text NULL, `is_gift` bool NOT NULL DEFAULT (false), `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `product_id` uuid NOT NULL, `order_id` uuid NOT NULL, `unit_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `purchase_order_lines_products_purchase_order_lines` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION, CONSTRAINT `purchase_order_lines_purchase_orders_lines` FOREIGN KEY (`order_id`) REFERENCES `purchase_orders` (`id`) ON DELETE NO ACTION, CONSTRAINT `purchase_order_lines_units_purchase_order_lines` FOREIGN KEY (`unit_id`) REFERENCES `units` (`id`) ON DELETE SET NULL);

CREATE TABLE `purchase_orders` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `order_no` text NOT NULL, `warehouse_id` uuid NULL, `status` text NOT NULL DEFAULT ('draft'), `order_date` datetime NULL, `expected_date` datetime NULL, `confirmed_at` datetime NULL, `approved_at` datetime NULL, `approved_by` uuid NULL, `total_amount` numeric NOT NULL, `total_qty` numeric NOT NULL, `discount_amount` numeric NOT NULL, `tax_amount` numeric NOT NULL, `paid_amount` numeric NOT NULL, `currency` text NOT NULL DEFAULT ('CNY'), `payment_status` text NOT NULL DEFAULT ('unpaid'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `supplier_name` text NULL, `department_id` uuid NULL, `contract_id` uuid NULL, `supplier_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `purchase_orders_purchase_contracts_purchase_orders` FOREIGN KEY (`contract_id`) REFERENCES `purchase_contracts` (`id`) ON DELETE SET NULL, CONSTRAINT `purchase_orders_suppliers_purchase_orders` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`) ON DELETE SET NULL);

CREATE TABLE `purchase_reconciliation_lines` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `line_date` datetime NOT NULL, `kind` text NOT NULL DEFAULT ('invoice'), `source_no` text NULL, `source_id` uuid NULL, `amount` numeric NOT NULL, `supplier_amount` numeric NULL, `remark` text NULL, `reconciliation_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `purchase_reconciliation_lines_purchase_reconciliations_lines` FOREIGN KEY (`reconciliation_id`) REFERENCES `purchase_reconciliations` (`id`) ON DELETE NO ACTION);

CREATE TABLE `purchase_reconciliations` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `code` text NOT NULL, `supplier_id` uuid NOT NULL, `supplier_name` text NOT NULL, `period_start` datetime NOT NULL, `period_end` datetime NOT NULL, `status` text NOT NULL DEFAULT ('draft'), `begin_balance` numeric NOT NULL, `period_in` numeric NOT NULL, `period_out` numeric NOT NULL, `end_balance` numeric NOT NULL, `supplier_end_balance` numeric NULL, `diff_amount` numeric NULL, `sent_at` datetime NULL, `confirmed_at` datetime NULL, `confirmed_by` uuid NULL, `dispute_reason` text NULL, `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE `purchase_requisition_lines` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `line_no` integer NOT NULL DEFAULT (1), `unit_id` uuid NULL, `product_name` text NULL, `product_code` text NULL, `spec` text NULL, `qty` numeric NOT NULL, `suggested_price` numeric NOT NULL, `suggested_supplier_id` uuid NULL, `suggested_supplier_name` text NULL, `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `product_id` uuid NOT NULL, `requisition_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `purchase_requisition_lines_products_purchase_requisition_lines` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION, CONSTRAINT `purchase_requisition_lines_purchase_requisitions_lines` FOREIGN KEY (`requisition_id`) REFERENCES `purchase_requisitions` (`id`) ON DELETE NO ACTION);

CREATE TABLE `purchase_requisitions` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `requisition_no` text NOT NULL, `department` text NULL, `applicant` text NULL, `requisition_date` datetime NULL, `expected_date` datetime NULL, `status` text NOT NULL DEFAULT ('draft'), `total_qty` numeric NOT NULL, `total_amount` numeric NOT NULL, `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `department_id` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE `purchase_return_lines` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `line_no` integer NOT NULL DEFAULT (1), `product_name` text NULL, `product_code` text NULL, `spec` text NULL, `qty` numeric NOT NULL, `delivered_qty` numeric NOT NULL, `returned_qty` numeric NOT NULL, `price` numeric NOT NULL, `discount` numeric NOT NULL, `tax_rate` numeric NOT NULL, `amount` numeric NOT NULL, `tax_amount` numeric NOT NULL, `remark` text NULL, `is_gift` bool NOT NULL DEFAULT (false), `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `product_id` uuid NOT NULL, `order_id` uuid NOT NULL, `unit_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `purchase_return_lines_products_purchase_return_lines` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION, CONSTRAINT `purchase_return_lines_purchase_returns_lines` FOREIGN KEY (`order_id`) REFERENCES `purchase_returns` (`id`) ON DELETE NO ACTION, CONSTRAINT `purchase_return_lines_units_purchase_return_lines` FOREIGN KEY (`unit_id`) REFERENCES `units` (`id`) ON DELETE SET NULL);

CREATE TABLE `purchase_returns` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `order_no` text NOT NULL, `warehouse_id` uuid NULL, `status` text NOT NULL DEFAULT ('draft'), `order_date` datetime NULL, `expected_date` datetime NULL, `confirmed_at` datetime NULL, `approved_at` datetime NULL, `approved_by` uuid NULL, `total_amount` numeric NOT NULL, `total_qty` numeric NOT NULL, `discount_amount` numeric NOT NULL, `tax_amount` numeric NOT NULL, `paid_amount` numeric NOT NULL, `currency` text NOT NULL DEFAULT ('CNY'), `payment_status` text NOT NULL DEFAULT ('unpaid'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `department_id` uuid NULL, `supplier_name` text NULL, `purchase_order_id` uuid NULL, `purchase_order_no` text NULL, `supplier_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `purchase_returns_suppliers_purchase_returns` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`) ON DELETE SET NULL);

CREATE TABLE `purchase_rf_qs` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `rfq_no` text NOT NULL, `supplier_id` uuid NULL, `supplier_name` text NULL, `requisition_id` uuid NULL, `requisition_no` text NULL, `rfq_date` datetime NULL, `status` text NOT NULL DEFAULT ('draft'), `remark` text NULL, `converted_at` datetime NULL, `converted_po_id` uuid NULL, `converted_po_no` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE `purchase_rfq_lines` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `line_no` integer NOT NULL DEFAULT (1), `unit_id` uuid NULL, `product_name` text NULL, `product_code` text NULL, `spec` text NULL, `qty` numeric NOT NULL, `quoted_price` numeric NOT NULL, `remark` text NULL, `tenant_id` uuid NOT NULL, `product_id` uuid NOT NULL, `rfq_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `purchase_rfq_lines_products_purchase_rfq_lines` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION, CONSTRAINT `purchase_rfq_lines_purchase_rf_qs_lines` FOREIGN KEY (`rfq_id`) REFERENCES `purchase_rf_qs` (`id`) ON DELETE NO ACTION);

CREATE TABLE `purchase_rfq_quote_lines` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `line_no` integer NOT NULL DEFAULT (1), `product_id` uuid NOT NULL, `product_name` text NULL, `product_code` text NULL, `spec` text NULL, `qty` numeric NOT NULL, `price` numeric NOT NULL, `amount` numeric NOT NULL, `remark` text NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `quote_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `purchase_rfq_quote_lines_purchase_rfq_quotes_lines` FOREIGN KEY (`quote_id`) REFERENCES `purchase_rfq_quotes` (`id`) ON DELETE NO ACTION);

CREATE TABLE `purchase_rfq_quotes` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `supplier_id` uuid NOT NULL, `supplier_name` text NULL, `quote_date` datetime NULL, `status` text NOT NULL DEFAULT ('pending'), `total_amount` numeric NOT NULL, `remark` text NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `rfq_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `purchase_rfq_quotes_purchase_rf_qs_quotes` FOREIGN KEY (`rfq_id`) REFERENCES `purchase_rf_qs` (`id`) ON DELETE NO ACTION);

CREATE TABLE `purchase_suggestion_lines` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `product_code` text NULL, `product_name` text NULL, `suggested_qty` numeric NOT NULL, `planned_date` datetime NULL, `status` text NOT NULL DEFAULT ('pending'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `product_id` uuid NOT NULL, `suggestion_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `purchase_suggestion_lines_products_purchase_suggestion_lines` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION, CONSTRAINT `purchase_suggestion_lines_purchase_suggestions_lines` FOREIGN KEY (`suggestion_id`) REFERENCES `purchase_suggestions` (`id`) ON DELETE NO ACTION);

CREATE TABLE `purchase_suggestions` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `suggestion_no` text NOT NULL, `mrp_id` uuid NULL, `mrp_no` text NULL, `plan_date` datetime NOT NULL, `status` text NOT NULL DEFAULT ('draft'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, PRIMARY KEY (`id`));

CREATE TABLE `racks` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `code` text NOT NULL, `status` text NOT NULL DEFAULT ('active'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `name` text NOT NULL, `rows` integer NULL, `cols` integer NULL, `capacity` real NULL, `location_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `racks_locations_racks` FOREIGN KEY (`location_id`) REFERENCES `locations` (`id`) ON DELETE SET NULL);

CREATE TABLE `recruitment_candidates` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `code` text NOT NULL, `name` text NOT NULL, `phone` text NULL, `email` text NULL, `position_id` uuid NULL, `position_title` text NULL, `source` text NULL, `education` text NULL, `experience_years` integer NULL, `expected_salary` numeric NULL, `status` text NOT NULL DEFAULT ('new'), `employee_id` uuid NULL, `hired_at` datetime NULL, `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE `recruitment_interviews` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `round` integer NOT NULL DEFAULT (1), `interview_date` datetime NOT NULL, `interviewer` text NULL, `comment` text NULL, `result` text NOT NULL DEFAULT ('pending'), `remark` text NULL, `tenant_id` uuid NOT NULL, `candidate_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `recruitment_interviews_recruitment_candidates_interviews` FOREIGN KEY (`candidate_id`) REFERENCES `recruitment_candidates` (`id`) ON DELETE NO ACTION);

CREATE TABLE `recruitment_positions` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `code` text NOT NULL, `title` text NOT NULL, `headcount` integer NOT NULL DEFAULT (1), `salary_min` numeric NULL, `salary_max` numeric NULL, `requirements` text NULL, `owner` text NULL, `status` text NOT NULL DEFAULT ('open'), `remark` text NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE `refresh_tokens` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `user_id` uuid NOT NULL, `expires_at` datetime NOT NULL, `revoked_at` datetime NULL, PRIMARY KEY (`id`));

CREATE TABLE `report_definitions` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `report_code` text NOT NULL, `report_name` text NOT NULL, `category` text NOT NULL DEFAULT ('custom'), `query_sql` text NOT NULL, `columns` json NULL, `status` text NOT NULL DEFAULT ('active'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE `rework_orders` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `code` text NOT NULL, `status` text NOT NULL DEFAULT ('active'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `work_order_id` uuid NULL, `work_order_no` text NULL, `process_id` uuid NULL, `process_code` text NULL, `process_name` text NULL, `qty_rework` numeric NOT NULL, `qty_good` numeric NOT NULL, `qty_bad` numeric NOT NULL, `reason` text NULL, `operator_id` uuid NULL, `operator_name` text NULL, `confirmed_at` datetime NULL, `completed_at` datetime NULL, `department_id` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE `routing_steps` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `sequence` integer NOT NULL DEFAULT (1), `process_code` text NOT NULL, `process_name` text NOT NULL, `work_center` text NULL, `standard_time` real NOT NULL DEFAULT (0), `standard_time_unit` text NOT NULL DEFAULT ('minute'), `setup_time` real NOT NULL DEFAULT (0), `teardown_time` real NOT NULL DEFAULT (0), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `routing_id` uuid NOT NULL, `work_center_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `routing_steps_routings_steps` FOREIGN KEY (`routing_id`) REFERENCES `routings` (`id`) ON DELETE NO ACTION, CONSTRAINT `routing_steps_work_centers_routing_steps` FOREIGN KEY (`work_center_id`) REFERENCES `work_centers` (`id`) ON DELETE SET NULL);

CREATE TABLE `routings` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `code` text NOT NULL, `status` text NOT NULL DEFAULT ('active'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `product_name` text NULL, `product_code` text NULL, `version` text NOT NULL DEFAULT ('1.0'), `department_id` uuid NULL, `product_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `routings_products_routings` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE SET NULL);

CREATE TABLE `sales_commission_configs` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `salesperson_id` uuid NULL, `salesperson_name` text NULL, `rate` numeric NOT NULL, `status` text NOT NULL DEFAULT ('active'), `remark` text NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE `sales_contracts` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `contract_no` text NOT NULL, `customer_id` uuid NULL, `customer_name` text NULL, `customer_contract_no` text NULL, `contract_date` datetime NULL, `start_date` datetime NULL, `end_date` datetime NULL, `total_amount` numeric NOT NULL, `status` text NOT NULL DEFAULT ('draft'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE sales_order (
			id TEXT PRIMARY KEY,
			code TEXT UNIQUE NOT NULL,
			name TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'active',
			remark TEXT,
			ext TEXT DEFAULT '{}',
			created_by TEXT,
			updated_by TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			deleted_at DATETIME
		);

CREATE TABLE `sales_order_lines` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `line_no` integer NOT NULL DEFAULT (1), `product_name` text NULL, `product_code` text NULL, `spec` text NULL, `qty` numeric NOT NULL, `delivered_qty` numeric NOT NULL, `returned_qty` numeric NOT NULL, `price` numeric NOT NULL, `discount` numeric NOT NULL, `tax_rate` numeric NOT NULL, `amount` numeric NOT NULL, `tax_amount` numeric NOT NULL, `remark` text NULL, `is_gift` bool NOT NULL DEFAULT (false), `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `product_id` uuid NOT NULL, `order_id` uuid NOT NULL, `unit_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `sales_order_lines_products_sales_order_lines` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION, CONSTRAINT `sales_order_lines_sales_orders_lines` FOREIGN KEY (`order_id`) REFERENCES `sales_orders` (`id`) ON DELETE NO ACTION, CONSTRAINT `sales_order_lines_units_sales_order_lines` FOREIGN KEY (`unit_id`) REFERENCES `units` (`id`) ON DELETE SET NULL);

CREATE TABLE `sales_orders` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `order_no` text NOT NULL, `warehouse_id` uuid NULL, `status` text NOT NULL DEFAULT ('draft'), `order_date` datetime NULL, `expected_date` datetime NULL, `confirmed_at` datetime NULL, `approved_at` datetime NULL, `approved_by` uuid NULL, `total_amount` numeric NOT NULL, `total_qty` numeric NOT NULL, `discount_amount` numeric NOT NULL, `tax_amount` numeric NOT NULL, `paid_amount` numeric NOT NULL, `currency` text NOT NULL DEFAULT ('CNY'), `payment_status` text NOT NULL DEFAULT ('unpaid'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `customer_name` text NULL, `salesperson_id` uuid NULL, `department_id` uuid NULL, `stock_locked` bool NOT NULL DEFAULT (false), `lock_remark` text NULL, `customer_progress` text NOT NULL DEFAULT ('submitted'), `tracking_no` text NULL, `shipped_at` datetime NULL, `source` text NOT NULL DEFAULT ('manual'), `customer_contract_no` text NULL, `customer_id` uuid NULL, `sales_contract_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `sales_orders_customers_sales_orders` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE SET NULL, CONSTRAINT `sales_orders_sales_contracts_sales_orders` FOREIGN KEY (`sales_contract_id`) REFERENCES `sales_contracts` (`id`) ON DELETE SET NULL);

CREATE TABLE `sales_quotation_lines` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `line_no` integer NOT NULL DEFAULT (1), `unit_id` uuid NULL, `product_name` text NULL, `product_code` text NULL, `spec` text NULL, `qty` numeric NOT NULL, `price` numeric NOT NULL, `discount` numeric NOT NULL, `tax_rate` numeric NOT NULL, `amount` numeric NOT NULL, `tax_amount` numeric NOT NULL, `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `product_id` uuid NOT NULL, `quotation_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `sales_quotation_lines_products_sales_quotation_lines` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION, CONSTRAINT `sales_quotation_lines_sales_quotations_lines` FOREIGN KEY (`quotation_id`) REFERENCES `sales_quotations` (`id`) ON DELETE NO ACTION);

CREATE TABLE `sales_quotations` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `quotation_no` text NOT NULL, `customer_name` text NULL, `salesperson_id` uuid NULL, `quotation_date` datetime NULL, `valid_until` datetime NULL, `status` text NOT NULL DEFAULT ('draft'), `total_qty` numeric NOT NULL, `total_amount` numeric NOT NULL, `discount_amount` numeric NOT NULL, `tax_amount` numeric NOT NULL, `currency` text NOT NULL DEFAULT ('CNY'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `department_id` uuid NULL, `customer_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `sales_quotations_customers_sales_quotations` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE SET NULL);

CREATE TABLE `sales_return_lines` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `line_no` integer NOT NULL DEFAULT (1), `product_name` text NULL, `product_code` text NULL, `spec` text NULL, `qty` numeric NOT NULL, `delivered_qty` numeric NOT NULL, `returned_qty` numeric NOT NULL, `price` numeric NOT NULL, `discount` numeric NOT NULL, `tax_rate` numeric NOT NULL, `amount` numeric NOT NULL, `tax_amount` numeric NOT NULL, `remark` text NULL, `is_gift` bool NOT NULL DEFAULT (false), `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `expand_to_components` bool NOT NULL DEFAULT (false), `product_id` uuid NOT NULL, `order_id` uuid NOT NULL, `unit_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `sales_return_lines_products_sales_return_lines` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION, CONSTRAINT `sales_return_lines_sales_returns_lines` FOREIGN KEY (`order_id`) REFERENCES `sales_returns` (`id`) ON DELETE NO ACTION, CONSTRAINT `sales_return_lines_units_sales_return_lines` FOREIGN KEY (`unit_id`) REFERENCES `units` (`id`) ON DELETE SET NULL);

CREATE TABLE `sales_returns` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `order_no` text NOT NULL, `warehouse_id` uuid NULL, `status` text NOT NULL DEFAULT ('draft'), `order_date` datetime NULL, `expected_date` datetime NULL, `confirmed_at` datetime NULL, `approved_at` datetime NULL, `approved_by` uuid NULL, `total_amount` numeric NOT NULL, `total_qty` numeric NOT NULL, `discount_amount` numeric NOT NULL, `tax_amount` numeric NOT NULL, `paid_amount` numeric NOT NULL, `currency` text NOT NULL DEFAULT ('CNY'), `payment_status` text NOT NULL DEFAULT ('unpaid'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `customer_name` text NULL, `sales_order_id` uuid NULL, `sales_order_no` text NULL, `return_reason` text NULL, `department_id` uuid NULL, `customer_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `sales_returns_customers_sales_returns` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE SET NULL);

CREATE TABLE `serial_numbers` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `product_id` uuid NULL, `product_code` text NULL, `product_name` text NULL, `serial_no` text NOT NULL, `warehouse_id` uuid NULL, `warehouse_name` text NULL, `status` text NOT NULL DEFAULT ('in_stock'), `source_type` text NULL, `source_no` text NULL, `movement_id` uuid NULL, `registered_at` datetime NULL, `out_at` datetime NULL, `remark` text NULL, `tenant_id` uuid NOT NULL, PRIMARY KEY (`id`));

CREATE TABLE `shareholders` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `name` text NOT NULL, `holder_type` text NOT NULL DEFAULT ('natural'), `tax_no` text NULL, `share_ratio` numeric NOT NULL, `capital` numeric NOT NULL, `phone` text NULL, `bank_name` text NULL, `bank_account` text NULL, `is_active` bool NOT NULL DEFAULT (true), `remark` text NULL, `created_by` uuid NULL, `tenant_id` uuid NOT NULL, PRIMARY KEY (`id`));

CREATE TABLE `stock_adjust_lines` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `line_no` integer NOT NULL DEFAULT (1), `unit_id` uuid NULL, `product_name` text NULL, `product_code` text NULL, `spec` text NULL, `qty` numeric NOT NULL, `unit_cost` numeric NOT NULL, `batch_no` text NULL, `remark` text NULL, `tenant_id` uuid NOT NULL, `product_id` uuid NOT NULL, `adjust_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `stock_adjust_lines_products_stock_adjust_lines` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION, CONSTRAINT `stock_adjust_lines_stock_adjusts_lines` FOREIGN KEY (`adjust_id`) REFERENCES `stock_adjusts` (`id`) ON DELETE NO ACTION);

CREATE TABLE `stock_adjusts` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `adjust_no` text NOT NULL, `warehouse_id` uuid NOT NULL, `location_id` uuid NULL, `rack_id` uuid NULL, `adjust_type` text NOT NULL DEFAULT ('profit'), `adjust_date` datetime NULL, `status` text NOT NULL DEFAULT ('draft'), `total_qty` numeric NOT NULL, `remark` text NULL, `confirmed_at` datetime NULL, `confirmed_by` uuid NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE `stock_in_lines` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `line_no` integer NOT NULL DEFAULT (1), `unit_id` uuid NULL, `product_name` text NULL, `product_code` text NULL, `qty` numeric NOT NULL, `received_qty` numeric NOT NULL, `unit_cost` numeric NOT NULL, `amount` numeric NOT NULL, `batch_no` text NULL, `serial_nos` json NULL, `production_date` datetime NULL, `expiry_date` datetime NULL, `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `product_id` uuid NOT NULL, `stock_in_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `stock_in_lines_products_stock_in_lines` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION, CONSTRAINT `stock_in_lines_stock_ins_lines` FOREIGN KEY (`stock_in_id`) REFERENCES `stock_ins` (`id`) ON DELETE NO ACTION);

CREATE TABLE `stock_in_photos` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `url` text NOT NULL, `location_id` uuid NULL, `rack_id` uuid NULL, `remark` text NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `stock_in_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `stock_in_photos_stock_ins_photos` FOREIGN KEY (`stock_in_id`) REFERENCES `stock_ins` (`id`) ON DELETE NO ACTION);

CREATE TABLE `stock_ins` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `stock_in_no` text NOT NULL, `type` text NOT NULL DEFAULT ('purchase'), `location_id` uuid NULL, `rack_id` uuid NULL, `status` text NOT NULL DEFAULT ('draft'), `stock_in_date` datetime NULL, `confirmed_at` datetime NULL, `confirmed_by` uuid NULL, `total_qty` numeric NOT NULL, `total_amount` numeric NOT NULL, `source_no` text NULL, `source_id` uuid NULL, `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `warehouse_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `stock_ins_warehouses_stock_ins` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses` (`id`) ON DELETE NO ACTION);

CREATE TABLE `stock_movements` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `type` text NOT NULL, `source_type` text NOT NULL, `source_id` uuid NULL, `source_no` text NULL, `location_id` uuid NULL, `rack_id` uuid NULL, `batch_no` text NULL, `serial_no` text NULL, `production_date` datetime NULL, `expiry_date` datetime NULL, `qty` numeric NOT NULL, `direction` integer NOT NULL DEFAULT (1), `unit_id` uuid NULL, `unit_cost` numeric NOT NULL, `total_cost` numeric NOT NULL, `balance_after` numeric NOT NULL, `remark` text NULL, `operator_id` uuid NULL, `tenant_id` uuid NOT NULL, `department_id` uuid NULL, `product_id` uuid NOT NULL, `warehouse_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `stock_movements_products_stock_movements` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION, CONSTRAINT `stock_movements_warehouses_stock_movements` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses` (`id`) ON DELETE NO ACTION);

CREATE TABLE `stock_out_lines` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `line_no` integer NOT NULL DEFAULT (1), `unit_id` uuid NULL, `product_name` text NULL, `product_code` text NULL, `qty` numeric NOT NULL, `issued_qty` numeric NOT NULL, `unit_cost` numeric NOT NULL, `amount` numeric NOT NULL, `batch_no` text NULL, `serial_nos` json NULL, `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `product_id` uuid NOT NULL, `stock_out_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `stock_out_lines_products_stock_out_lines` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION, CONSTRAINT `stock_out_lines_stock_outs_lines` FOREIGN KEY (`stock_out_id`) REFERENCES `stock_outs` (`id`) ON DELETE NO ACTION);

CREATE TABLE `stock_outs` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `stock_out_no` text NOT NULL, `type` text NOT NULL DEFAULT ('sales'), `location_id` uuid NULL, `rack_id` uuid NULL, `status` text NOT NULL DEFAULT ('draft'), `stock_out_date` datetime NULL, `confirmed_at` datetime NULL, `confirmed_by` uuid NULL, `total_qty` numeric NOT NULL, `total_amount` numeric NOT NULL, `source_no` text NULL, `source_id` uuid NULL, `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `warehouse_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `stock_outs_warehouses_stock_outs` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses` (`id`) ON DELETE NO ACTION);

CREATE TABLE `stock_transfer_lines` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `line_no` integer NOT NULL DEFAULT (1), `unit_id` uuid NULL, `product_name` text NULL, `product_code` text NULL, `spec` text NULL, `unit_name` text NULL, `qty` numeric NOT NULL, `cost_price` numeric NOT NULL, `amount` numeric NOT NULL, `transferred_qty` numeric NOT NULL, `batch_no` text NULL, `remark` text NULL, `tenant_id` uuid NOT NULL, `product_id` uuid NOT NULL, `transfer_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `stock_transfer_lines_products_stock_transfer_lines` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION, CONSTRAINT `stock_transfer_lines_stock_transfers_lines` FOREIGN KEY (`transfer_id`) REFERENCES `stock_transfers` (`id`) ON DELETE NO ACTION);

CREATE TABLE `stock_transfers` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `transfer_no` text NOT NULL, `from_location_id` uuid NULL, `to_location_id` uuid NULL, `status` text NOT NULL DEFAULT ('draft'), `transfer_date` datetime NULL, `completed_at` datetime NULL, `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `from_warehouse_id` uuid NOT NULL, `to_warehouse_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `stock_transfers_warehouses_stock_transfers_from` FOREIGN KEY (`from_warehouse_id`) REFERENCES `warehouses` (`id`) ON DELETE NO ACTION, CONSTRAINT `stock_transfers_warehouses_stock_transfers_to` FOREIGN KEY (`to_warehouse_id`) REFERENCES `warehouses` (`id`) ON DELETE NO ACTION);

CREATE TABLE `subcontract_order_material_lines` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `line_no` integer NOT NULL DEFAULT (1), `product_name` text NULL, `product_code` text NULL, `spec` text NULL, `qty` numeric NOT NULL, `issued_qty` numeric NOT NULL, `consumed_qty` numeric NOT NULL, `returned_qty` numeric NOT NULL, `unit_cost` numeric NOT NULL, `amount` numeric NOT NULL, `batch_no` text NULL, `remark` text NULL, `tenant_id` uuid NOT NULL, `product_id` uuid NOT NULL, `subcontract_order_id` uuid NOT NULL, `unit_id` uuid NULL, `warehouse_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `subcontract_order_material_line_11787a66af703597216d59c8a0ae2a53` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION, CONSTRAINT `subcontract_order_material_line_8bd06fa061b6998500b92ec352198954` FOREIGN KEY (`subcontract_order_id`) REFERENCES `subcontract_orders` (`id`) ON DELETE NO ACTION, CONSTRAINT `subcontract_order_material_line_1d35216337f75dcc486e132d595aa4fa` FOREIGN KEY (`unit_id`) REFERENCES `units` (`id`) ON DELETE SET NULL, CONSTRAINT `subcontract_order_material_line_c55766ce6dfdf88d9654840fa28b31fd` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses` (`id`) ON DELETE SET NULL);

CREATE TABLE `subcontract_orders` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `code` text NOT NULL, `status` text NOT NULL DEFAULT ('active'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `work_order_id` uuid NULL, `work_order_no` text NULL, `process_id` uuid NULL, `process_code` text NULL, `process_name` text NULL, `supplier_id` uuid NULL, `supplier_name` text NULL, `warehouse_id` uuid NULL, `warehouse_name` text NULL, `product_id` uuid NULL, `product_code` text NULL, `product_name` text NULL, `mode` text NOT NULL DEFAULT ('pure'), `qty` numeric NOT NULL, `unit_price` numeric NULL, `amount` numeric NULL, `material_issued_qty` numeric NULL, `material_issued_cost` numeric NULL, `material_consumed_qty` numeric NULL, `material_consumed_cost` numeric NULL, `material_returned_qty` numeric NULL, `material_returned_cost` numeric NULL, `received_qty` numeric NULL, `diff_qty` numeric NULL, `diff_reason` text NULL, `issue_date` datetime NULL, `confirm_date` datetime NULL, `receive_date` datetime NULL, `complete_date` datetime NULL, `department_id` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE `subcontract_receive_logs` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `seq` integer NOT NULL DEFAULT (1), `qty` numeric NOT NULL, `diff_qty` numeric NOT NULL, `receive_date` datetime NULL, `warehouse_id` uuid NULL, `warehouse_name` text NULL, `batch_no` text NULL, `material_cost` numeric NOT NULL, `processing_fee` numeric NOT NULL, `unit_cost` numeric NOT NULL, `diff_reason` text NULL, `remark` text NULL, `created_by` uuid NULL, `tenant_id` uuid NOT NULL, `subcontract_order_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `subcontract_receive_logs_subcontract_orders_receive_logs` FOREIGN KEY (`subcontract_order_id`) REFERENCES `subcontract_orders` (`id`) ON DELETE NO ACTION);

CREATE TABLE supplier (
			id TEXT PRIMARY KEY,
			code TEXT UNIQUE NOT NULL,
			name TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'active',
			remark TEXT,
			ext TEXT DEFAULT '{}',
			created_by TEXT,
			updated_by TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			deleted_at DATETIME
		);

CREATE TABLE `suppliers` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `code` text NOT NULL, `status` text NOT NULL DEFAULT ('active'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `name` text NOT NULL, `contact` text NULL, `phone` text NULL, `email` text NULL, `address` text NULL, `tax_no` text NULL, `bank_account` text NULL, `payment_term` integer NOT NULL DEFAULT (30), `rating` text NULL, `department_id` uuid NULL, `category_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `suppliers_categories_suppliers` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL);

CREATE TABLE `sys_field_permissions` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `entity_id` uuid NOT NULL, `field_code` text NOT NULL, `access_level` text NOT NULL DEFAULT ('read'), `role_id` uuid NOT NULL, `sys_role_field_permissions` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `sys_field_permissions_sys_roles_role` FOREIGN KEY (`role_id`) REFERENCES `sys_roles` (`id`) ON DELETE NO ACTION, CONSTRAINT `sys_field_permissions_sys_roles_field_permissions` FOREIGN KEY (`sys_role_field_permissions`) REFERENCES `sys_roles` (`id`) ON DELETE SET NULL);

CREATE TABLE `sys_permissions` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `code` text NOT NULL, `name` text NOT NULL, `module` text NOT NULL, `type` text NOT NULL, `sort_order` integer NOT NULL DEFAULT (0), `parent_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `sys_permissions_sys_permissions_children` FOREIGN KEY (`parent_id`) REFERENCES `sys_permissions` (`id`) ON DELETE SET NULL);

CREATE TABLE `sys_role_permissions` (`id` integer NOT NULL PRIMARY KEY AUTOINCREMENT, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `role_id` uuid NOT NULL, `permission_id` uuid NOT NULL, CONSTRAINT `sys_role_permissions_sys_roles_role` FOREIGN KEY (`role_id`) REFERENCES `sys_roles` (`id`) ON DELETE NO ACTION, CONSTRAINT `sys_role_permissions_sys_permissions_permission` FOREIGN KEY (`permission_id`) REFERENCES `sys_permissions` (`id`) ON DELETE NO ACTION);

CREATE TABLE `sys_roles` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `code` text NOT NULL, `name` text NOT NULL, `remark` text NULL, `is_system` bool NOT NULL DEFAULT (false), `data_scope` text NOT NULL DEFAULT ('all'), PRIMARY KEY (`id`));

CREATE TABLE `sys_user_roles` (`id` integer NOT NULL PRIMARY KEY AUTOINCREMENT, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `user_id` uuid NOT NULL, `role_id` uuid NOT NULL, CONSTRAINT `sys_user_roles_sys_users_user` FOREIGN KEY (`user_id`) REFERENCES `sys_users` (`id`) ON DELETE NO ACTION, CONSTRAINT `sys_user_roles_sys_roles_role` FOREIGN KEY (`role_id`) REFERENCES `sys_roles` (`id`) ON DELETE NO ACTION);

CREATE TABLE `sys_users` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `username` text NOT NULL, `password_hash` text NOT NULL, `name` text NOT NULL DEFAULT (''), `email` text NULL, `phone` text NULL, `avatar` text NULL, `status` text NOT NULL DEFAULT ('active'), `department_id` uuid NULL, `last_login_at` datetime NULL, `token_version` integer NOT NULL DEFAULT (0), PRIMARY KEY (`id`));

-- 部署控制台的公司注册表。
-- POST /api/v1/console/companies 建公司后会往这里写一条，本实现原先没有此表，
-- 所以 GET 只能硬编码返回一条「默认公司」、写路径一律 501。
-- 字段取自 GET /console/companies 的返回行（回归回放 KK-28）：
--   {id, code, name, status, is_default, db_path, db_size, loaded, created_at}
CREATE TABLE `companies` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `code` text NOT NULL, `name` text NOT NULL, `status` text NOT NULL DEFAULT ('active'), `is_default` bool NOT NULL DEFAULT (false), `db_path` text NULL, `db_size` integer NOT NULL DEFAULT (0), `loaded` bool NOT NULL DEFAULT (false), PRIMARY KEY (`id`));

CREATE UNIQUE INDEX `companies_code_unique` ON `companies` (`code`);

CREATE TABLE `system_settings` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `key` text NOT NULL, `value` json NOT NULL, `remark` text NULL, PRIMARY KEY (`id`));

CREATE TABLE `tax_accruals` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `code` text NOT NULL, `period` text NOT NULL, `tax_type` text NOT NULL, `base_amount` numeric NOT NULL, `rate` numeric NOT NULL, `amount` numeric NOT NULL, `expense_account_code` text NULL, `tax_account_code` text NULL, `voucher_id` uuid NULL, `voucher_no` text NULL, `details` json NULL, `remark` text NULL, `created_by` uuid NULL, `tenant_id` uuid NOT NULL, PRIMARY KEY (`id`));

CREATE TABLE `toolings` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `tooling_no` text NOT NULL, `name` text NOT NULL, `category` text NOT NULL DEFAULT ('mold'), `model` text NULL, `spec` text NULL, `applicable_product_id` uuid NULL, `applicable_product_name` text NULL, `life_times` integer NOT NULL DEFAULT (0), `used_times` integer NOT NULL DEFAULT (0), `status` text NOT NULL DEFAULT ('idle'), `location` text NULL, `responsible` text NULL, `purchase_date` datetime NULL, `cost` numeric NOT NULL, `last_maintain_date` datetime NULL, `next_maintain_date` datetime NULL, `maintain_interval_days` integer NOT NULL DEFAULT (0), `remark` text NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE `training_participants` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `employee_id` uuid NULL, `employee_name` text NOT NULL, `department` text NULL, `result` text NOT NULL DEFAULT ('attended'), `score` numeric NULL, `remark` text NULL, `tenant_id` uuid NOT NULL, `training_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `training_participants_training_records_participants` FOREIGN KEY (`training_id`) REFERENCES `training_records` (`id`) ON DELETE NO ACTION);

CREATE TABLE `training_records` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `code` text NOT NULL, `title` text NOT NULL, `category` text NULL, `trainer` text NULL, `training_date` datetime NOT NULL, `location` text NULL, `hours` numeric NOT NULL, `status` text NOT NULL DEFAULT ('planned'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE `unit_conversions` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `unit_name` text NULL, `rate` numeric NOT NULL, `remark` text NULL, `tenant_id` uuid NOT NULL, `product_id` uuid NOT NULL, `unit_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `unit_conversions_products_unit_conversions` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION, CONSTRAINT `unit_conversions_units_unit_conversions` FOREIGN KEY (`unit_id`) REFERENCES `units` (`id`) ON DELETE NO ACTION);

CREATE TABLE `units` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `code` text NOT NULL, `status` text NOT NULL DEFAULT ('active'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `name` text NOT NULL, `is_base` bool NOT NULL DEFAULT (false), PRIMARY KEY (`id`));

CREATE TABLE `voucher_entries` (`id` uuid NOT NULL, `deleted_at` datetime NULL, `sequence` integer NOT NULL DEFAULT (1), `account_code` text NOT NULL, `account_name` text NOT NULL, `direction` text NOT NULL DEFAULT ('debit'), `amount` numeric NOT NULL, `remark` text NULL, `customer_id` uuid NULL, `supplier_id` uuid NULL, `product_id` uuid NULL, `ext` json NULL, `account_entries` uuid NOT NULL, `voucher_entries` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `voucher_entries_accounts_entries` FOREIGN KEY (`account_entries`) REFERENCES `accounts` (`id`) ON DELETE NO ACTION, CONSTRAINT `voucher_entries_vouchers_entries` FOREIGN KEY (`voucher_entries`) REFERENCES `vouchers` (`id`) ON DELETE NO ACTION);

CREATE TABLE `voucher_journal_entries` (`voucher_id` uuid NOT NULL, `journal_entry_id` uuid NOT NULL, PRIMARY KEY (`voucher_id`, `journal_entry_id`), CONSTRAINT `voucher_journal_entries_voucher_id` FOREIGN KEY (`voucher_id`) REFERENCES `vouchers` (`id`) ON DELETE CASCADE, CONSTRAINT `voucher_journal_entries_journal_entry_id` FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries` (`id`) ON DELETE CASCADE);

CREATE TABLE `voucher_templates` (`id` uuid NOT NULL, `code` text NOT NULL, `name` text NOT NULL, `source_type` text NOT NULL, `is_active` bool NOT NULL DEFAULT (true), `entries` json NULL, `remark` text NULL, `tenant_id` uuid NOT NULL, `account_templates` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `voucher_templates_accounts_templates` FOREIGN KEY (`account_templates`) REFERENCES `accounts` (`id`) ON DELETE SET NULL);

CREATE TABLE `vouchers` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `voucher_no` text NOT NULL, `type` text NOT NULL DEFAULT ('general'), `voucher_date` datetime NOT NULL, `status` text NOT NULL DEFAULT ('draft'), `remark` text NULL, `operator_id` uuid NULL, `operator_name` text NULL, `approved_by` uuid NULL, `approved_at` datetime NULL, `source_id` uuid NULL, `source_type` text NULL, `source_no` text NULL, `total_debit` numeric NOT NULL, `total_credit` numeric NOT NULL, `currency_code` text NULL, `exchange_rate` numeric NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `accounting_period_vouchers` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `vouchers_accounting_periods_vouchers` FOREIGN KEY (`accounting_period_vouchers`) REFERENCES `accounting_periods` (`id`) ON DELETE SET NULL);

CREATE TABLE warehouse (
			id TEXT PRIMARY KEY,
			code TEXT UNIQUE NOT NULL,
			name TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'active',
			remark TEXT,
			ext TEXT DEFAULT '{}',
			created_by TEXT,
			updated_by TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			deleted_at DATETIME
		);

CREATE TABLE `warehouses` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `code` text NOT NULL, `status` text NOT NULL DEFAULT ('active'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `name` text NOT NULL, `address` text NULL, `manager_id` uuid NULL, `is_default` bool NOT NULL DEFAULT (false), PRIMARY KEY (`id`));

CREATE TABLE `work_centers` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `code` text NOT NULL, `name` text NOT NULL, `capacity` numeric NOT NULL, `efficiency` real NOT NULL DEFAULT (1), `cost_rate` numeric NOT NULL, `manager` text NULL, `status` text NOT NULL DEFAULT ('active'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `department_id` uuid NULL, PRIMARY KEY (`id`));

CREATE TABLE `work_order_materials` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `product_code` text NULL, `product_name` text NULL, `qty_required` numeric NOT NULL, `qty_issued` numeric NOT NULL, `qty_returned` numeric NOT NULL, `warehouse_id` uuid NULL, `remark` text NULL, `tenant_id` uuid NOT NULL, `product_id` uuid NOT NULL, `unit_id` uuid NULL, `work_order_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `work_order_materials_products_work_order_materials` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION, CONSTRAINT `work_order_materials_units_work_order_materials` FOREIGN KEY (`unit_id`) REFERENCES `units` (`id`) ON DELETE SET NULL, CONSTRAINT `work_order_materials_work_orders_materials` FOREIGN KEY (`work_order_id`) REFERENCES `work_orders` (`id`) ON DELETE NO ACTION);

CREATE TABLE `work_order_processes` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `sequence` integer NOT NULL DEFAULT (1), `process_code` text NOT NULL, `process_name` text NOT NULL, `work_center` text NULL, `work_center_name` text NULL, `status` text NOT NULL DEFAULT ('pending'), `operator_id` uuid NULL, `operator_name` text NULL, `qty_planned` numeric NOT NULL, `qty_good` numeric NOT NULL, `qty_bad` numeric NOT NULL, `qty_completed` numeric NOT NULL, `standard_time` real NOT NULL DEFAULT (0), `standard_time_unit` text NOT NULL DEFAULT ('minute'), `labor_rate` numeric NOT NULL, `started_at` datetime NULL, `completed_at` datetime NULL, `actual_time` real NOT NULL DEFAULT (0), `actual_time_unit` text NOT NULL DEFAULT ('minute'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `work_center_id` uuid NULL, `work_order_id` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `work_order_processes_work_centers_work_order_processes` FOREIGN KEY (`work_center_id`) REFERENCES `work_centers` (`id`) ON DELETE SET NULL, CONSTRAINT `work_order_processes_work_orders_processes` FOREIGN KEY (`work_order_id`) REFERENCES `work_orders` (`id`) ON DELETE NO ACTION);

CREATE TABLE `work_orders` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `deleted_at` datetime NULL, `department_id` uuid NULL, `order_no` text NOT NULL, `status` text NOT NULL DEFAULT ('draft'), `product_name` text NULL, `product_code` text NULL, `qty` numeric NOT NULL, `completed_qty` numeric NOT NULL, `scrap_qty` numeric NOT NULL, `material_cost` numeric NOT NULL, `labor_cost` numeric NOT NULL, `overhead_cost` numeric NOT NULL, `total_cost` numeric NOT NULL, `planned_start_date` datetime NULL, `planned_end_date` datetime NULL, `actual_start_date` datetime NULL, `actual_end_date` datetime NULL, `confirmed_at` datetime NULL, `approved_at` datetime NULL, `approved_by` uuid NULL, `priority` text NOT NULL DEFAULT ('normal'), `remark` text NULL, `ext` json NULL, `tenant_id` uuid NOT NULL, `created_by` uuid NULL, `updated_by` uuid NULL, `bom_id` uuid NULL, `product_id` uuid NULL, `routing_id` uuid NULL, `warehouse_id` uuid NULL, PRIMARY KEY (`id`), CONSTRAINT `work_orders_bo_ms_work_orders` FOREIGN KEY (`bom_id`) REFERENCES `bo_ms` (`id`) ON DELETE SET NULL, CONSTRAINT `work_orders_products_work_orders` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE SET NULL, CONSTRAINT `work_orders_routings_work_orders` FOREIGN KEY (`routing_id`) REFERENCES `routings` (`id`) ON DELETE SET NULL, CONSTRAINT `work_orders_warehouses_work_orders` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses` (`id`) ON DELETE SET NULL);

CREATE INDEX `account_category` ON `accounts` (`category`);

CREATE INDEX `account_code` ON `accounts` (`code`);

CREATE INDEX `account_parent_id` ON `accounts` (`parent_id`);

CREATE INDEX `accountbalance_account_id_period` ON `account_balances` (`account_id`, `period`);

CREATE UNIQUE INDEX `accounting_periods_period_key` ON `accounting_periods` (`period`);

CREATE INDEX `accountingperiod_period` ON `accounting_periods` (`period`);

CREATE INDEX `accountingperiod_status` ON `accounting_periods` (`status`);

CREATE UNIQUE INDEX `accounts_code_key` ON `accounts` (`code`);

CREATE UNIQUE INDEX `ap_invoices_invoice_no_key` ON `ap_invoices` (`invoice_no`);

CREATE INDEX `apinvoice_invoice_no` ON `ap_invoices` (`invoice_no`);

CREATE INDEX `apinvoice_source_type_source_id` ON `ap_invoices` (`source_type`, `source_id`);

CREATE INDEX `apinvoice_status` ON `ap_invoices` (`status`);

CREATE INDEX `apinvoice_supplier_id` ON `ap_invoices` (`supplier_id`);

CREATE UNIQUE INDEX `approval_flows_code_key` ON `approval_flows` (`code`);

CREATE INDEX `approvalflow_biz_type` ON `approval_flows` (`biz_type`);

CREATE INDEX `approvalflow_code` ON `approval_flows` (`code`);

CREATE INDEX `approvalrecord_biz_type_biz_id` ON `approval_records` (`biz_type`, `biz_id`);

CREATE INDEX `approvalrecord_current_status` ON `approval_records` (`current_status`);

CREATE INDEX `approvalrecord_flow_code` ON `approval_records` (`flow_code`);

CREATE INDEX `approvalstep_step_no` ON `approval_steps` (`step_no`);

CREATE UNIQUE INDEX `ar_invoices_invoice_no_key` ON `ar_invoices` (`invoice_no`);

CREATE INDEX `arinvoice_customer_id` ON `ar_invoices` (`customer_id`);

CREATE INDEX `arinvoice_invoice_no` ON `ar_invoices` (`invoice_no`);

CREATE INDEX `arinvoice_source_type_source_id` ON `ar_invoices` (`source_type`, `source_id`);

CREATE INDEX `arinvoice_status` ON `ar_invoices` (`status`);

CREATE UNIQUE INDEX `assembly_orders_assembly_no_key` ON `assembly_orders` (`assembly_no`);

CREATE INDEX `assemblyorder_assembly_no` ON `assembly_orders` (`assembly_no`);

CREATE INDEX `assemblyorder_status` ON `assembly_orders` (`status`);

CREATE INDEX `assemblyorder_warehouse_id` ON `assembly_orders` (`warehouse_id`);

CREATE INDEX `assemblyorderline_assembly_id` ON `assembly_order_lines` (`assembly_id`);

CREATE INDEX `assemblyorderline_product_id` ON `assembly_order_lines` (`product_id`);

CREATE UNIQUE INDEX `attendance_requests_code_key` ON `attendance_requests` (`code`);

CREATE INDEX `attendancerequest_employee_id` ON `attendance_requests` (`employee_id`);

CREATE INDEX `attendancerequest_request_type` ON `attendance_requests` (`request_type`);

CREATE INDEX `attendancerequest_start_date` ON `attendance_requests` (`start_date`);

CREATE INDEX `attendancerequest_status` ON `attendance_requests` (`status`);

CREATE INDEX `auditlog_action` ON `audit_logs` (`action`);

CREATE INDEX `auditlog_created_at` ON `audit_logs` (`created_at`);

CREATE INDEX `auditlog_entity_type_entity_id` ON `audit_logs` (`entity_type`, `entity_id`);

CREATE INDEX `auditlog_user_id` ON `audit_logs` (`user_id`);

CREATE UNIQUE INDEX `bank_accounts_account_no_key` ON `bank_accounts` (`account_no`);

CREATE INDEX `bankaccount_account_no` ON `bank_accounts` (`account_no`);

CREATE INDEX `bankaccount_is_active` ON `bank_accounts` (`is_active`);

CREATE INDEX `bankstatement_account_id` ON `bank_statements` (`account_id`);

CREATE INDEX `bankstatement_reconciled` ON `bank_statements` (`reconciled`);

CREATE INDEX `bankstatement_statement_date` ON `bank_statements` (`statement_date`);

CREATE UNIQUE INDEX `bo_ms_code_key` ON `bo_ms` (`code`);

CREATE INDEX `bom_code` ON `bo_ms` (`code`);

CREATE INDEX `bom_product_id` ON `bo_ms` (`product_id`);

CREATE INDEX `bomitem_bom_id` ON `bom_items` (`bom_id`);

CREATE INDEX `bomitem_product_id` ON `bom_items` (`product_id`);

CREATE UNIQUE INDEX `categories_code_key` ON `categories` (`code`);

CREATE INDEX `category_code` ON `categories` (`code`);

CREATE INDEX `category_entity_code_parent_id` ON `categories` (`entity_code`, `parent_id`);

CREATE UNIQUE INDEX `commission_settlements_settlement_no_key` ON `commission_settlements` (`settlement_no`);

CREATE INDEX `commissionsettlement_period` ON `commission_settlements` (`period`);

CREATE INDEX `commissionsettlement_salesperson_id` ON `commission_settlements` (`salesperson_id`);

CREATE INDEX `commissionsettlement_settlement_no` ON `commission_settlements` (`settlement_no`);

CREATE INDEX `commissionsettlement_status` ON `commission_settlements` (`status`);

CREATE UNIQUE INDEX `consignment_orders_consignment_no_key` ON `consignment_orders` (`consignment_no`);

CREATE INDEX `consignmentorder_consignment_no` ON `consignment_orders` (`consignment_no`);

CREATE INDEX `consignmentorder_party_id` ON `consignment_orders` (`party_id`);

CREATE INDEX `consignmentorder_status` ON `consignment_orders` (`status`);

CREATE INDEX `consignmentorderline_order_id` ON `consignment_order_lines` (`order_id`);

CREATE INDEX `consignmentorderline_product_id` ON `consignment_order_lines` (`product_id`);

CREATE INDEX `crmactivity_activity_at` ON `crm_activities` (`activity_at`);

CREATE INDEX `crmactivity_next_follow_at` ON `crm_activities` (`next_follow_at`);

CREATE INDEX `crmactivity_target_type_target_id` ON `crm_activities` (`target_type`, `target_id`);

CREATE UNIQUE INDEX `crmopportunity_code` ON `crm_opportunities` (`code`) WHERE deleted_at IS NULL;

CREATE INDEX `crmopportunity_customer_id` ON `crm_opportunities` (`customer_id`);

CREATE INDEX `crmopportunity_owner` ON `crm_opportunities` (`owner`);

CREATE INDEX `crmopportunity_stage` ON `crm_opportunities` (`stage`);

CREATE UNIQUE INDEX `currencies_code_key` ON `currencies` (`code`);

CREATE INDEX `currency_code` ON `currencies` (`code`);

CREATE INDEX `currency_is_base` ON `currencies` (`is_base`);

CREATE INDEX `customer_category_id` ON `customers` (`category_id`);

CREATE UNIQUE INDEX `customers_code_key` ON `customers` (`code`);

CREATE UNIQUE INDEX `customers_login_account_key` ON `customers` (`login_account`);

CREATE INDEX `datadict_type_code` ON `data_dicts` (`type_code`);

CREATE UNIQUE INDEX `datadict_type_code_item_code` ON `data_dicts` (`type_code`, `item_code`);

CREATE UNIQUE INDEX `department_code` ON `departments` (`code`);

CREATE INDEX `department_parent_id` ON `departments` (`parent_id`);

CREATE UNIQUE INDEX `departments_code_key` ON `departments` (`code`);

CREATE UNIQUE INDEX `depreciationentry_asset_id_period` ON `depreciation_entries` (`asset_id`, `period`);

CREATE UNIQUE INDEX `employee_code` ON `employees` (`code`);

CREATE INDEX `employee_department_id` ON `employees` (`department_id`);

CREATE INDEX `employee_name` ON `employees` (`name`);

CREATE INDEX `employee_status` ON `employees` (`status`);

CREATE INDEX `employeechange_change_type` ON `employee_changes` (`change_type`);

CREATE INDEX `employeechange_effective_date` ON `employee_changes` (`effective_date`);

CREATE INDEX `employeechange_employee_id` ON `employee_changes` (`employee_id`);

CREATE UNIQUE INDEX `employees_code_key` ON `employees` (`code`);

CREATE UNIQUE INDEX `entity_defs_code_key` ON `entity_defs` (`code`);

CREATE UNIQUE INDEX `entitydef_code` ON `entity_defs` (`code`);

CREATE INDEX `equipmentmaintenance_equipment_id` ON `equipment_maintenances` (`equipment_id`);

CREATE INDEX `equipmentmaintenance_plan_date` ON `equipment_maintenances` (`plan_date`);

CREATE INDEX `equipmentmaintenance_status` ON `equipment_maintenances` (`status`);

CREATE UNIQUE INDEX `expense_claims_claim_no_key` ON `expense_claims` (`claim_no`);

CREATE INDEX `expenseclaim_claim_no` ON `expense_claims` (`claim_no`);

CREATE INDEX `expenseclaim_employee_name` ON `expense_claims` (`employee_name`);

CREATE INDEX `expenseclaim_status` ON `expense_claims` (`status`);

CREATE UNIQUE INDEX `export_files_filename_key` ON `export_files` (`filename`);

CREATE INDEX `exportfile_expires_at` ON `export_files` (`expires_at`);

CREATE INDEX `exportfile_kind` ON `export_files` (`kind`);

CREATE UNIQUE INDEX `fielddef_entity_id_code` ON `field_defs` (`entity_id`, `code`);

CREATE UNIQUE INDEX `fixed_assets_asset_no_key` ON `fixed_assets` (`asset_no`);

CREATE INDEX `fixedasset_asset_no` ON `fixed_assets` (`asset_no`);

CREATE INDEX `fixedasset_category` ON `fixed_assets` (`category`);

CREATE INDEX `fixedasset_status` ON `fixed_assets` (`status`);

CREATE UNIQUE INDEX idx_inventory_balance_key
			ON inventory_balances (
				product_id, warehouse_id,
				COALESCE(location_id, '00000000-0000-0000-0000-000000000000'),
				COALESCE(rack_id, '00000000-0000-0000-0000-000000000000'),
				COALESCE(batch_no, '')
			);

CREATE INDEX `industrytemplate_category` ON `industry_templates` (`category`);

CREATE INDEX `industrytemplatefield_code` ON `industry_template_fields` (`code`);

CREATE INDEX `inventorybalance_product_id_batch_no` ON `inventory_balances` (`product_id`, `batch_no`);

CREATE UNIQUE INDEX `inventorybalance_product_id_war_0341b71f38c51f55e0726e3e5018f14a` ON `inventory_balances` (`product_id`, `warehouse_id`, `location_id`, `rack_id`, `batch_no`);

CREATE INDEX `inventorybalance_product_id_warehouse_id` ON `inventory_balances` (`product_id`, `warehouse_id`);

CREATE INDEX `inventorybalance_warehouse_id_location_id` ON `inventory_balances` (`warehouse_id`, `location_id`);

CREATE UNIQUE INDEX `inventorycheck_check_no` ON `inventory_checks` (`check_no`) WHERE deleted_at IS NULL;

CREATE INDEX `inventorycheck_status` ON `inventory_checks` (`status`);

CREATE INDEX `inventorycheck_warehouse_id` ON `inventory_checks` (`warehouse_id`);

CREATE INDEX `inventorycheckline_check_id` ON `inventory_check_lines` (`check_id`);

CREATE INDEX `inventorycheckline_product_id` ON `inventory_check_lines` (`product_id`);

CREATE INDEX `journalentry_entry_date` ON `journal_entries` (`entry_date`);

CREATE INDEX `journalentry_source_type_source_id` ON `journal_entries` (`source_type`, `source_id`);

CREATE UNIQUE INDEX `labor_contracts_code_key` ON `labor_contracts` (`code`);

CREATE UNIQUE INDEX `laborcontract_code` ON `labor_contracts` (`code`);

CREATE INDEX `laborcontract_employee_id` ON `labor_contracts` (`employee_id`);

CREATE INDEX `laborcontract_end_date` ON `labor_contracts` (`end_date`);

CREATE INDEX `laborcontract_status` ON `labor_contracts` (`status`);

CREATE INDEX `layoutdef_entity_id_layout_type_scope_scope_id` ON `layout_defs` (`entity_id`, `layout_type`, `scope`, `scope_id`);

CREATE INDEX `lead_lead_no` ON `leads` (`lead_no`);

CREATE INDEX `lead_owner` ON `leads` (`owner`);

CREATE INDEX `lead_status` ON `leads` (`status`);

CREATE UNIQUE INDEX `leads_lead_no_key` ON `leads` (`lead_no`);

CREATE UNIQUE INDEX `loan_orders_loan_no_key` ON `loan_orders` (`loan_no`);

CREATE INDEX `loanorder_loan_no` ON `loan_orders` (`loan_no`);

CREATE INDEX `loanorder_loan_type` ON `loan_orders` (`loan_type`);

CREATE INDEX `loanorder_status` ON `loan_orders` (`status`);

CREATE INDEX `loanorder_warehouse_id` ON `loan_orders` (`warehouse_id`);

CREATE INDEX `loanorderline_loan_order_id` ON `loan_order_lines` (`loan_order_id`);

CREATE INDEX `loanorderline_product_id` ON `loan_order_lines` (`product_id`);

CREATE INDEX `location_warehouse_id` ON `locations` (`warehouse_id`);

CREATE UNIQUE INDEX `locations_code_key` ON `locations` (`code`);

CREATE UNIQUE INDEX `material_requirements_mrp_no_key` ON `material_requirements` (`mrp_no`);

CREATE INDEX `materialrequirement_mrp_no` ON `material_requirements` (`mrp_no`);

CREATE INDEX `materialrequirement_plan_date` ON `material_requirements` (`plan_date`);

CREATE INDEX `materialrequirement_status` ON `material_requirements` (`status`);

CREATE INDEX `materialrequirementline_mrp_id` ON `material_requirement_lines` (`mrp_id`);

CREATE INDEX `materialrequirementline_product_id` ON `material_requirement_lines` (`product_id`);

CREATE INDEX `materialrequirementline_requirement_type` ON `material_requirement_lines` (`requirement_type`);

CREATE UNIQUE INDEX `mps_plans_code_key` ON `mps_plans` (`code`);

CREATE INDEX `mpsplan_period_start` ON `mps_plans` (`period_start`);

CREATE INDEX `mpsplanline_plan_id` ON `mps_plan_lines` (`plan_id`);

CREATE INDEX `mpsplanline_product_id` ON `mps_plan_lines` (`product_id`);

CREATE INDEX `notification_role_code_is_read` ON `notifications` (`role_code`, `is_read`);

CREATE INDEX `notification_user_id_is_read` ON `notifications` (`user_id`, `is_read`);

CREATE UNIQUE INDEX `number_counters_prefix_key` ON `number_counters` (`prefix`);

CREATE INDEX `orderchangelog_created_at` ON `order_change_logs` (`created_at`);

CREATE INDEX `orderchangelog_order_type_order_id` ON `order_change_logs` (`order_type`, `order_id`);

CREATE UNIQUE INDEX `payment_payments_payment_no_key` ON `payment_payments` (`payment_no`);

CREATE UNIQUE INDEX `payment_plans_plan_no_key` ON `payment_plans` (`plan_no`);

CREATE UNIQUE INDEX `payment_receipts_receipt_no_key` ON `payment_receipts` (`receipt_no`);

CREATE INDEX `paymentpayment_payment_no` ON `payment_payments` (`payment_no`);

CREATE INDEX `paymentpayment_status` ON `payment_payments` (`status`);

CREATE INDEX `paymentpayment_supplier_id` ON `payment_payments` (`supplier_id`);

CREATE INDEX `paymentplan_plan_no` ON `payment_plans` (`plan_no`);

CREATE INDEX `paymentplan_plan_type_party_id` ON `payment_plans` (`plan_type`, `party_id`);

CREATE INDEX `paymentplan_source_type_source_id` ON `payment_plans` (`source_type`, `source_id`);

CREATE INDEX `paymentplan_status` ON `payment_plans` (`status`);

CREATE INDEX `paymentplanitem_due_date` ON `payment_plan_items` (`due_date`);

CREATE INDEX `paymentplanitem_status` ON `payment_plan_items` (`status`);

CREATE INDEX `paymentreceipt_customer_id` ON `payment_receipts` (`customer_id`);

CREATE INDEX `paymentreceipt_receipt_no` ON `payment_receipts` (`receipt_no`);

CREATE INDEX `paymentreceipt_status` ON `payment_receipts` (`status`);

CREATE UNIQUE INDEX `payroll_batches_batch_no_key` ON `payroll_batches` (`batch_no`);

CREATE INDEX `payrollbatch_batch_no` ON `payroll_batches` (`batch_no`);

CREATE INDEX `payrollbatch_period` ON `payroll_batches` (`period`);

CREATE INDEX `payrollbatch_status` ON `payroll_batches` (`status`);

CREATE INDEX `payrollitem_batch_id` ON `payroll_items` (`batch_id`);

CREATE UNIQUE INDEX `perf_assessments_code_key` ON `perf_assessments` (`code`);

CREATE INDEX `perfassessment_employee_id` ON `perf_assessments` (`employee_id`);

CREATE INDEX `perfassessment_period` ON `perf_assessments` (`period`);

CREATE INDEX `perfassessment_status` ON `perf_assessments` (`status`);

CREATE INDEX `perfassessmentitem_assessment_id` ON `perf_assessment_items` (`assessment_id`);

CREATE UNIQUE INDEX `piecework_records_code_key` ON `piecework_records` (`code`);

CREATE INDEX `pieceworkrecord_employee_id` ON `piecework_records` (`employee_id`);

CREATE INDEX `pieceworkrecord_work_date` ON `piecework_records` (`work_date`);

CREATE INDEX `pieceworkrecord_work_order_process_id` ON `piecework_records` (`work_order_process_id`);

CREATE INDEX `pricelist_list_type_entity_id` ON `price_lists` (`list_type`, `entity_id`);

CREATE INDEX `pricelist_name` ON `price_lists` (`name`);

CREATE INDEX `pricelist_status` ON `price_lists` (`status`);

CREATE INDEX `pricelistline_price_list_id` ON `price_list_lines` (`price_list_id`);

CREATE INDEX `pricelistline_product_id` ON `price_list_lines` (`product_id`);

CREATE INDEX `printtemplate_doc_type` ON `print_templates` (`doc_type`);

CREATE INDEX `product_barcode` ON `products` (`barcode`);

CREATE INDEX `product_category_id` ON `products` (`category_id`);

CREATE INDEX `product_product_type` ON `products` (`product_type`);

CREATE INDEX `product_spu_id` ON `products` (`spu_id`);

CREATE UNIQUE INDEX `product_spus_code_key` ON `product_spus` (`code`);

CREATE INDEX `productcomboitem_component_id` ON `product_combo_items` (`component_id`);

CREATE INDEX `productcomboitem_product_id` ON `product_combo_items` (`product_id`);

CREATE UNIQUE INDEX `productdocument_doc_no` ON `product_documents` (`doc_no`) WHERE deleted_at IS NULL;

CREATE INDEX `productdocument_doc_type` ON `product_documents` (`doc_type`);

CREATE INDEX `productdocument_product_id` ON `product_documents` (`product_id`);

CREATE INDEX `productdocument_status` ON `product_documents` (`status`);

CREATE UNIQUE INDEX `productionequipment_equipment_no` ON `production_equipments` (`equipment_no`) WHERE deleted_at IS NULL;

CREATE INDEX `productionequipment_status` ON `production_equipments` (`status`);

CREATE INDEX `productionequipment_work_center_id` ON `production_equipments` (`work_center_id`);

CREATE UNIQUE INDEX `productionpicking_picking_no` ON `production_pickings` (`picking_no`) WHERE deleted_at IS NULL;

CREATE INDEX `productionpicking_status` ON `production_pickings` (`status`);

CREATE INDEX `productionpicking_work_order_id` ON `production_pickings` (`work_order_id`);

CREATE INDEX `productionpickingline_picking_id` ON `production_picking_lines` (`picking_id`);

CREATE INDEX `productionpickingline_product_id` ON `production_picking_lines` (`product_id`);

CREATE UNIQUE INDEX `productionreceipt_receipt_no` ON `production_receipts` (`receipt_no`) WHERE deleted_at IS NULL;

CREATE INDEX `productionreceipt_status` ON `production_receipts` (`status`);

CREATE INDEX `productionreceipt_work_order_id` ON `production_receipts` (`work_order_id`);

CREATE INDEX `productionreceiptline_product_id` ON `production_receipt_lines` (`product_id`);

CREATE INDEX `productionreceiptline_receipt_id` ON `production_receipt_lines` (`receipt_id`);

CREATE UNIQUE INDEX `productionreturn_return_no` ON `production_returns` (`return_no`) WHERE deleted_at IS NULL;

CREATE INDEX `productionreturn_status` ON `production_returns` (`status`);

CREATE INDEX `productionreturn_work_order_id` ON `production_returns` (`work_order_id`);

CREATE INDEX `productionreturnline_product_id` ON `production_return_lines` (`product_id`);

CREATE INDEX `productionreturnline_return_id` ON `production_return_lines` (`return_id`);

CREATE UNIQUE INDEX `productionteam_code` ON `production_teams` (`code`) WHERE deleted_at IS NULL;

CREATE INDEX `productionteam_is_active` ON `production_teams` (`is_active`);

CREATE INDEX `productionteammember_team_id` ON `production_team_members` (`team_id`);

CREATE UNIQUE INDEX `products_code_key` ON `products` (`code`);

CREATE INDEX `productspu_category_id` ON `product_spus` (`category_id`);

CREATE UNIQUE INDEX `purchase_contracts_contract_no_key` ON `purchase_contracts` (`contract_no`);

CREATE UNIQUE INDEX `purchase_requisitions_requisition_no_key` ON `purchase_requisitions` (`requisition_no`);

CREATE UNIQUE INDEX `purchase_rf_qs_rfq_no_key` ON `purchase_rf_qs` (`rfq_no`);

CREATE UNIQUE INDEX `purchase_suggestions_suggestion_no_key` ON `purchase_suggestions` (`suggestion_no`);

CREATE INDEX `purchasecontract_contract_no` ON `purchase_contracts` (`contract_no`);

CREATE INDEX `purchasecontract_status` ON `purchase_contracts` (`status`);

CREATE INDEX `purchasecontract_supplier_id` ON `purchase_contracts` (`supplier_id`);

CREATE INDEX `purchaseorder_order_date` ON `purchase_orders` (`order_date`);

CREATE UNIQUE INDEX `purchaseorder_order_no` ON `purchase_orders` (`order_no`) WHERE deleted_at IS NULL;

CREATE INDEX `purchaseorder_status` ON `purchase_orders` (`status`);

CREATE INDEX `purchaseorder_supplier_id` ON `purchase_orders` (`supplier_id`);

CREATE INDEX `purchaseorderline_order_id` ON `purchase_order_lines` (`order_id`);

CREATE INDEX `purchaseorderline_product_id` ON `purchase_order_lines` (`product_id`);

CREATE UNIQUE INDEX `purchasereconciliation_code` ON `purchase_reconciliations` (`code`) WHERE deleted_at IS NULL;

CREATE INDEX `purchasereconciliation_period_end` ON `purchase_reconciliations` (`period_end`);

CREATE INDEX `purchasereconciliation_status` ON `purchase_reconciliations` (`status`);

CREATE UNIQUE INDEX `purchasereconciliation_supplier_id_period_start_period_end` ON `purchase_reconciliations` (`supplier_id`, `period_start`, `period_end`) WHERE deleted_at IS NULL;

CREATE INDEX `purchasereconciliationline_reconciliation_id` ON `purchase_reconciliation_lines` (`reconciliation_id`);

CREATE INDEX `purchaserequisition_department` ON `purchase_requisitions` (`department`);

CREATE INDEX `purchaserequisition_requisition_no` ON `purchase_requisitions` (`requisition_no`);

CREATE INDEX `purchaserequisition_status` ON `purchase_requisitions` (`status`);

CREATE INDEX `purchaserequisitionline_product_id` ON `purchase_requisition_lines` (`product_id`);

CREATE INDEX `purchaserequisitionline_requisition_id` ON `purchase_requisition_lines` (`requisition_id`);

CREATE UNIQUE INDEX `purchasereturn_order_no` ON `purchase_returns` (`order_no`) WHERE deleted_at IS NULL;

CREATE INDEX `purchasereturn_purchase_order_id` ON `purchase_returns` (`purchase_order_id`);

CREATE INDEX `purchasereturn_status` ON `purchase_returns` (`status`);

CREATE INDEX `purchasereturn_supplier_id` ON `purchase_returns` (`supplier_id`);

CREATE INDEX `purchasereturnline_order_id` ON `purchase_return_lines` (`order_id`);

CREATE INDEX `purchasereturnline_product_id` ON `purchase_return_lines` (`product_id`);

CREATE INDEX `purchaserfq_rfq_no` ON `purchase_rf_qs` (`rfq_no`);

CREATE INDEX `purchaserfq_status` ON `purchase_rf_qs` (`status`);

CREATE INDEX `purchaserfq_supplier_id` ON `purchase_rf_qs` (`supplier_id`);

CREATE INDEX `purchaserfqline_product_id` ON `purchase_rfq_lines` (`product_id`);

CREATE INDEX `purchaserfqline_rfq_id` ON `purchase_rfq_lines` (`rfq_id`);

CREATE INDEX `purchaserfqquote_rfq_id` ON `purchase_rfq_quotes` (`rfq_id`);

CREATE INDEX `purchaserfqquote_supplier_id` ON `purchase_rfq_quotes` (`supplier_id`);

CREATE INDEX `purchaserfqquoteline_product_id` ON `purchase_rfq_quote_lines` (`product_id`);

CREATE INDEX `purchaserfqquoteline_quote_id` ON `purchase_rfq_quote_lines` (`quote_id`);

CREATE INDEX `purchasesuggestion_status` ON `purchase_suggestions` (`status`);

CREATE INDEX `purchasesuggestion_suggestion_no` ON `purchase_suggestions` (`suggestion_no`);

CREATE INDEX `purchasesuggestionline_product_id` ON `purchase_suggestion_lines` (`product_id`);

CREATE INDEX `purchasesuggestionline_status` ON `purchase_suggestion_lines` (`status`);

CREATE INDEX `purchasesuggestionline_suggestion_id` ON `purchase_suggestion_lines` (`suggestion_id`);

CREATE INDEX `rack_location_id` ON `racks` (`location_id`);

CREATE UNIQUE INDEX `racks_code_key` ON `racks` (`code`);

CREATE UNIQUE INDEX `recruitment_candidates_code_key` ON `recruitment_candidates` (`code`);

CREATE UNIQUE INDEX `recruitment_positions_code_key` ON `recruitment_positions` (`code`);

CREATE INDEX `recruitmentcandidate_position_id` ON `recruitment_candidates` (`position_id`);

CREATE INDEX `recruitmentcandidate_status` ON `recruitment_candidates` (`status`);

CREATE INDEX `recruitmentinterview_candidate_id` ON `recruitment_interviews` (`candidate_id`);

CREATE INDEX `recruitmentposition_status` ON `recruitment_positions` (`status`);

CREATE INDEX `refreshtoken_expires_at` ON `refresh_tokens` (`expires_at`);

CREATE INDEX `refreshtoken_user_id` ON `refresh_tokens` (`user_id`);

CREATE UNIQUE INDEX `report_definitions_report_code_key` ON `report_definitions` (`report_code`);

CREATE INDEX `reportdefinition_category` ON `report_definitions` (`category`);

CREATE INDEX `reportdefinition_report_code` ON `report_definitions` (`report_code`);

CREATE INDEX `reportdefinition_status` ON `report_definitions` (`status`);

CREATE UNIQUE INDEX `rework_orders_code_key` ON `rework_orders` (`code`);

CREATE INDEX `reworkorder_process_id` ON `rework_orders` (`process_id`);

CREATE INDEX `reworkorder_work_order_id` ON `rework_orders` (`work_order_id`);

CREATE INDEX `routing_code` ON `routings` (`code`);

CREATE INDEX `routing_product_id` ON `routings` (`product_id`);

CREATE UNIQUE INDEX `routings_code_key` ON `routings` (`code`);

CREATE INDEX `routingstep_routing_id` ON `routing_steps` (`routing_id`);

CREATE INDEX `routingstep_sequence` ON `routing_steps` (`sequence`);

CREATE UNIQUE INDEX `sales_contracts_contract_no_key` ON `sales_contracts` (`contract_no`);

CREATE UNIQUE INDEX `sales_quotations_quotation_no_key` ON `sales_quotations` (`quotation_no`);

CREATE INDEX `salescommissionconfig_salesperson_id` ON `sales_commission_configs` (`salesperson_id`);

CREATE INDEX `salescommissionconfig_status` ON `sales_commission_configs` (`status`);

CREATE INDEX `salescontract_contract_no` ON `sales_contracts` (`contract_no`);

CREATE INDEX `salescontract_customer_id` ON `sales_contracts` (`customer_id`);

CREATE INDEX `salescontract_status` ON `sales_contracts` (`status`);

CREATE INDEX `salesorder_customer_id` ON `sales_orders` (`customer_id`);

CREATE INDEX `salesorder_order_date` ON `sales_orders` (`order_date`);

CREATE UNIQUE INDEX `salesorder_order_no` ON `sales_orders` (`order_no`) WHERE deleted_at IS NULL;

CREATE INDEX `salesorder_sales_contract_id` ON `sales_orders` (`sales_contract_id`);

CREATE INDEX `salesorder_status` ON `sales_orders` (`status`);

CREATE INDEX `salesorderline_order_id` ON `sales_order_lines` (`order_id`);

CREATE INDEX `salesorderline_product_id` ON `sales_order_lines` (`product_id`);

CREATE INDEX `salesquotation_customer_id` ON `sales_quotations` (`customer_id`);

CREATE INDEX `salesquotation_quotation_no` ON `sales_quotations` (`quotation_no`);

CREATE INDEX `salesquotation_status` ON `sales_quotations` (`status`);

CREATE INDEX `salesquotationline_product_id` ON `sales_quotation_lines` (`product_id`);

CREATE INDEX `salesquotationline_quotation_id` ON `sales_quotation_lines` (`quotation_id`);

CREATE INDEX `salesreturn_customer_id` ON `sales_returns` (`customer_id`);

CREATE UNIQUE INDEX `salesreturn_order_no` ON `sales_returns` (`order_no`) WHERE deleted_at IS NULL;

CREATE INDEX `salesreturn_sales_order_id` ON `sales_returns` (`sales_order_id`);

CREATE INDEX `salesreturn_status` ON `sales_returns` (`status`);

CREATE INDEX `salesreturnline_order_id` ON `sales_return_lines` (`order_id`);

CREATE INDEX `salesreturnline_product_id` ON `sales_return_lines` (`product_id`);

CREATE INDEX `serialnumber_product_id` ON `serial_numbers` (`product_id`);

CREATE UNIQUE INDEX `serialnumber_serial_no` ON `serial_numbers` (`serial_no`);

CREATE INDEX `serialnumber_status` ON `serial_numbers` (`status`);

CREATE INDEX `serialnumber_warehouse_id` ON `serial_numbers` (`warehouse_id`);

CREATE INDEX `shareholder_holder_type` ON `shareholders` (`holder_type`);

CREATE INDEX `shareholder_name` ON `shareholders` (`name`);

CREATE UNIQUE INDEX `stockadjust_adjust_no` ON `stock_adjusts` (`adjust_no`) WHERE deleted_at IS NULL;

CREATE INDEX `stockadjust_status` ON `stock_adjusts` (`status`);

CREATE INDEX `stockadjust_warehouse_id` ON `stock_adjusts` (`warehouse_id`);

CREATE INDEX `stockadjustline_adjust_id` ON `stock_adjust_lines` (`adjust_id`);

CREATE INDEX `stockadjustline_product_id` ON `stock_adjust_lines` (`product_id`);

CREATE INDEX `stockin_status` ON `stock_ins` (`status`);

CREATE UNIQUE INDEX `stockin_stock_in_no` ON `stock_ins` (`stock_in_no`) WHERE deleted_at IS NULL;

CREATE INDEX `stockin_type` ON `stock_ins` (`type`);

CREATE INDEX `stockin_warehouse_id` ON `stock_ins` (`warehouse_id`);

CREATE INDEX `stockinline_product_id` ON `stock_in_lines` (`product_id`);

CREATE INDEX `stockinline_stock_in_id` ON `stock_in_lines` (`stock_in_id`);

CREATE INDEX `stockinphoto_stock_in_id` ON `stock_in_photos` (`stock_in_id`);

CREATE INDEX `stockmovement_batch_no` ON `stock_movements` (`batch_no`);

CREATE INDEX `stockmovement_created_at` ON `stock_movements` (`created_at`);

CREATE INDEX `stockmovement_product_id_warehouse_id` ON `stock_movements` (`product_id`, `warehouse_id`);

CREATE INDEX `stockmovement_source_type_source_id` ON `stock_movements` (`source_type`, `source_id`);

CREATE INDEX `stockout_status` ON `stock_outs` (`status`);

CREATE UNIQUE INDEX `stockout_stock_out_no` ON `stock_outs` (`stock_out_no`) WHERE deleted_at IS NULL;

CREATE INDEX `stockout_type` ON `stock_outs` (`type`);

CREATE INDEX `stockout_warehouse_id` ON `stock_outs` (`warehouse_id`);

CREATE INDEX `stockoutline_product_id` ON `stock_out_lines` (`product_id`);

CREATE INDEX `stockoutline_stock_out_id` ON `stock_out_lines` (`stock_out_id`);

CREATE INDEX `stocktransfer_from_warehouse_id` ON `stock_transfers` (`from_warehouse_id`);

CREATE INDEX `stocktransfer_status` ON `stock_transfers` (`status`);

CREATE INDEX `stocktransfer_to_warehouse_id` ON `stock_transfers` (`to_warehouse_id`);

CREATE UNIQUE INDEX `stocktransfer_transfer_no` ON `stock_transfers` (`transfer_no`) WHERE deleted_at IS NULL;

CREATE INDEX `stocktransferline_product_id` ON `stock_transfer_lines` (`product_id`);

CREATE INDEX `stocktransferline_transfer_id` ON `stock_transfer_lines` (`transfer_id`);

CREATE UNIQUE INDEX `subcontract_orders_code_key` ON `subcontract_orders` (`code`);

CREATE INDEX `subcontractorder_mode` ON `subcontract_orders` (`mode`);

CREATE INDEX `subcontractorder_product_id` ON `subcontract_orders` (`product_id`);

CREATE INDEX `subcontractorder_supplier_id` ON `subcontract_orders` (`supplier_id`);

CREATE INDEX `subcontractorder_work_order_id` ON `subcontract_orders` (`work_order_id`);

CREATE INDEX `subcontractordermaterialline_product_id` ON `subcontract_order_material_lines` (`product_id`);

CREATE INDEX `subcontractordermaterialline_subcontract_order_id` ON `subcontract_order_material_lines` (`subcontract_order_id`);

CREATE INDEX `subcontractreceivelog_subcontract_order_id` ON `subcontract_receive_logs` (`subcontract_order_id`);

CREATE INDEX `supplier_category_id` ON `suppliers` (`category_id`);

CREATE UNIQUE INDEX `suppliers_code_key` ON `suppliers` (`code`);

CREATE UNIQUE INDEX `sys_permissions_code_key` ON `sys_permissions` (`code`);

CREATE UNIQUE INDEX `sys_roles_code_key` ON `sys_roles` (`code`);

CREATE UNIQUE INDEX `sys_users_username_key` ON `sys_users` (`username`);

CREATE UNIQUE INDEX `sysfieldpermission_role_id_entity_id_field_code` ON `sys_field_permissions` (`role_id`, `entity_id`, `field_code`);

CREATE UNIQUE INDEX `syspermission_code` ON `sys_permissions` (`code`);

CREATE INDEX `syspermission_parent_id` ON `sys_permissions` (`parent_id`);

CREATE UNIQUE INDEX `sysrole_code` ON `sys_roles` (`code`);

CREATE UNIQUE INDEX `sysrolepermission_role_id_permission_id` ON `sys_role_permissions` (`role_id`, `permission_id`);

CREATE UNIQUE INDEX `system_settings_key_key` ON `system_settings` (`key`);

CREATE UNIQUE INDEX `systemsetting_key` ON `system_settings` (`key`);

CREATE UNIQUE INDEX `sysuser_username` ON `sys_users` (`username`);

CREATE UNIQUE INDEX `sysuserrole_user_id_role_id` ON `sys_user_roles` (`user_id`, `role_id`);

CREATE UNIQUE INDEX `tax_accruals_code_key` ON `tax_accruals` (`code`);

CREATE INDEX `taxaccrual_code` ON `tax_accruals` (`code`);

CREATE INDEX `taxaccrual_period` ON `tax_accruals` (`period`);

CREATE INDEX `taxaccrual_tax_type` ON `tax_accruals` (`tax_type`);

CREATE INDEX `tooling_applicable_product_id` ON `toolings` (`applicable_product_id`);

CREATE INDEX `tooling_status` ON `toolings` (`status`);

CREATE UNIQUE INDEX `tooling_tooling_no` ON `toolings` (`tooling_no`) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX `training_records_code_key` ON `training_records` (`code`);

CREATE INDEX `trainingparticipant_employee_id` ON `training_participants` (`employee_id`);

CREATE INDEX `trainingparticipant_training_id` ON `training_participants` (`training_id`);

CREATE INDEX `trainingrecord_status` ON `training_records` (`status`);

CREATE INDEX `trainingrecord_training_date` ON `training_records` (`training_date`);

CREATE INDEX `unit_code` ON `units` (`code`);

CREATE INDEX `unitconversion_product_id` ON `unit_conversions` (`product_id`);

CREATE UNIQUE INDEX `unitconversion_product_id_unit_id` ON `unit_conversions` (`product_id`, `unit_id`);

CREATE UNIQUE INDEX `units_code_key` ON `units` (`code`);

CREATE INDEX `voucher_source_type_source_id` ON `vouchers` (`source_type`, `source_id`);

CREATE INDEX `voucher_status` ON `vouchers` (`status`);

CREATE UNIQUE INDEX `voucher_templates_code_key` ON `voucher_templates` (`code`);

CREATE INDEX `voucher_voucher_no` ON `vouchers` (`voucher_no`);

CREATE INDEX `voucherentry_direction` ON `voucher_entries` (`direction`);

CREATE UNIQUE INDEX `vouchers_voucher_no_key` ON `vouchers` (`voucher_no`);

CREATE INDEX `vouchertemplate_code` ON `voucher_templates` (`code`);

CREATE INDEX `vouchertemplate_source_type` ON `voucher_templates` (`source_type`);

CREATE INDEX `warehouse_code` ON `warehouses` (`code`);

CREATE UNIQUE INDEX `warehouses_code_key` ON `warehouses` (`code`);

CREATE UNIQUE INDEX `work_centers_code_key` ON `work_centers` (`code`);

CREATE INDEX `workcenter_code` ON `work_centers` (`code`);

CREATE INDEX `workcenter_status` ON `work_centers` (`status`);

CREATE UNIQUE INDEX `workorder_order_no` ON `work_orders` (`order_no`) WHERE deleted_at IS NULL;

CREATE INDEX `workorder_planned_start_date` ON `work_orders` (`planned_start_date`);

CREATE INDEX `workorder_product_id` ON `work_orders` (`product_id`);

CREATE INDEX `workorder_status` ON `work_orders` (`status`);

CREATE INDEX `workordermaterial_product_id` ON `work_order_materials` (`product_id`);

CREATE INDEX `workordermaterial_work_order_id` ON `work_order_materials` (`work_order_id`);

CREATE INDEX `workorderprocess_sequence` ON `work_order_processes` (`sequence`);

CREATE INDEX `workorderprocess_status` ON `work_order_processes` (`status`);

CREATE INDEX `workorderprocess_work_order_id` ON `work_order_processes` (`work_order_id`);
