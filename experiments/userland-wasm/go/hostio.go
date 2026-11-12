//go:build wasip1

package main

// The only door between the module and the host. Everything the shell reads or changes in the simulated world goes
// through `call`; nothing reaches the operating system (the WASI side has no preopened directories).

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

//go:wasmimport terrarium call
func hostCall(op uint32, in unsafe.Pointer, n uint32) int32

//go:wasmimport terrarium take
func hostTake(out unsafe.Pointer)

//go:wasmimport terrarium job
func hostJob() int32

const (
	opExec    = 1
	opStat    = 2
	opReadDir = 3
	opRead    = 4
	opWOpen   = 5
	opWrite   = 6
	opDone    = 7
)

// call sends a JSON header plus raw bytes and returns the JSON answer decoded into out plus the raw tail.
func call(op uint32, hdr any, raw []byte, out any) ([]byte, error) {
	h, err := json.Marshal(hdr)
	if err != nil {
		return nil, err
	}
	buf := make([]byte, 4+len(h)+len(raw))
	binary.LittleEndian.PutUint32(buf, uint32(len(h)))
	copy(buf[4:], h)
	copy(buf[4+len(h):], raw)
	n := hostCall(op, unsafe.Pointer(&buf[0]), uint32(len(buf)))
	if n < 4 {
		return nil, errors.New("host call failed")
	}
	resp := make([]byte, n)
	hostTake(unsafe.Pointer(&resp[0]))
	hl := binary.LittleEndian.Uint32(resp)
	if out != nil {
		if err := json.Unmarshal(resp[4:4+hl], out); err != nil {
			return nil, err
		}
	}
	return resp[4+hl:], nil
}

func readJob() (Job, error) {
	n := hostJob()
	buf := make([]byte, n)
	hostTake(unsafe.Pointer(&buf[0]))
	var j Job
	err := json.Unmarshal(buf, &j)
	return j, err
}

// errnoError prints like the C library's strerror, which is what the old fake shell printed ("Permission denied").
type errnoError string

func (e errnoError) Error() string { return string(e) }

var errnoText = map[string]error{
	"ENOENT":  errnoError("No such file or directory"),
	"EACCES":  errnoError("Permission denied"),
	"EROFS":   errnoError("Read-only file system"),
	"EISDIR":  errnoError("Is a directory"),
	"ENOTDIR": errnoError("Not a directory"),
	"EPERM":   errnoError("Operation not permitted"),
}

// pathErr builds the error the shell prints as `bash: <path>: <reason>`: the shell prints a *PathError as
// "<Op> <Path>: <Err>", so Op carries the "bash:" prefix.
func pathErr(path, errno string) error {
	e, ok := errnoText[errno]
	if !ok {
		e = errnoError(errno)
	}
	return &os.PathError{Op: "bash:", Path: path, Err: e}
}

type statResp struct {
	OK     bool    `json:"ok"`
	Errno  string  `json:"errno"`
	Type   string  `json:"type"`
	Mode   uint32  `json:"mode"`
	Size   int64   `json:"size"`
	MTime  float64 `json:"mtime"`
	Target string  `json:"target"`
	Name   string  `json:"name"`
}

type hostInfo struct{ s statResp }

func (h hostInfo) Name() string { return h.s.Name }
func (h hostInfo) Size() int64  { return h.s.Size }
func (h hostInfo) Mode() fs.FileMode {
	m := fs.FileMode(h.s.Mode & 0o777)
	switch h.s.Type {
	case "d":
		m |= fs.ModeDir
	case "l":
		m |= fs.ModeSymlink
	}
	return m
}
func (h hostInfo) ModTime() time.Time { return time.Unix(int64(h.s.MTime), 0).UTC() }
func (h hostInfo) IsDir() bool        { return h.s.Type == "d" }
func (h hostInfo) Sys() any           { return nil }

type hostEntry struct{ hostInfo }

func (e hostEntry) Type() fs.FileMode          { return e.Mode().Type() }
func (e hostEntry) Info() (fs.FileInfo, error) { return e.hostInfo, nil }

func hostStat(path string, follow bool) (statResp, error) {
	var r statResp
	if _, err := call(opStat, map[string]any{"path": path, "follow": follow}, nil, &r); err != nil {
		return r, err
	}
	if !r.OK {
		return r, pathErr(path, r.Errno)
	}
	if r.Name == "" {
		r.Name = path[strings.LastIndex(path, "/")+1:]
	}
	return r, nil
}

func hostReadDir(path string) ([]fs.DirEntry, error) {
	var r struct {
		OK      bool       `json:"ok"`
		Errno   string     `json:"errno"`
		Entries []statResp `json:"entries"`
	}
	if _, err := call(opReadDir, map[string]any{"path": path}, nil, &r); err != nil {
		return nil, err
	}
	if !r.OK {
		return nil, pathErr(path, r.Errno)
	}
	out := make([]fs.DirEntry, 0, len(r.Entries))
	for _, e := range r.Entries {
		out = append(out, hostEntry{hostInfo{e}})
	}
	return out, nil
}

func hostRead(path string) ([]byte, error) {
	var r struct {
		OK    bool   `json:"ok"`
		Errno string `json:"errno"`
	}
	raw, err := call(opRead, map[string]any{"path": path}, nil, &r)
	if err != nil {
		return nil, err
	}
	if !r.OK {
		return nil, pathErr(path, r.Errno)
	}
	return raw, nil
}

// hostWOpen asks whether `path` may be written (the same checks the old redirect did) and returns the error to print.
func hostWOpen(path string, appendMode bool) error {
	var r struct {
		OK    bool   `json:"ok"`
		Errno string `json:"errno"`
	}
	if _, err := call(opWOpen, map[string]any{"path": path, "append": appendMode}, nil, &r); err != nil {
		return err
	}
	if !r.OK {
		return pathErr(path, r.Errno)
	}
	return nil
}

func hostWrite(path string, data []byte, appendMode bool) error {
	var r struct {
		OK    bool   `json:"ok"`
		Errno string `json:"errno"`
	}
	if _, err := call(opWrite, map[string]any{"path": path, "append": appendMode}, data, &r); err != nil {
		return err
	}
	if !r.OK {
		return pathErr(path, r.Errno)
	}
	return nil
}

var _ = syscall.ENOENT
