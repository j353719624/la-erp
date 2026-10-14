package business

import (
	"context"
	"database/sql"
	"errors"
	"la-erp-recovered/backend/internal/database"
)

func (s *Service) AttendanceAction(ctx context.Context, id, action string) (map[string]any, error) {
	var result map[string]any
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		row, err := s.Store.GetWith(ctx, tx, "attendance_requests", id)
		if errors.Is(err, database.ErrNotFound) {
			return errors.New("考勤申请不存在")
		}
		if err != nil {
			return err
		}
		status := value(row, "status")
		next := ""
		switch action {
		case "submit":
			if status != "draft" {
				return errors.New("只有草稿申请才能提交")
			}
			next = "submitted"
		case "approve":
			if status != "submitted" {
				return errors.New("只有待审批申请才能通过")
			}
			next = "approved"
		case "reject":
			if status != "submitted" {
				return errors.New("只有待审批申请才能驳回")
			}
			next = "rejected"
		case "cancel":
			if status != "draft" && status != "submitted" {
				return errors.New("当前状态不能取消")
			}
			next = "cancelled"
		// 原版 NN10 的考勤路由前缀与恢复端不同（6 个候选前缀全部 404），
		// 无法逐项比对原版动作集；本 default 在 API 层 []string{...} 下**不可达**，
		// 保留 ErrUnsupported 作兜底，不自造文案。
		default:
			return ErrUnsupported
		}
		if err := s.Store.UpdateWith(ctx, tx, "attendance_requests", id, map[string]any{"status": next, "updated_at": now()}); err != nil {
			return err
		}
		result, err = s.Store.GetWith(ctx, tx, "attendance_requests", id)
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.Store.Public("attendance_requests", result), nil
}

func (s *Service) AttendanceSummary(ctx context.Context, period string) ([]map[string]any, error) {
	if len(period) != 7 {
		return nil, errors.New("period 必须为 YYYY-MM")
	}
	rows, err := s.Store.Rows(ctx, `SELECT employee_id, employee_name,
        COALESCE(SUM(CASE WHEN request_type='leave' AND status='approved' THEN days ELSE 0 END),0) leave_days,
        COALESCE(SUM(CASE WHEN request_type='overtime' AND status='approved' THEN hours ELSE 0 END),0) overtime_hours,
        SUM(CASE WHEN request_type='leave' AND status='approved' THEN 1 ELSE 0 END) leave_count,
        SUM(CASE WHEN request_type='overtime' AND status='approved' THEN 1 ELSE 0 END) overtime_count
        FROM attendance_requests WHERE deleted_at IS NULL AND substr(start_date,1,7)=? GROUP BY employee_id, employee_name ORDER BY employee_name`, period)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		// Summary columns are computed aggregates rather than model fields;
		// preserve them in the API response instead of filtering through the
		// attendance_requests public model.
		out = append(out, row)
	}
	return out, nil
}
