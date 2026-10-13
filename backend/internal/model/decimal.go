package model

import (
	"encoding/json"
	"fmt"
	"regexp"
)

// Decimal preserves the exact text of a monetary/quantity value. The original
// API encodes decimal database values as JSON strings, including "0".
type Decimal string

var decimalPattern = regexp.MustCompile(`^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$`)

func (d Decimal) MarshalJSON() ([]byte, error) { return json.Marshal(string(d)) }
func (d *Decimal) UnmarshalJSON(raw []byte) error {
	var value string
	if len(raw) > 0 && raw[0] == '"' {
		if err := json.Unmarshal(raw, &value); err != nil {
			return err
		}
	} else {
		value = string(raw)
	}
	if !decimalPattern.MatchString(value) {
		return fmt.Errorf("invalid decimal %q", value)
	}
	*d = Decimal(value)
	return nil
}
