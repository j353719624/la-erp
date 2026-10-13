// Package auth reconstructs the observed 1.4.51 login/session/RBAC contracts.
package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"la-erp-recovered/backend/internal/database"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

var ErrUnauthorized = errors.New("unauthorized")

type Claims struct {
	UserID       string `json:"user_id"`
	Username     string `json:"username"`
	Company      string `json:"company,omitempty"`
	TokenVersion int64  `json:"token_version"`
	JTI          string `json:"jti"`
	TokenType    string `json:"token_type"`
	Expires      int64  `json:"exp"`
	Issued       int64  `json:"iat"`
}
type Service struct {
	Store                 *database.Store
	secret                []byte
	AccessTTL, RefreshTTL time.Duration
	mu                    sync.Mutex
	revoked               map[string]int64
}

func New(store *database.Store, secret string) *Service {
	return &Service{Store: store, secret: []byte(secret), AccessTTL: 2 * time.Hour, RefreshTTL: 7 * 24 * time.Hour, revoked: map[string]int64{}}
}
func Hash(password string) (string, error) {
	if utf8.RuneCountInString(password) < 6 {
		return "", errors.New("密码至少 6 个字符")
	}
	raw, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(raw), err
}

// Scope preserves the role form's all/dept/self distinction for master data.
// Department scope is enforced conservatively until the original deployment's
// optional isolation switch has been reconstructed.
func (s *Service) Scope(ctx context.Context, id string) (string, string, error) {
	roles, _, err := s.Roles(ctx, id, false)
	if err != nil {
		return "", "", err
	}
	scope := "self"
	for _, role := range roles {
		value, _ := role["data_scope"].(string)
		if role["code"] == "super_admin" || value == "all" || value == "" {
			return "all", "", nil
		}
		if value == "dept" {
			scope = "dept"
		}
	}
	if scope == "dept" {
		user, err := s.Store.Get(ctx, "sys_users", id)
		if err != nil {
			return "", "", err
		}
		department, _ := user["department_id"].(string)
		return scope, department, nil
	}
	return scope, "", nil
}
func (s *Service) encode(claims Claims) (string, error) {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	body, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	value := header + "." + base64.RawURLEncoding.EncodeToString(body)
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(value))
	return value + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}
