package api

import (
	"os"
	"testing"
)

// snapshotRoot points at the reference-capture tree used by replay tests. Those
// captures are regression baselines and are not distributed with this
// repository.
const snapshotRoot = "../../../evidence/"

// readSnapshot loads one capture file. When the capture tree is absent the
// replay test that depends on it is skipped instead of failing, so a clean
// checkout still runs green. Recreate the tree (or point snapshotRoot at a local
// copy) to re-enable the deep end-to-end comparisons.
func readSnapshot(t *testing.T, rel string) ([]byte, error) {
	t.Helper()
	raw, err := os.ReadFile(snapshotRoot + rel)
	if err != nil {
		t.Skipf("skip replay check: capture %s is not distributed with this repository (%v)", rel, err)
	}
	return raw, nil
}
