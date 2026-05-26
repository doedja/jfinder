package util

import (
	"fmt"
	"strings"

	"github.com/doedja/jfinder/internal/types"
)

func PapersToBibTeX(papers []types.Paper) string {
	var b strings.Builder
	for i, p := range papers {
		b.WriteString("@article{")
		key := fmt.Sprintf("paper_%d", i+1)
		if p.DOI != "" {
			clean := strings.Map(func(r rune) rune {
				if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
					return r
				}
				return '_'
			}, p.DOI)
			if clean != "" {
				key = clean
			}
		}
		b.WriteString(key)
		b.WriteString(",\n")
		writeFieldBibTeX(&b, "title", p.Title)
		if p.Authors != "" {
			authors := strings.Split(p.Authors, ",")
			joined := strings.Join(authors, " and ")
			writeFieldBibTeX(&b, "author", joined)
		}
		writeFieldBibTeX(&b, "journal", p.Journal)
		writeFieldBibTeX(&b, "year", p.Year)
		if p.DOI != "" {
			writeFieldBibTeX(&b, "doi", p.DOI)
		}
		if p.Abstract != "" {
			ab := p.Abstract
			if len(ab) > 1000 {
				ab = ab[:1000]
			}
			writeFieldBibTeX(&b, "abstract", ab)
		}
		b.WriteString("}\n\n")
	}
	return b.String()
}

func writeFieldBibTeX(b *strings.Builder, name, value string) {
	if value == "" {
		return
	}
	escaped := escapeBibTeX(value)
	b.WriteString(fmt.Sprintf("  %s = {%s},\n", name, escaped))
}

func escapeBibTeX(s string) string {
	s = strings.ReplaceAll(s, "{", "")
	s = strings.ReplaceAll(s, "}", "")
	s = strings.ReplaceAll(s, "&", `\&`)
	s = strings.ReplaceAll(s, "%", `\%`)
	s = strings.ReplaceAll(s, "#", `\#`)
	s = strings.ReplaceAll(s, "_", `\_`)
	return s
}

func PapersToRIS(papers []types.Paper) string {
	var b strings.Builder
	for _, p := range papers {
		b.WriteString("TY  - JOUR\n")
		b.WriteString(fmt.Sprintf("TI  - %s\n", p.Title))
		if p.Authors != "" {
			for _, author := range strings.Split(p.Authors, ",") {
				author = strings.TrimSpace(author)
				if author != "" {
					b.WriteString(fmt.Sprintf("AU  - %s\n", author))
				}
			}
		}
		b.WriteString(fmt.Sprintf("JO  - %s\n", p.Journal))
		b.WriteString(fmt.Sprintf("PY  - %s\n", p.Year))
		if p.DOI != "" {
			b.WriteString(fmt.Sprintf("DO  - %s\n", p.DOI))
			b.WriteString(fmt.Sprintf("UR  - https://doi.org/%s\n", p.DOI))
		}
		if p.Abstract != "" {
			ab := p.Abstract
			if len(ab) > 1000 {
				ab = ab[:1000]
			}
			b.WriteString(fmt.Sprintf("AB  - %s\n", ab))
		}
		b.WriteString("ER  - \n\n")
	}
	return b.String()
}
