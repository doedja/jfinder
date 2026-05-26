package download

import (
	"fmt"
	"strings"

	"github.com/doedja/jfinder/internal/types"
)

func GenerateMetadata(papers []types.Paper, searchQueries []string, failed []types.FailedDownload) string {
	var b strings.Builder

	b.WriteString("Search Queries Used:\n")
	for i, q := range searchQueries {
		b.WriteString(fmt.Sprintf("%d. %s\n", i+1, q))
	}
	b.WriteString(strings.Repeat("=", 50) + "\n")

	b.WriteString(fmt.Sprintf("Found Papers (%d):\n", len(papers)))
	for _, p := range papers {
		b.WriteString(fmt.Sprintf("Title: %s\n", p.Title))
		b.WriteString(fmt.Sprintf("Authors: %s\n", p.Authors))
		b.WriteString(fmt.Sprintf("Journal: %s\n", p.Journal))
		b.WriteString(fmt.Sprintf("Year: %s\n", p.Year))
		b.WriteString(fmt.Sprintf("DOI: %s\n", p.DOI))
		if p.OpenAccessURL != "" {
			b.WriteString(fmt.Sprintf("Open Access: %s\n", p.OpenAccessURL))
		}
		if p.Abstract != "" {
			abs := p.Abstract
			if len(abs) > 500 {
				abs = abs[:500] + "..."
			}
			b.WriteString(fmt.Sprintf("Abstract: %s\n", abs))
		}
		b.WriteString("\n")
	}
	b.WriteString(strings.Repeat("=", 50) + "\n")

	if len(failed) > 0 {
		b.WriteString(fmt.Sprintf("Failed Downloads (%d):\n", len(failed)))
		for _, f := range failed {
			b.WriteString(fmt.Sprintf("Paper: %s (%s)\n", f.Paper.Title, f.Paper.DOI))
			b.WriteString(fmt.Sprintf("Error: %s\n", f.Error))
			b.WriteString("\n")
		}
		b.WriteString(strings.Repeat("=", 50) + "\n")
	}
	return b.String()
}
