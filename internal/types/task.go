package types

import "time"

type TaskState string

const (
	TaskPending    TaskState = "pending"
	TaskProcessing TaskState = "processing"
	TaskComplete   TaskState = "complete"
	TaskError      TaskState = "error"
)

type TaskStatus struct {
	ID               string    `json:"id"`
	Status           TaskState `json:"status"`
	Progress         int       `json:"progress"`
	Message          string    `json:"message"`
	TotalPapers      int       `json:"totalPapers"`
	PapersFound      int       `json:"papersFound"`
	PapersDownloaded int       `json:"papersDownloaded"`
	CurrentCycle     int       `json:"currentCycle"`
	TotalCycles      int       `json:"totalCycles"`
	Err              string    `json:"error,omitempty"`
	DownloadURL      string    `json:"downloadUrl,omitempty"`
	MetadataURL      string    `json:"metadataUrl,omitempty"`
	LastUpdate       time.Time `json:"lastUpdate"`
}

func (t *TaskStatus) GetID() string                 { return t.ID }
func (t *TaskStatus) GetStatus() TaskState          { return t.Status }
func (t *TaskStatus) GetLastUpdate() time.Time      { return t.LastUpdate }
