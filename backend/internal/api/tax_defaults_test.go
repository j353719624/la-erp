package api

import "testing"

func TestTaxRateDefaultsPersistIntoPreview(t *testing.T) {
	c, _ := setup(t)
	input := map[string]any{"vat_rate": 0.09, "city_rate": 0.05, "edu_rate": 0.02, "local_edu_rate": 0.01, "stamp_rate": 0.001, "income_tax_rate": 0.2, "dividend_tax_rate": 0.1}
	c.ok("PUT", "/api/v1/tax-accruals/rate-defaults", input)
	defaults := c.ok("GET", "/api/v1/tax-accruals/rate-defaults", nil).(map[string]any)
	if defaults["vat_rate"] != 0.09 || defaults["dividend_tax_rate"] != 0.1 {
		t.Fatalf("defaults not persisted: %#v", defaults)
	}
	preview := c.ok("GET", "/api/v1/tax-accruals/preview?period=2099-01", nil).(map[string]any)
	pd := preview["defaults"].(map[string]any)
	if pd["vat_rate"] != 0.09 || pd["income_tax_rate"] != 0.2 {
		t.Fatalf("preview defaults differ: %#v", pd)
	}
}

func TestTaxRateDefaultsRejectOutOfRange(t *testing.T) {
	c, _ := setup(t)
	if status, _ := c.request("PUT", "/api/v1/tax-accruals/rate-defaults", map[string]any{"vat_rate": 1.1}); status != 400 {
		t.Fatalf("invalid tax rate status=%d", status)
	}
}
