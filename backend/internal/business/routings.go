package business

import (
	"context"
	"database/sql"
	"errors"
)

func (s *Service) WriteWorkCenter(ctx context.Context, id string, input map[string]any) (map[string]any, error) {
	creating := id == ""
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		var h map[string]any
		var err error
		if creating {
			if value(input, "code") == "" || value(input, "name") == "" {
				return errors.New("工作中心编码和名称不能为空")
			}
			h = s.base("work_centers")
			h["efficiency"], h["status"] = 1, "active"
			h["code"] = input["code"]
			id = value(h, "id")
		} else {
			h, err = s.Store.GetWith(ctx, tx, "work_centers", id)
			if err != nil {
				return err
			}
			if value(input, "code") != "" && value(input, "code") != value(h, "code") {
				return ErrUnsupported
			}
			h["updated_at"] = now()
		}
		for _, k := range []string{"name", "manager", "remark", "status"} {
			if input[k] != nil {
				h[k] = input[k]
			}
		}
		for _, k := range []string{"capacity", "cost_rate", "efficiency"} {
			if input[k] != nil {
				n, err := Number(input[k])
				if err != nil {
					return err
				}
				if n.IsNegative() {
					return errors.New("能力、效率和成本费率不能为负")
				}
				if k == "efficiency" {
					h[k] = n.InexactFloat64()
				} else {
					h[k] = n.String()
				}
			}
		}
		if creating {
			return s.Store.InsertWith(ctx, tx, "work_centers", h)
		}
		return s.Store.UpdateWith(ctx, tx, "work_centers", id, h)
	})
	if err != nil {
		return nil, err
	}
	h, err := s.Store.Get(ctx, "work_centers", id)
	if err != nil {
		return nil, err
	}
	return s.Store.Public("work_centers", h), nil
}
func (s *Service) GetRouting(ctx context.Context, id string) (map[string]any, error) {
	h, err := s.Store.Get(ctx, "routings", id)
	if err != nil {
		return nil, err
	}
	pub := s.Store.Public("routings", h)
	edges := map[string]any{}
	if value(h, "product_id") != "" {
		p, err := s.Store.Get(ctx, "products", value(h, "product_id"))
		if err != nil {
			return nil, err
		}
		edges["product"] = s.Store.Public("products", p)
	}
	rows, err := s.Store.Rows(ctx, "SELECT * FROM routing_steps WHERE routing_id=? AND deleted_at IS NULL ORDER BY sequence", id)
	if err != nil {
		return nil, err
	}
	steps := []map[string]any{}
	for _, r := range rows {
		steps = append(steps, s.Store.Public("routing_steps", r))
	}
	if len(steps) > 0 {
		edges["steps"] = steps
	}
	pub["edges"] = edges
	return pub, nil
}
func (s *Service) WriteRouting(ctx context.Context, id string, input map[string]any) (map[string]any, error) {
	creating := id == ""
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		var h map[string]any
		var err error
		if creating {
			h = s.base("routings")
			number, err := s.nextNumber(ctx, tx, "RT")
			if err != nil {
				return err
			}
			h["code"], h["status"], h["version"] = number, "active", "1.0"
			id = value(h, "id")
		} else {
			h, err = s.Store.GetWith(ctx, tx, "routings", id)
			if err != nil {
				return err
			}
			var linked int
			if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM work_orders WHERE routing_id=? AND deleted_at IS NULL", id).Scan(&linked); err != nil {
				return err
			}
			if linked > 0 {
				return ErrUnsupported
			}
			h["updated_at"] = now()
		}
		if value(input, "product_id") != "" {
			if _, err := s.plainProduct(ctx, tx, value(input, "product_id")); err != nil {
				return err
			}
			h["product_id"] = input["product_id"]
		}
		// Captured PUT keeps the FK but clears omitted product snapshots/steps;
		// name/remark fields are ignored by the original routing request DTO.
		h["product_name"], h["product_code"] = value(input, "product_name"), value(input, "product_code")
		if value(input, "version") != "" {
			h["version"] = input["version"]
		}
		raw, _ := input["steps"].([]any)
		if len(raw) > 1000 {
			return errors.New("工序过多")
		}
		lines := []map[string]any{}
		for _, v := range raw {
			l, ok := v.(map[string]any)
			if !ok {
				return errors.New("工序格式错误")
			}
			if value(l, "process_code") == "" || value(l, "process_name") == "" {
				return errors.New("工序编码和名称不能为空")
			}
			row := s.base("routing_steps")
			sequence, err := Number(l["sequence"])
			if err != nil {
				return err
			}
			if !sequence.IsInteger() {
				return ErrUnsupported
			}
			row["routing_id"], row["sequence"], row["process_code"], row["process_name"], row["standard_time_unit"] = id, sequence.IntPart(), l["process_code"], l["process_name"], "minute"
			for _, k := range []string{"work_center", "remark", "standard_time_unit"} {
				if l[k] != nil {
					row[k] = l[k]
				}
			}
			if value(l, "work_center_id") != "" {
				if _, err := s.Store.GetWith(ctx, tx, "work_centers", value(l, "work_center_id")); err != nil {
					return err
				}
				row["work_center_id"] = l["work_center_id"]
			}
			for _, k := range []string{"standard_time", "setup_time", "teardown_time"} {
				n, err := Number(l[k])
				if err != nil {
					return err
				}
				if n.IsNegative() {
					return errors.New("工序时间不能为负")
				}
				row[k] = n.InexactFloat64()
			}
			lines = append(lines, row)
		}
		if creating {
			if err := s.Store.InsertWith(ctx, tx, "routings", h); err != nil {
				return err
			}
		} else {
			if err := s.Store.UpdateWith(ctx, tx, "routings", id, h); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, "UPDATE routing_steps SET deleted_at=?,updated_at=? WHERE routing_id=? AND deleted_at IS NULL", now(), now(), id); err != nil {
				return err
			}
		}
		for _, l := range lines {
			if err := s.Store.InsertWith(ctx, tx, "routing_steps", l); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.GetRouting(ctx, id)
}
