package business

import (
	"context"
	"database/sql"
	"errors"
)

func (s *Service) CreateApprovalFlow(ctx context.Context, input map[string]any) (map[string]any, error) {
	raw, _ := input["steps"].([]any)
	var id string
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		h := s.base("approval_flows")
		for _, k := range []string{"code", "name", "biz_type", "remark"} {
			if input[k] != nil {
				h[k] = input[k]
			}
		}
		h["is_active"] = true
		if err := s.Store.InsertWith(ctx, tx, "approval_flows", h); err != nil {
			return err
		}
		id = value(h, "id")
		for i, item := range raw {
			m, ok := item.(map[string]any)
			if !ok {
				return errors.New("审批步骤格式错误")
			}
			step := s.base("approval_steps")
			step["approval_flow_steps"], step["step_no"] = id, i+1
			for _, k := range []string{"name", "approver_type", "approver_id", "approver_name", "action_type", "timeout_hours", "is_optional", "condition", "remark"} {
				if m[k] != nil {
					step[k] = m[k]
				}
			}
			if err := s.Store.InsertWith(ctx, tx, "approval_steps", step); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.GetApprovalFlow(ctx, id)
}

func (s *Service) GetApprovalFlow(ctx context.Context, id string) (map[string]any, error) {
	h, err := s.Store.Get(ctx, "approval_flows", id)
	if err != nil {
		return nil, err
	}
	out := s.Store.Public("approval_flows", h)
	rows, err := s.Store.Rows(ctx, "SELECT * FROM approval_steps WHERE approval_flow_steps=? ORDER BY step_no", id)
	if err != nil {
		return nil, err
	}
	edges := map[string]any{}
	steps := []any{}
	for _, r := range rows {
		steps = append(steps, s.Store.Public("approval_steps", r))
	}
	if len(steps) > 0 {
		edges["steps"] = steps
	}
	out["edges"] = edges
	return out, nil
}

func (s *Service) UpdateApprovalFlow(ctx context.Context, id string, input map[string]any) (map[string]any, error) {
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		if _, err := s.Store.GetWith(ctx, tx, "approval_flows", id); err != nil {
			return err
		}
		changes := map[string]any{"updated_at": now()}
		for _, k := range []string{"code", "name", "biz_type", "remark"} {
			if input[k] != nil {
				changes[k] = input[k]
			}
		}
		if err := s.Store.UpdateWith(ctx, tx, "approval_flows", id, changes); err != nil {
			return err
		}
		if raw, ok := input["steps"].([]any); ok {
			if _, err := tx.ExecContext(ctx, "DELETE FROM approval_steps WHERE approval_flow_steps=?", id); err != nil {
				return err
			}
			for i, item := range raw {
				m, ok := item.(map[string]any)
				if !ok {
					return errors.New("审批步骤格式错误")
				}
				step := s.base("approval_steps")
				step["approval_flow_steps"], step["step_no"] = id, i+1
				for _, k := range []string{"name", "approver_type", "approver_id", "approver_name", "action_type", "timeout_hours", "is_optional", "condition", "remark"} {
					if m[k] != nil {
						step[k] = m[k]
					}
				}
				if err := s.Store.InsertWith(ctx, tx, "approval_steps", step); err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.GetApprovalFlow(ctx, id)
}

func (s *Service) DeleteApprovalFlow(ctx context.Context, id string) error {
	return s.transaction(ctx, func(tx *sql.Tx) error {
		if _, err := s.Store.GetWith(ctx, tx, "approval_flows", id); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "DELETE FROM approval_steps WHERE approval_flow_steps=?", id); err != nil {
			return err
		}
		return s.Store.UpdateWith(ctx, tx, "approval_flows", id, map[string]any{"deleted_at": now(), "updated_at": now()})
	})
}
