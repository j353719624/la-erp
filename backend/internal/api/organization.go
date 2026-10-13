package api

import (
	"errors"
	"fmt"
	"github.com/google/uuid"
	"la-erp-recovered/backend/internal/database"
	"net/http"
	"net/url"
)

func (s *Server) allDepartments(w http.ResponseWriter, r *http.Request) {
	rows, _, err := s.Store.List(r.Context(), "departments", url.Values{"page_size": {"1000"}})
	if err != nil {
		s.failure(w, err, "部门")
		return
	}
	values := []map[string]any{}
	for _, row := range rows {
		values = append(values, s.Store.Public("departments", row))
	}
	respond(w, 200, values)
}
func (s *Server) moveDepartment(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := s.Store.Get(r.Context(), "departments", id); err != nil {
		s.failure(w, err, "部门")
		return
	}
	data, err := decode(w, r)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	parent, ok := data["parent_id"]
	if !ok {
		fail(w, 400, "parent_id 为必填字段（顶级传 null）")
		return
	}
	tx, err := s.Store.DB.BeginTx(r.Context(), nil)
	if err != nil {
		s.failure(w, err, "部门")
		return
	}
	defer tx.Rollback()
	if parent != nil {
		value, ok := parent.(string)
		if !ok {
			fail(w, 400, "无效的父部门 ID")
			return
		}
		if _, err = uuid.Parse(value); err != nil {
			fail(w, 400, "无效的父部门 ID")
			return
		}
		seen := map[string]bool{}
		currentID := value
		for currentID != "" {
			if currentID == id || seen[currentID] {
				fail(w, 400, "不能将部门移动到自身或子部门下")
				return
			}
			seen[currentID] = true
			var next *string
			if err = tx.QueryRowContext(r.Context(), "SELECT parent_id FROM departments WHERE id=? AND deleted_at IS NULL", currentID).Scan(&next); err != nil {
				fail(w, 400, "父部门不存在")
				return
			}
			if next == nil {
				break
			}
			currentID = *next
		}
	}
	if _, err = tx.ExecContext(r.Context(), "UPDATE departments SET parent_id=?,updated_at=? WHERE id=? AND deleted_at IS NULL", parent, database.Now(), id); err != nil {
		s.failure(w, err, "部门")
		return
	}
	if err = tx.Commit(); err != nil {
		s.failure(w, err, "部门")
		return
	}
	s.get(w, r, Resources["departments"])
}
func (s *Server) assign(w http.ResponseWriter, r *http.Request, table, left, leftTable, right, rightTable, field string) {
	id := r.PathValue("id")
	if _, err := s.Store.Get(r.Context(), leftTable, id); err != nil {
		s.failure(w, err, "记录")
		return
	}
	data, err := decode(w, r)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	raw, ok := data[field].([]any)
	if !ok {
		fail(w, 400, field+" 必须是数组")
		return
	}
	ids := []string{}
	seen := map[string]bool{}
	for _, item := range raw {
		value, ok := item.(string)
		if !ok {
			fail(w, 400, "关联 ID 必须是字符串")
			return
		}
		if _, err = uuid.Parse(value); err != nil {
			fail(w, 400, "无效的关联 ID")
			return
		}
		if _, err = s.Store.Get(r.Context(), rightTable, value); err != nil {
			fail(w, 400, "关联记录不存在")
			return
		}
		if !seen[value] {
			ids = append(ids, value)
			seen[value] = true
		}
	}
	if leftTable == "sys_roles" {
		role, _ := s.Store.Get(r.Context(), leftTable, id)
		if role["code"] == "super_admin" {
			fail(w, 400, "超级管理员权限不可修改")
			return
		}
	}
	tx, err := s.Store.DB.BeginTx(r.Context(), nil)
	if err != nil {
		s.failure(w, err, "关联")
		return
	}
	defer tx.Rollback()
	query := "DELETE FROM " + database.Quote(table) + " WHERE " + database.Quote(left) + "=?"
	if _, err = tx.ExecContext(r.Context(), query, id); err != nil {
		s.failure(w, err, "关联")
		return
	}
	for _, value := range ids {
		now := database.Now()
		query = "INSERT INTO " + database.Quote(table) + " (created_at,updated_at," + database.Quote(left) + "," + database.Quote(right) + ") VALUES (?,?,?,?)"
		if _, err = tx.ExecContext(r.Context(), query, now, now, id, value); err != nil {
			s.failure(w, err, "关联")
			return
		}
	}
	if err = tx.Commit(); err != nil {
		s.failure(w, err, "关联")
		return
	}
	respond(w, 200, nil)
}
func (s *Server) assignUserRoles(w http.ResponseWriter, r *http.Request) {
	s.assign(w, r, "sys_user_roles", "user_id", "sys_users", "role_id", "sys_roles", "role_ids")
}
func (s *Server) assignRolePermissions(w http.ResponseWriter, r *http.Request) {
	s.assign(w, r, "sys_role_permissions", "role_id", "sys_roles", "permission_id", "sys_permissions", "permission_ids")
}
func (s *Server) categoryTree(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	q.Set("page_size", "1000")
	rows, _, err := s.Store.List(r.Context(), "categories", q)
	if err != nil {
		s.failure(w, err, "分类")
		return
	}
	nodes := map[string]map[string]any{}
	children := map[string][]string{}
	roots := []string{}
	for _, row := range rows {
		id := fmt.Sprint(row["id"])
		node := s.Store.Public("categories", row)
		delete(node, "edges")
		node["parent_id"] = row["parent_id"]
		node["children"] = []map[string]any{}
		nodes[id] = node
	}
	for _, row := range rows {
		id := fmt.Sprint(row["id"])
		parent, _ := row["parent_id"].(string)
		if nodes[parent] == nil {
			roots = append(roots, id)
		} else {
			children[parent] = append(children[parent], id)
		}
	}
	var visit func(string, map[string]bool) (map[string]any, error)
	visit = func(id string, seen map[string]bool) (map[string]any, error) {
		if seen[id] {
			return nil, errors.New("分类树存在循环")
		}
		seen[id] = true
		node := nodes[id]
		items := []map[string]any{}
		for _, child := range children[id] {
			item, err := visit(child, seen)
			if err != nil {
				return nil, err
			}
			items = append(items, item)
		}
		node["children"] = items
		delete(seen, id)
		return node, nil
	}
	tree := []map[string]any{}
	for _, id := range roots {
		item, err := visit(id, map[string]bool{})
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		tree = append(tree, item)
	}
	respond(w, 200, tree)
}
