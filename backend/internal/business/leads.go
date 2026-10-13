package business

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/google/uuid"
)

// ConvertLead atomically links a lead to an existing/new customer and may
// create the first opportunity observed in the original CRM flow.
func (s *Service) ConvertLead(ctx context.Context, leadID string, input map[string]any) (map[string]any, error) {
	var result map[string]any
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		lead, err := s.Store.GetWith(ctx, tx, "leads", leadID)
		if err != nil {
			return errors.New("线索不存在")
		}
		if value(lead, "status") == "converted" || value(lead, "customer_id") != "" {
			return errors.New("线索已转化")
		}
		customerID := value(input, "customer_id")
		var customer map[string]any
		if customerID != "" {
			customer, err = s.Store.GetWith(ctx, tx, "customers", customerID)
			if err != nil {
				return errors.New("客户不存在")
			}
		} else {
			customerID = uuid.NewString()
			name := value(lead, "company")
			if name == "" {
				name = value(lead, "name")
			}
			code, e := s.nextNumber(ctx, tx, "CUS")
			if e != nil {
				return e
			}
			customer = s.base("customers")
			customer["id"] = customerID
			customer["code"] = code
			customer["name"] = name
			customer["contact"] = value(lead, "name")
			customer["phone"] = value(lead, "phone")
			customer["email"] = value(lead, "email")
			customer["status"] = "active"
			if err = s.Store.InsertWith(ctx, tx, "customers", customer); err != nil {
				return err
			}
		}
		var opportunity map[string]any
		if truthy(input["create_opportunity"]) {
			code, e := s.nextNumber(ctx, tx, "OPP")
			if e != nil {
				return e
			}
			name := value(input, "opportunity_name")
			if name == "" {
				name = value(lead, "name")
			}
			opportunity = s.base("crm_opportunities")
			opportunity["code"] = code
			opportunity["name"] = name
			opportunity["customer_id"] = customerID
			opportunity["customer_name"] = value(customer, "name")
			opportunity["lead_id"] = leadID
			opportunity["contact_name"] = value(lead, "name")
			opportunity["contact_phone"] = value(lead, "phone")
			opportunity["amount"] = "0"
			if value(input, "amount") != "" {
				opportunity["amount"] = value(input, "amount")
			}
			opportunity["stage"] = "prospecting"
			opportunity["probability"] = 10
			opportunity["source"] = value(lead, "source")
			opportunity["owner"] = value(input, "owner")
			if err = s.Store.InsertWith(ctx, tx, "crm_opportunities", opportunity); err != nil {
				return err
			}
		}
		if err = s.Store.UpdateWith(ctx, tx, "leads", leadID, map[string]any{"customer_id": customerID, "status": "converted", "converted_at": now(), "updated_at": now()}); err != nil {
			return err
		}
		result = map[string]any{"customer": customer, "opportunity": opportunity}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("线索转化失败: %w", err)
	}
	return result, nil
}

func truthy(v any) bool { return v == true || v == "true" || v == float64(1) || v == int64(1) }
