package business

import (
	"context"
	"database/sql"
	"errors"
	"la-erp-recovered/backend/internal/database"
)

func (s *Service) GetAccount(ctx context.Context, id string) (map[string]any, error) {
	row, err := s.Store.Get(ctx, "accounts", id)
	if err != nil {
		return nil, err
	}
	out := s.Store.Public("accounts", row)
	edges := out["edges"].(map[string]any)
	if parent := value(row, "parent_id"); parent != "" {
		if p, err := s.Store.Get(ctx, "accounts", parent); err == nil {
			edges["parent"] = s.Store.Public("accounts", p)
		}
	}
	children, err := s.Store.Rows(ctx, "SELECT * FROM accounts WHERE parent_id=? AND deleted_at IS NULL ORDER BY code", id)
	if err != nil {
		return nil, err
	}
	if len(children) > 0 {
		items := []map[string]any{}
		for _, child := range children {
			items = append(items, s.Store.Public("accounts", child))
		}
		edges["children"] = items
	}
	return out, nil
}
func (s *Service) CreateAccount(ctx context.Context, input map[string]any) (map[string]any, error) {
	id := ""
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		var count int
		if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM accounts WHERE code=?", value(input, "code")).Scan(&count); err != nil {
			return err
		}
		if count > 0 {
			return errors.New("科目编码已存在")
		}
		parent := value(input, "parent_id")
		if parent != "" && parent != database.ZeroUUID {
			if _, err := s.Store.GetWith(ctx, tx, "accounts", parent); err != nil {
				return errors.New("父级科目不存在")
			}
		}
		row := s.base("accounts")
		for _, field := range []string{"code", "name", "category", "sub_category", "currency", "remark"} {
			row[field] = value(input, field)
		}
		for _, field := range []string{"is_leaf", "is_enabled"} {
			row[field] = false
			if b, ok := input[field].(bool); ok {
				row[field] = b
			}
		}
		if parent != "" && parent != database.ZeroUUID {
			row["parent_id"] = parent
		}
		id = value(row, "id")
		return s.Store.InsertWith(ctx, tx, "accounts", row)
	})
	if err != nil {
		return nil, err
	}
	return s.GetAccount(ctx, id)
}
func (s *Service) UpdateAccount(ctx context.Context, id string, input map[string]any) error {
	return s.transaction(ctx, func(tx *sql.Tx) error {
		if _, err := s.Store.GetWith(ctx, tx, "accounts", id); err != nil {
			return err
		}
		changes := map[string]any{"updated_at": now()}
		for _, field := range []string{"name", "category", "sub_category", "currency", "remark", "is_leaf", "is_enabled"} {
			if v, ok := input[field]; ok && v != nil {
				changes[field] = v
			}
		}
		// Original PUT ignores code and parent_id, including explicit null.
		return s.Store.UpdateWith(ctx, tx, "accounts", id, changes)
	})
}
func (s *Service) DeleteAccount(ctx context.Context, id string) error {
	return s.transaction(ctx, func(tx *sql.Tx) error {
		var count int
		if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM accounts WHERE parent_id=? AND deleted_at IS NULL", id).Scan(&count); err != nil {
			return err
		}
		if count > 0 {
			return errors.New("存在子科目，无法删除")
		}
		rows, err := database.QueryRows(ctx, tx, "SELECT * FROM accounts WHERE id=?", id)
		if err != nil {
			return err
		}
		// 回放 OO（2026-10-15）：原版删除**从未存在**的科目返回裸 400 + 通用文案，
		// 恢复端原来 return nil（→ 200/code0）。
		// 注意这里不能改成「不存在就报错」的通用写法：已软删的科目重复删除在原版是
		// 200/code0（evidence/backend-runtime/account-flow-contracts.json case 31），
		// 而上面的 SELECT **不过滤 deleted_at**，所以软删记录仍会走到下面继续处理。
		// 只有「查无此行」才是真的从未存在。
		if len(rows) == 0 {
			return ErrOriginalNoMessage{Status: 400, Note: "系统内部错误，请稍后重试或联系管理员"}
		}
		// Preserve account UUIDs and all posting references. The original releases
		// the unique code by appending ~del~ plus the first eight UUID characters;
		// repeating deletion appends the suffix again, even on an already deleted row.
		prefix := id
		if len(prefix) > 8 {
			prefix = prefix[:8]
		}
		_, err = tx.ExecContext(ctx, "UPDATE accounts SET deleted_at=?,updated_at=?,code=? WHERE id=?", now(), now(), value(rows[0], "code")+"~del~"+prefix, id)
		return err
	})
}
func (s *Service) AccountTree(ctx context.Context) (any, error) {
	rows, err := s.Store.Rows(ctx, "SELECT * FROM accounts WHERE deleted_at IS NULL AND is_enabled=1 ORDER BY code")
	if err != nil {
		return nil, err
	}
	byParent := map[string][]map[string]any{}
	for _, row := range rows {
		parent := value(row, "parent_id")
		if parent == database.ZeroUUID {
			parent = ""
		}
		byParent[parent] = append(byParent[parent], row)
	}
	var build func(string, map[string]bool) ([]map[string]any, error)
	build = func(parent string, path map[string]bool) ([]map[string]any, error) {
		out := []map[string]any{}
		for _, row := range byParent[parent] {
			id := value(row, "id")
			if path[id] {
				// 批次 CC 取证（2026-10-14，evidence/backend-runtime/audit-batch-cc-20261014.json）：
				// 环确实可以形成，但**形成后无法解开** —— 原版 PUT 传 parent_id 返回 code:0，
				// 回读却是**原值不变**（parent_id 不在可改字段白名单内；name 等字段可正常改）。
				// 恢复端行为**与原版一致**（实测 PUT parent_id 回读同样不变）。
				// 此时 GET /accounts/tree 原版返回 code:0（未死循环），
				// 本守卫则返回 ErrUnsupported —— 差异仅在「有环时的树端点行为」，
				// 原版该场景的**具体输出结构未取证**，无文案可对齐，不自造。
				// 保留 ErrUnsupported 作兜底（它同时防止恢复端自身的递归死循环）。
				return nil, ErrUnsupported
			}
			path[id] = true
			item := s.Store.Public("accounts", row)
			children, err := build(id, path)
			delete(path, id)
			if err != nil {
				return nil, err
			}
			if len(children) > 0 {
				item["edges"].(map[string]any)["children"] = children
			}
			out = append(out, item)
		}
		return out, nil
	}
	return build("", map[string]bool{})
}
