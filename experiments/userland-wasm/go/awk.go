//go:build wasip1

package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"path"
	"strings"

	"github.com/benhoyt/goawk/interp"
	"github.com/benhoyt/goawk/parser"
	shinterp "mvdan.cc/sh/v3/interp"
)

var errAwkFallback = errors.New("awk: handled by the host")

// awkFS gives goawk the host's virtual file system for `getline < file`, input files and `print > file`.
type awkFS struct{ cwd string }

func (a awkFS) abs(name string) string {
	if !path.IsAbs(name) {
		name = path.Join(a.cwd, name)
	}
	return path.Clean(name)
}

type awkFile struct {
	*bytes.Reader
	name string
}

func (f awkFile) Close() error { return nil }
func (f awkFile) Stat() (fs.FileInfo, error) {
	return hostInfo{statResp{Name: f.name, Size: int64(f.Len()), Type: "f", Mode: 0o644}}, nil
}

func (a awkFS) Open(name string) (fs.File, error) {
	p := a.abs(name)
	if p == "/dev/null" {
		return awkFile{bytes.NewReader(nil), "null"}, nil
	}
	data, err := hostRead(p)
	if err != nil {
		return nil, err
	}
	return awkFile{bytes.NewReader(data), path.Base(p)}, nil
}

func (a awkFS) Create(name string) (io.WriteCloser, error) { return a.open(name, false) }
func (a awkFS) Append(name string) (io.WriteCloser, error) { return a.open(name, true) }

func (a awkFS) open(name string, appendMode bool) (io.WriteCloser, error) {
	p := a.abs(name)
	if p == "/dev/null" {
		return nullFile{}, nil
	}
	if err := hostWOpen(p, appendMode); err != nil {
		return nil, err
	}
	return &outFile{path: p, appendMode: appendMode}, nil
}

// runAwk is the `awk` command: [-F fs] [-v var=value]... [-f progfile]... [--] ['program'] [file...].
func runAwk(ctx context.Context, job Job, b *budget, hc shinterp.HandlerContext, args []string, stdin []byte) error {
	var (
		fsep    string
		vars    []string
		progSrc []string
		haveF   bool
	)
	i := 0
	for ; i < len(args); i++ {
		a := args[i]
		if a == "--" {
			i++
			break
		}
		if len(a) < 2 || a[0] != '-' {
			break
		}
		take := func(flag string) string {
			if a == flag {
				if i+1 >= len(args) {
					return ""
				}
				i++
				return args[i]
			}
			return a[len(flag):]
		}
		switch {
		case strings.HasPrefix(a, "--assign="):
			k, val, _ := strings.Cut(strings.TrimPrefix(a, "--assign="), "=")
			vars = append(vars, k, unescape(val))
		case strings.HasPrefix(a, "--field-separator="):
			fsep = strings.TrimPrefix(a, "--field-separator=")
		case strings.HasPrefix(a, "--"):
			return errAwkFallback
		case strings.HasPrefix(a, "-F"):
			fsep = take("-F")
		case strings.HasPrefix(a, "-v"):
			v := take("-v")
			k, val, ok := strings.Cut(v, "=")
			if !ok {
				fmt.Fprintf(hc.Stderr, "awk: invalid -v argument: %s\n", v)
				return shinterp.ExitStatus(2)
			}
			vars = append(vars, k, unescape(val))
		case strings.HasPrefix(a, "-f"):
			v := take("-f")
			data, err := hostRead(awkFS{hc.Dir}.abs(v))
			if err != nil {
				fmt.Fprintf(hc.Stderr, "awk: can't open file %s\n", v)
				return shinterp.ExitStatus(2)
			}
			progSrc = append(progSrc, string(data))
			haveF = true
		default:
			return errAwkFallback
		}
	}
	rest := args[i:]
	if !haveF {
		if len(rest) == 0 {
			fmt.Fprintln(hc.Stderr, "usage: awk [-F fs][-v var=value][prog | -f progfile][file ...]")
			return shinterp.ExitStatus(2)
		}
		progSrc = []string{rest[0]}
		rest = rest[1:]
	}
	prog, err := parser.ParseProgram([]byte(strings.Join(progSrc, "\n")), nil)
	if err != nil {
		return errAwkFallback
	}
	cfg := &interp.Config{
		Stdin:      bytes.NewReader(stdin),
		Output:     hc.Stdout,
		Error:      hc.Stderr,
		Args:       rest,
		Vars:       vars,
		Environ:    []string{},
		FileSystem: awkFS{hc.Dir},
	}
	if fsep != "" {
		if fsep == "t" {
			fsep = "\t"
		}
		cfg.Vars = append([]string{"FS", unescape(fsep)}, cfg.Vars...)
	}
	interp.ShellHook = func(code string, in io.Reader, out, errOut io.Writer) int {
		return runNested(ctx, job, b, code, nil, in, out, errOut, hc.Dir)
	}
	status, err := interp.ExecProgram(prog, cfg)
	if err != nil {
		fmt.Fprintf(hc.Stderr, "awk: %v\n", err)
		return shinterp.ExitStatus(2)
	}
	if status != 0 {
		return shinterp.ExitStatus(status)
	}
	return nil
}
