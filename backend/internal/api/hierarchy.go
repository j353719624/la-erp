package api

import (
	"context"
	"fmt"
	"net/http"
)

// Validate and write parent changes in the same SQLite transaction. Both the
// dedicated move endpoint and ordinary CRUD must prevent parent cycles.
type validationError struct{ message string }

func (e *validationError) Error() string    { return e.message }
func invalidHierarchy(message string) error { return &validationError{message: fmt.Sprint(message)} }

func (s *Server) writeRecord(r *http.Request, res Resource, id string, record map[string]any, create bool) error {
	if res.Table != "departments" && res.Table != "categories" {
		oldTeamID := ""
		if res.Table == "production_team_members" && !create {
			if old, err := s.Store.Get(r.Context(), res.Table, id); err == nil {
				oldTeamID, _ = old["team_id"].(string)
			}
		}
		if create {
			if err := s.Store.Insert(r.Context(), res.Table, record); err != nil {
				return err
			}
		} else if err := s.Store.Update(r.Context(), res.Table, id, record); err != nil {
			return err
		}
		if res.Table == "production_team_members" {
			teamID, _ := record["team_id"].(string)
			if err := s.refreshTeamMemberCount(r.Context(), teamID); err != nil {
				return err
			}
			if oldTeamID != "" && oldTeamID != teamID {
				return s.refreshTeamMemberCount(r.Context(), oldTeamID)
			}
		}
		return nil
	}
	tx, err := s.Store.DB.BeginTx(r.Context(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if parent, ok := record["parent_id"].(string); ok && parent != "" {
		seen := map[string]bool{}
		currentID := parent
		for currentID != "" {
			if currentID == id || seen[currentID] {
				return invalidHierarchy("不能将节点移动到自身或子节点下")
			}
			seen[currentID] = true
			p, err := s.Store.GetWith(r.Context(), tx, res.Table, currentID)
			if err != nil {
				return invalidHierarchy("父节点不存在")
			}
			if res.Table == "categories" {
				entity := record["entity_code"]
				if entity == nil && !create {
					old, err := s.Store.GetWith(r.Context(), tx, res.Table, id)
					if err != nil {
						return err
					}
					entity = old["entity_code"]
				}
				if entity != nil && p["entity_code"] != entity {
					return invalidHierarchy("父分类属于不同业务实体")
				}
			}
			currentID, _ = p["parent_id"].(string)
		}
	}
	if create {
		err = s.Store.InsertWith(r.Context(), tx, res.Table, record)
	} else {
		err = s.Store.UpdateWith(r.Context(), tx, res.Table, id, record)
	}
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Server) refreshTeamMemberCount(ctx context.Context, teamID string) error {
	if teamID == "" {
		return nil
	}
	var count int
	if err := s.Store.DB.QueryRowContext(ctx, "SELECT count(*) FROM production_team_members WHERE team_id=? AND deleted_at IS NULL", teamID).Scan(&count); err != nil {
		return err
	}
	return s.Store.Update(ctx, "production_teams", teamID, map[string]any{"member_count": count})
}

func mergeRecord(old, changes map[string]any) map[string]any {
	row := map[string]any{}
	for k, v := range old {
		row[k] = v
	}
	for k, v := range changes {
		row[k] = v
	}
	return row
}
