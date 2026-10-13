package license

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"strings"
	"testing"
	"time"
)

func TestPayloadAndValidation(t *testing.T) {
	pub, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil { t.Fatal(err) }
	f := File{MachineID: strings.Repeat("a", 64), IssuedAt: "2026-10-08T00:00:00Z", ExpiresAt: "2030-01-01T00:00:00Z", Extra: "<企业>&\u2028\u2029", Edition: "pro"}
	payload, err := f.SignaturePayload()
	if err != nil { t.Fatal(err) }
	if !strings.Contains(string(payload), `"extra":"\u003c企业\u003e\u0026\u2028\u2029","edition":"pro"`) { t.Fatalf("wrong payload: %s", payload) }
	f.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(private, payload))
	key := base64.StdEncoding.EncodeToString(pub)
	now := time.Date(2026, 10, 8, 0, 0, 0, 0, time.UTC)
	if err := Verify(f, key, f.MachineID, "pro", now); err != nil { t.Fatal(err) }
	if err := Verify(f, key, "wrong", "pro", now); err == nil { t.Fatal("wrong machine accepted") }
	if err := Verify(f, key, f.MachineID, "lite", now); err == nil { t.Fatal("wrong edition accepted") }
	if err := Verify(f, key, f.MachineID, "pro", now.AddDate(10, 0, 0)); err == nil { t.Fatal("expired license accepted") }
	f.Extra = "changed"
	if err := Verify(f, key, f.MachineID, "pro", now); err == nil { t.Fatal("tampered license accepted") }
}
