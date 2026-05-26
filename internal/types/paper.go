package types

type Paper struct {
	Title         string `json:"title"`
	Journal       string `json:"journal"`
	Year          string `json:"year"`
	Authors       string `json:"authors"`
	DOI           string `json:"doi"`
	OpenAccessURL string `json:"openAccessUrl,omitempty"`
	Abstract      string `json:"abstract,omitempty"`
}

type DownloadSource string

const (
	SourceScihub      DownloadSource = "scihub"
	SourceAnnasArch   DownloadSource = "annas-archive"
	SourceLibgen      DownloadSource = "libgen"
	SourceUnpaywall   DownloadSource = "unpaywall"
	SourceOpenAlexOA  DownloadSource = "openalex-oa"
	SourceDOIDirect   DownloadSource = "doi-direct"
)

type DownloadResult struct {
	Success  bool           `json:"success"`
	Source   DownloadSource `json:"source,omitempty"`
	FilePath string         `json:"filePath,omitempty"`
	Error    string         `json:"error,omitempty"`
}

type FailedDownload struct {
	Paper             Paper            `json:"paper"`
	Error             string           `json:"error"`
	AttemptedSources  []DownloadSource `json:"attemptedSources"`
}
