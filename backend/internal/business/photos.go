package business

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
)

var photoPath = regexp.MustCompile(`^/uploads/(images/)?[A-Za-z0-9_-]+\.(jpg|jpeg|png|gif|webp|bmp)$`)

func (s *Service) AddStockPhotos(ctx context.Context, id string, input map[string]any, user string) ([]map[string]any, error) {
	raw, ok := input["photos"].([]any)
	if !ok || len(raw) == 0 {
		return nil, errors.New("请选择要记录的图片")
	}
	if len(raw) > 20 {
		// 回归回放 FF1（2026-10-14，运行快照）：
		// 提交 101 张 → 400「单张入库单最多记录 20 张照片，请先删除不再需要的记录」。
		// 原本实现上限为 100 且返回 501，属错误拒绝与错误上限，已对齐为 20 + 原文案。
		return nil, errors.New("单张入库单最多记录 20 张照片，请先删除不再需要的记录")
	}
	photos := []map[string]any{}
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		if _, err := s.Store.GetWith(ctx, tx, "stock_ins", id); err != nil {
			return err
		}
		for _, v := range raw {
			in, ok := v.(map[string]any)
			if !ok {
				return errors.New("图片参数错误")
			}
			url := value(in, "url")
			if !photoPath.MatchString(url) {
				return errors.New("拍照记录图片地址无效：仅支持系统上传接口返回的图片")
			}
			if err := s.photoLocation(ctx, tx, id, in); err != nil {
				return err
			}
			p := s.base("stock_in_photos")
			p["stock_in_id"], p["url"], p["remark"], p["created_by"] = id, url, value(in, "remark"), user
			for _, k := range []string{"location_id", "rack_id"} {
				if value(in, k) != "" {
					p[k] = in[k]
				}
			}
			if err := s.Store.InsertWith(ctx, tx, "stock_in_photos", p); err != nil {
				return err
			}
			photos = append(photos, s.Store.Public("stock_in_photos", p))
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return photos, nil
}

func (s *Service) EditStockPhoto(ctx context.Context, stock, id string, input map[string]any, remove bool) error {
	return s.transaction(ctx, func(tx *sql.Tx) error {
		if _, err := s.Store.GetWith(ctx, tx, "stock_ins", stock); err != nil {
			return err
		}
		p, err := s.Store.GetWith(ctx, tx, "stock_in_photos", id)
		if err != nil || value(p, "stock_in_id") != stock {
			return errors.New("拍照记录不存在或已删除")
		}
		changes := map[string]any{"updated_at": now()}
		if remove {
			changes["deleted_at"] = now()
		} else {
			if err := s.photoLocation(ctx, tx, stock, input); err != nil {
				return err
			}
			for _, k := range []string{"location_id", "rack_id"} {
				changes[k] = nil
				if value(input, k) != "" {
					changes[k] = input[k]
				}
			}
			if v, ok := input["remark"]; ok {
				changes["remark"] = v
			}
		}
		return s.Store.UpdateWith(ctx, tx, "stock_in_photos", id, changes)
	})
}

func (s *Service) photoLocation(ctx context.Context, tx *sql.Tx, stock string, input map[string]any) error {
	// 入库单本身必须存在（引用完整性）。
	if _, err := s.Store.GetWith(ctx, tx, "stock_ins", stock); err != nil {
		return err
	}
	// 回归回放 HH2（2026-10-14，运行快照）：
	// 照片的 location_id / rack_id / location 字符串 / 不存在的 location_id /
	// **属于其他仓库的 location_id** —— 五种情况既有实现全部 code:0 建单成功，
	// 即既有实现对库位与货架**不做任何归属校验**（只要库位/货架记录存在即可）。
	// 原本实现校验「库位必须属本仓」「货架必须挂在该库位下」两处，属误拒，已移除。
	if location := value(input, "location_id"); location != "" {
		if _, err := s.Store.GetWith(ctx, tx, "locations", location); err != nil {
			return err
		}
	}
	if rack := value(input, "rack_id"); rack != "" {
		if _, err := s.Store.GetWith(ctx, tx, "racks", rack); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) StockPhotos(ctx context.Context, id string) ([]map[string]any, error) {
	rows, err := s.Store.Rows(ctx, "SELECT * FROM stock_in_photos WHERE stock_in_id=? AND deleted_at IS NULL ORDER BY created_at", id)
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for _, r := range rows {
		out = append(out, s.Store.Public("stock_in_photos", r))
	}
	return out, nil
}
