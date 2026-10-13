package database

import (
	"testing"
	"time"
)

func TestSQLValuePreservesFixedOffsetTime(t *testing.T) {
	stamp := time.Date(2026, 10, 1, 0, 0, 0, 123, time.FixedZone("", 8*60*60))
	got := SQLValue(stamp)
	if got != "2026-10-01T00:00:00.000000123+08:00" {
		t.Fatalf("SQL timestamp = %v", got)
	}
	parsed, err := time.Parse(time.RFC3339Nano, got.(string))
	if err != nil || !parsed.Equal(stamp) {
		t.Fatalf("timestamp failed round trip: %v, %v", parsed, err)
	}
}
