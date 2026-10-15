package api

import (
	"os"
	"testing"
)

// evidenceRoot points at the original-runtime capture tree. Those captures are
// forensic artefacts produced while reconstructing the system; they are not
// distributed with this repository.
const evidenceRoot = "../../../evidence/"

// readEvidenceSnapshot loads one capture file. When the capture tree is absent
// the replay test that depends on it is skipped instead of failing, so a clean
// checkout still runs green. Recreate the tree (or point evidenceRoot at a
// local copy) to re-enable the deep original-vs-recovered comparisons.
func readEvidenceSnapshot(t *testing.T, rel string) ([]byte, error) {
	t.Helper()
	raw, err := os.ReadFile(evidenceRoot + rel)
	if err != nil {
		t.Skipf("skip replay check: evidence snapshot %s is not distributed with this repository (%v)", rel, err)
	}
	return raw, nil
}
