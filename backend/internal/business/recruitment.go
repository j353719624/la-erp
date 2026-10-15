package business

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"la-erp/backend/internal/database"
)

func (s *Service) HireRecruitmentCandidate(ctx context.Context, id string, input map[string]any) (map[string]any, error) {
	var result map[string]any
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		c, err := s.Store.GetWith(ctx, tx, "recruitment_candidates", id)
		if errors.Is(err, database.ErrNotFound) {
			return errors.New("候选人不存在")
		}
		if err != nil {
			return err
		}
		if value(c, "status") == "hired" {
			return errors.New("候选人已录用")
		}
		employeeID := uuid.NewString()
		code := fmt.Sprintf("EMP-%s", employeeID[:8])
		if v := value(input, "code"); v != "" {
			code = v
		}
		hireDate := value(input, "hire_date")
		if hireDate == "" {
			hireDate = now()
		}
		row := map[string]any{"id": employeeID, "code": code, "name": value(c, "name"), "phone": c["phone"], "email": c["email"], "position": value(input, "position"), "department_id": value(input, "department_id"), "employment_type": "full_time", "status": "active", "hire_date": hireDate, "base_salary": input["base_salary"], "tenant_id": database.ZeroUUID, "created_at": now(), "updated_at": now()}
		if err := s.Store.InsertWith(ctx, tx, "employees", row); err != nil {
			return err
		}
		if err := s.Store.UpdateWith(ctx, tx, "recruitment_candidates", id, map[string]any{"status": "hired", "employee_id": employeeID, "hired_at": now(), "updated_at": now()}); err != nil {
			return err
		}
		result, err = s.Store.GetWith(ctx, tx, "employees", employeeID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.Store.Public("employees", result), nil
}
