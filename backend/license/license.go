// Package license reconstructs the 1.4.51 license file format and verification.
// It is recovered logic, not the original full ERP backend source.
package license

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const OriginalPublicKey = "v08PqUbX9oNfLruLg3oDEVuTbM+koZ5uG2Qf5rIDYhw="

// File fields and order are backed by runtime type at VA 0x3b5d2e0.
type File struct {
	MachineID string `json:"machine_id"`
	IssuedAt string `json:"issued_at"`
	ExpiresAt string `json:"expires_at"`
	Extra string `json:"extra,omitempty"`
	Edition string `json:"edition,omitempty"`
	Signature string `json:"signature"`
}

// SignaturePayload mirrors the struct serialization at VA 0xe3c1a0.
func (f File) SignaturePayload() ([]byte, error) {
	return json.Marshal(struct {
		MachineID string `json:"machine_id"`
		IssuedAt string `json:"issued_at"`
		ExpiresAt string `json:"expires_at"`
		Extra string `json:"extra,omitempty"`
		Edition string `json:"edition,omitempty"`
	}{f.MachineID, f.IssuedAt, f.ExpiresAt, f.Extra, f.Edition})
}

// MachineID uses the first readable non-empty host identity, preserving case.
func MachineID(root string) (string, error) {
	for _, p := range []string{"sys/class/dmi/id/product_uuid", "etc/machine-id", "var/lib/dbus/machine-id"} {
		data, err := os.ReadFile(filepath.Join(root, p))
		if err != nil { continue }
		value := strings.TrimSpace(string(data))
		if value == "" || value == "00000000-0000-0000-0000-000000000000" { continue }
		sum := sha256.Sum256([]byte(value))
		return hex.EncodeToString(sum[:]), nil
	}
	return "", errors.New("无法读取机器唯一标识")
}

// Verify retains signature, machine binding, edition and expiration checks.
func Verify(f File, publicBase64, machineID, edition string, now time.Time) error {
	key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(publicBase64))
	if err != nil || len(key) != ed25519.PublicKeySize { return errors.New("授权公钥配置错误") }
	sig, err := base64.StdEncoding.DecodeString(f.Signature)
	if err != nil { return errors.New("授权签名无效") }
	payload, err := f.SignaturePayload()
	if err != nil { return err }
	if !ed25519.Verify(ed25519.PublicKey(key), payload, sig) { return errors.New("授权签名无效") }
	if f.MachineID != machineID { return errors.New("授权机器码不匹配") }
	if f.Edition != "" && f.Edition != edition { return errors.New("授权产品版本不匹配") }
	if f.ExpiresAt != "" {
		expires, err := time.Parse(time.RFC3339, f.ExpiresAt)
		if err != nil { return fmt.Errorf("授权有效期格式错误: %w", err) }
		if now.After(expires) { return errors.New("授权已过期") }
	}
	return nil
}
