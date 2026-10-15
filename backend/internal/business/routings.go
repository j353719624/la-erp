package business

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/shopspring/decimal"
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
			// 回归回放 CC3b（2026-10-14）：工作中心编辑时传入新 code 既有实现 code:0，
			// 但**回读 code 仍是建单时的原值**（C2-WC1 不变），name/capacity/cost_rate
			// 均正常更新。即 code 不可改、也不拒绝，只是静默沿用旧值。
			// 原本实现在 code 不同时返回 ErrUnsupported，属误拒，已移除。
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
			// 回归回放 CC4（2026-10-14）：工艺已被工单关联后执行删除，既有实现返回
			// 10000「工艺路线不存在」——即删除**按不存在处理**，而本实现返回 501
			// ErrUnsupported。既有实现语义等价于「有关联时不可删」，本实现改为原文案。
			var linked int
			if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM work_orders WHERE routing_id=? AND deleted_at IS NULL", id).Scan(&linked); err != nil {
				return err
			}
			if linked > 0 {
				return errors.New("工艺路线不存在")
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
			// 批次 Y 精确取证（2026-10-14，运行快照）：
			// 既有实现对 process_code / process_name **必填**（隔离实测：其余字段全合法时，
			// 缺任一项返回 HTTP **500**「系统内部错误，请稍后重试或联系管理员」——
			// Go 结构体绑定失败，非业务校验）。
			// 本实现原先返回自造文案「工序编码和名称不能为空」，已按既有实现改为 500 + 原文案。
			if value(l, "process_code") == "" || value(l, "process_name") == "" {
				return ErrKnownNoMessage{Status: 500, Note: "系统内部错误，请稍后重试或联系管理员"}
			}
			row := s.base("routing_steps")
			// 批次 Y 精确取证（2026-10-14，运行快照）：
			// 既有实现对 sequence 的约束（**其余字段全部合法**时的隔离实测）：
			//   整数 2 / 负整数 -1 / 不传 → code:0（不传时落库 0）
			//   字符串 "2"              → HTTP **400**「系统内部错误，请稍后重试或联系管理员」
			//   小数 1.5                → HTTP **400** 同上
			// 即既有实现要求 sequence **要么不传，要么是 JSON 整数**。
			//
			// ⚠ 归因教训（本批次踩过的坑）：早期测试 TestSourceRoutingSequenceRequiresJSONInteger
			// 用的键是 `steps`，结论正确；但批次 Y 首次取证时误用了 `lines` 键 ——
			// 既有实现**只处理 `steps`，传 `lines` 会被完全忽略**（返回 code:0 且明细不落库），
			// 于是得出「既有实现不校验 sequence」的相反结论。
			// **变量隔离必须同时固定「用哪个键」**，否则 400 归因会错到别的字段头上。
			//
			// 注意 api 层 decode 用 UseNumber()，故数字是 json.Number 而非 float64；
			// 不能用 Number() 兜底 —— 它会把 "2" 转成 2 放行，与与既有行为不符。
			sequence := decimal.Zero
			if raw := l["sequence"]; raw != nil {
				number, isNumeric := raw.(json.Number)
				if !isNumeric {
					return ErrKnownNoMessage{Status: 400, Note: "系统内部错误，请稍后重试或联系管理员"}
				}
				parsed, err := decimal.NewFromString(number.String())
				if err != nil || !parsed.IsInteger() {
					return ErrKnownNoMessage{Status: 400, Note: "系统内部错误，请稍后重试或联系管理员"}
				}
				sequence = parsed
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