func (s *Service) Decode(token, kind string) (Claims, error) {
	var claims Claims
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return claims, ErrUnauthorized
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return claims, ErrUnauthorized
	}
	var header map[string]any
	if json.Unmarshal(raw, &header) != nil || header["alg"] != "HS256" {
		return claims, ErrUnauthorized
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return claims, ErrUnauthorized
	}
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(parts[0] + "." + parts[1]))
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return claims, ErrUnauthorized
	}
	raw, err = base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || json.Unmarshal(raw, &claims) != nil || claims.Expires <= time.Now().Unix() || claims.Issued > time.Now().Unix()+30 || claims.TokenType != kind || claims.Company != "default" {
		return claims, ErrUnauthorized
	}
	if _, err = uuid.Parse(claims.UserID); err != nil {
		return claims, ErrUnauthorized
	}
	if _, err = uuid.Parse(claims.JTI); err != nil {
		return claims, ErrUnauthorized
	}
	s.mu.Lock()
	for id, until := range s.revoked {
		if until <= time.Now().Unix() {
			delete(s.revoked, id)
		}
	}
	_, revoked := s.revoked[claims.JTI]
	s.mu.Unlock()
	if revoked {
		return claims, ErrUnauthorized
	}
	return claims, nil
}
func (s *Service) Authenticate(ctx context.Context, token, kind string) (Claims, map[string]any, error) {
	claims, err := s.Decode(token, kind)
	if err != nil {
		return claims, nil, err
	}
	user, err := s.Store.Get(ctx, "sys_users", claims.UserID)
	if err != nil || user["status"] != "active" || version(user) != claims.TokenVersion {
		return claims, nil, ErrUnauthorized
	}
	return claims, user, nil
}
func version(user map[string]any) int64 {
	switch n := user["token_version"].(type) {
	case int64:
		return n
	case float64:
		return int64(n)
	}
	return 0
}
func (s *Service) Roles(ctx context.Context, id string, withPermissions bool) ([]map[string]any, []string, error) {
	rows, err := s.Store.Rows(ctx, `SELECT r.* FROM sys_roles r JOIN sys_user_roles ur ON r.id=ur.role_id WHERE ur.user_id=? AND r.deleted_at IS NULL ORDER BY r.code`, id)
	if err != nil {
		return nil, nil, err
	}
	roles := []map[string]any{}
	permissions := []string{}
	seen := map[string]bool{}
	super := false
	for _, role := range rows {
		if role["code"] == "super_admin" {
			super = true
		}
		pub := s.Store.Public("sys_roles", role)
		p, err := s.Store.Rows(ctx, `SELECT p.* FROM sys_permissions p JOIN sys_role_permissions rp ON p.id=rp.permission_id WHERE rp.role_id=? AND p.deleted_at IS NULL ORDER BY p.sort_order,p.code`, role["id"])
		if err != nil {
			return nil, nil, err
		}
		values := []map[string]any{}
		for _, permission := range p {
			code := fmt.Sprint(permission["code"])
			if !seen[code] {
				permissions = append(permissions, code)
				seen[code] = true
			}
			if withPermissions {
				values = append(values, s.Store.Public("sys_permissions", permission))
			}
		}
		if withPermissions {
			pub["edges"] = map[string]any{"permissions": values}
		}
		roles = append(roles, pub)
	}
	if super {
		permissions = []string{"*"}
	}
	return roles, permissions, nil
}
func (s *Service) User(ctx context.Context, user map[string]any, withPermissions bool) (map[string]any, []map[string]any, []string, error) {
	roles, permissions, err := s.Roles(ctx, fmt.Sprint(user["id"]), withPermissions)
	if err != nil {
		return nil, nil, nil, err
	}
	pub := s.Store.Public("sys_users", user)
	edges := map[string]any{}
	if len(roles) > 0 {
		edges["roles"] = roles
	}
	if id, ok := user["department_id"].(string); ok && id != "" {
		if d, err := s.Store.Get(ctx, "departments", id); err == nil {
			edges["department"] = s.Store.Public("departments", d)
		}
	}
	pub["edges"] = edges
	return pub, roles, permissions, nil
}
func (s *Service) Allowed(ctx context.Context, id, permission string) bool {
	_, codes, err := s.Roles(ctx, id, false)
	if err != nil {
		return false
	}
	for _, code := range codes {
		if code == "*" || code == permission {
			return true
		}
	}
	return false
}
func (s *Service) Issue(ctx context.Context, user map[string]any, change bool) (map[string]any, error) {
	now := time.Now()
	common := Claims{UserID: fmt.Sprint(user["id"]), Username: fmt.Sprint(user["username"]), Company: "default", TokenVersion: version(user), Issued: now.Unix()}
	access := common
	access.JTI = uuid.NewString()
	access.TokenType = "access"
	access.Expires = now.Add(s.AccessTTL).Unix()
	a, err := s.encode(access)
	if err != nil {
		return nil, err
	}
	refresh := common
	refresh.JTI = uuid.NewString()
	refresh.TokenType = "refresh"
	refresh.Expires = now.Add(s.RefreshTTL).Unix()
	r, err := s.encode(refresh)
	if err != nil {
		return nil, err
	}
	timestamp := database.Now()
	if err = s.Store.Insert(ctx, "refresh_tokens", map[string]any{"id": refresh.JTI, "created_at": timestamp, "updated_at": timestamp, "user_id": common.UserID, "expires_at": time.Unix(refresh.Expires, 0).Format(time.RFC3339Nano)}); err != nil {
		return nil, err
	}
	pub, roles, permissions, err := s.User(ctx, user, true)
	if err != nil {
		return nil, err
	}
	return map[string]any{"access_token": a, "refresh_token": r, "user": pub, "roles": roles, "permissions": permissions, "need_change_password": change, "company": "default", "company_is_default": true}, nil
}
func (s *Service) Login(ctx context.Context, username, password, company string) (map[string]any, error) {
	if company != "" && company != "default" {
		return nil, errors.New("公司不存在或未启用")
	}
	rows, err := s.Store.Rows(ctx, "SELECT * FROM sys_users WHERE username=? AND deleted_at IS NULL", username)
	if err != nil {
		return nil, err
	}
	if len(rows) != 1 || bcrypt.CompareHashAndPassword([]byte(fmt.Sprint(rows[0]["password_hash"])), []byte(password)) != nil {
		return nil, errors.New("用户名或密码错误")
	}
	user := rows[0]
	if user["status"] != "active" {
		return nil, errors.New("用户已停用")
	}
	now := database.Now()
	if err = s.Store.Update(ctx, "sys_users", fmt.Sprint(user["id"]), map[string]any{"last_login_at": now, "updated_at": now}); err != nil {
		return nil, err
	}
	user["last_login_at"] = now
	user["updated_at"] = now
	return s.Issue(ctx, user, username == "admin" && password == "admin123")
}

