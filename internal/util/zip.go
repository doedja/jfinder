package util

import (
	"archive/zip"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// CreateTaskZip creates <taskDir>/<taskID>.zip containing details.txt,
// failed_downloads.txt (if present) and all *.pdf files under <taskDir>/papers/.
func CreateTaskZip(taskDir, taskID string) (string, error) {
	zipPath := filepath.Join(taskDir, taskID+".zip")
	out, err := os.Create(zipPath)
	if err != nil {
		return "", err
	}
	defer out.Close()

	zw := zip.NewWriter(out)
	defer zw.Close()

	for _, name := range []string{"details.txt", "failed_downloads.txt"} {
		src := filepath.Join(taskDir, name)
		if _, err := os.Stat(src); err == nil {
			if err := addFileToZip(zw, name, src); err != nil {
				return "", err
			}
		}
	}

	papersDir := filepath.Join(taskDir, "papers")
	entries, err := os.ReadDir(papersDir)
	if err == nil {
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			if !strings.HasSuffix(strings.ToLower(e.Name()), ".pdf") {
				continue
			}
			src := filepath.Join(papersDir, e.Name())
			arc := "papers/" + e.Name()
			if err := addFileToZip(zw, arc, src); err != nil {
				return "", err
			}
		}
	}

	return zipPath, nil
}

func addFileToZip(zw *zip.Writer, archiveName, src string) error {
	fi, err := os.Stat(src)
	if err != nil {
		return err
	}
	hdr, err := zip.FileInfoHeader(fi)
	if err != nil {
		return err
	}
	hdr.Name = archiveName
	hdr.Method = zip.Deflate
	w, err := zw.CreateHeader(hdr)
	if err != nil {
		return err
	}
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(w, f)
	return err
}
