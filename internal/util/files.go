package util

import (
	"bufio"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var uuidRegex = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func IsValidTaskID(id string) bool {
	return uuidRegex.MatchString(id)
}

func EnsureDir(path string) error {
	return os.MkdirAll(path, 0755)
}

func CreateSafeFilename(name string, maxLength int) string {
	var b strings.Builder
	for _, r := range name {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == ' ' || r == '_' {
			b.WriteRune(r)
		} else {
			b.WriteRune('_')
		}
	}
	result := b.String()
	// collapse whitespace runs to single "_"
	ws := regexp.MustCompile(`\s+`)
	result = ws.ReplaceAllString(result, "_")
	// collapse multiple underscores to one
	us := regexp.MustCompile(`_+`)
	result = us.ReplaceAllString(result, "_")
	if len(result) > maxLength {
		result = result[:maxLength]
	}
	result = strings.TrimRight(result, "_")
	return result
}

func GetTaskDir(downloadsDir, taskID string) (string, error) {
	absDL, err := filepath.Abs(downloadsDir)
	if err != nil {
		return "", err
	}
	absTask := filepath.Join(absDL, taskID)
	absTask, err = filepath.Abs(absTask)
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(absTask, absDL+string(filepath.Separator)) && absTask != absDL {
		return "", os.ErrInvalid
	}
	return absTask, nil
}

func CleanupOldTaskDirs(downloadsDir string, maxAge time.Duration) (int, error) {
	entries, err := os.ReadDir(downloadsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}
	cutoff := time.Now().Add(-maxAge)
	count := 0
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if info.ModTime().Before(cutoff) {
			if err := os.RemoveAll(filepath.Join(downloadsDir, e.Name())); err == nil {
				count++
			}
		}
	}
	return count, nil
}

func ParseDOIList(content string) []string {
	var doids []string
	sc := bufio.NewScanner(strings.NewReader(content))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		if cleaned, ok := CleanDOI(line); ok {
			doids = append(doids, cleaned)
		}
	}
	return doids
}

func CleanDOI(s string) (string, bool) {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "@")
	if idx := strings.LastIndex(s, "doi.org/"); idx != -1 {
		s = s[idx+len("doi.org/"):]
	}
	if strings.HasPrefix(s, "10.") {
		return s, true
	}
	return "", false
}