func (s *Service) CustomerLogin(ctx context.Context, account, password string) (map[string]any, error) {
	rows, err := s.Store.Rows(ctx, "SELECT * FROM customers WHERE login_account=? AND portal_enabled=1 AND status='active' AND deleted_at IS NULL", account)
	if err != nil {
		return nil, err
	}
	if len(rows) != 1 || bcrypt.CompareHashAndPassword([]byte(fmt.Sprint(rows[0]["password_hash"])), []byte(password)) != nil {
		return nil, errors.New("客户账号或密码错误")
	}
	c := rows[0]
	now := time.Now()
	claims := Claims{UserID: fmt.Sprint(c["id"]), Username: account, Company: "default", TokenVersion: version(c), JTI: uuid.NewString(), TokenType: "portal", Expires: now.Add(s.AccessTTL).Unix(), Issued: now.Unix()}
	token, err := s.encode(claims)
	if err != nil {
		return nil, err
	}
	_ = s.Store.Update(ctx, "customers", fmt.Sprint(c["id"]), map[string]any{"last_login_at": database.Now(), "updated_at": database.Now()})
	return map[string]any{"access_token": token, "customer_id": c["id"], "customer_name": c["name"]}, nil
}

func (s *Service) AuthenticateCustomer(ctx context.Context, token string) (Claims, map[string]any, error) {
	claims, err := s.Decode(token, "portal")
	if err != nil {
		return claims, nil, err
	}
	customer, err := s.Store.Get(ctx, "customers", claims.UserID)
	if err != nil || customer["status"] != "active" || customer["portal_enabled"] != true || version(customer) != claims.TokenVersion {
		return claims, nil, ErrUnauthorized
	}
	return claims, customer, nil
}
func (s *Service) Refresh(ctx context.Context, token string) (map[string]any, error) {
	claims, user, err := s.Authenticate(ctx, token, "refresh")
	if err != nil {
		return nil, ErrUnauthorized
	}
	result, err := s.Store.DB.ExecContext(ctx, "UPDATE refresh_tokens SET revoked_at=?,updated_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL", database.Now(), database.Now(), claims.JTI, claims.UserID)
	if err != nil {
		return nil, err
	}
	n, err := result.RowsAffected()
	if err != nil || n != 1 {
		return nil, ErrUnauthorized
	}
	return s.Issue(ctx, user, false)
}
func (s *Service) Logout(ctx context.Context, claims Claims) error {
	s.mu.Lock()
	s.revoked[claims.JTI] = claims.Expires
	s.mu.Unlock()
	_, err := s.Store.DB.ExecContext(ctx, "UPDATE refresh_tokens SET revoked_at=?,updated_at=? WHERE user_id=? AND revoked_at IS NULL", database.Now(), database.Now(), claims.UserID)
	return err
}
func (s *Service) ChangePassword(ctx context.Context, id, old, newPassword string) error {
	user, err := s.Store.Get(ctx, "sys_users", id)
	if err != nil {
		return err
	}
	if bcrypt.CompareHashAndPassword([]byte(fmt.Sprint(user["password_hash"])), []byte(old)) != nil {
		return errors.New("原密码不正确")
	}
	return s.setPassword(ctx, id, newPassword, version(user)+1)
}
func (s *Service) setPassword(ctx context.Context, id, password string, newVersion int64) error {
	hash, err := Hash(password)
	if err != nil {
		return err
	}
	tx, err := s.Store.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "UPDATE sys_users SET password_hash=?,token_version=?,updated_at=? WHERE id=? AND deleted_at IS NULL", hash, newVersion, database.Now(), id); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE refresh_tokens SET revoked_at=?,updated_at=? WHERE user_id=? AND revoked_at IS NULL", database.Now(), database.Now(), id); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Service) ResetPassword(ctx context.Context, id string) (string, error) {
	user, err := s.Store.Get(ctx, "sys_users", id)
	if err != nil {
		return "", err
	}
	random := make([]byte, 12)
	if _, err = rand.Read(random); err != nil {
		return "", err
	}
	password := base64.RawURLEncoding.EncodeToString(random)
	return password, s.setPassword(ctx, id, password, version(user)+1)
}
