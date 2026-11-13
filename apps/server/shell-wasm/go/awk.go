//go:build wasip1

package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"io/fs"
	"path"
	"regexp"
	"strings"

	"github.com/benhoyt/goawk/interp"
	"github.com/benhoyt/goawk/parser"
	shinterp "mvdan.cc/sh/v3/interp"
)

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

// gawkOnly is what GNU awk has and goawk does not (the ones a script uses by name). Running such a script on goawk
// would give a wrong answer or a confusing error, so the line stops and says that it is the simulation's limit.
var (
	gawkFunc = regexp.MustCompile(`\b(gensub|strftime|systime|mktime|asort|asorti|patsplit|strtonum|and|or|xor|lshift|rshift|compl|isarray|typeof|mkbool)\s*\(`)
	gawkVar  = regexp.MustCompile(`\b(IGNORECASE|PROCINFO|FPAT|FIELDWIDTHS|RT|BINMODE|ERRNO|TEXTDOMAIN|ARGIND|LINT|ROUNDMODE|RS_STRING)\b`)
	gawkWord = regexp.MustCompile(`(^|[^A-Za-z0-9_$])(BEGINFILE|ENDFILE|switch|@include|@load|@namespace)\b`)
	gawkPipe = regexp.MustCompile(`\|&`)
	awkStr   = regexp.MustCompile(`"(\\.|[^"\\])*"`)
	awkCmt   = regexp.MustCompile(`#[^\n]*`)
)

// gawkExtension names the first gawk-only feature a program uses, as the gap's key and its words.
func gawkExtension(src string) (feature, what string) {
	bare := awkCmt.ReplaceAllString(awkStr.ReplaceAllString(src, `""`), "")
	if m := gawkFunc.FindStringSubmatch(bare); m != nil {
		return "function:" + m[1], m[1] + "()"
	}
	if m := gawkWord.FindStringSubmatch(bare); m != nil {
		return m[2], m[2]
	}
	if m := gawkVar.FindStringSubmatch(bare); m != nil {
		return "variable:" + m[1], m[1] + " 변수"
	}
	if gawkPipe.MatchString(bare) {
		return "coprocess", "|&"
	}
	return "", ""
}

// runAwk is the `awk` command: [-F fs] [-v var=value]... [-f progfile]... [--] ['program'] [file...].
func runAwk(ctx context.Context, hc shinterp.HandlerContext, args, env []string, stdin []byte) error {
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
			noteGap(hc, "awk", "flag:"+strings.SplitN(a, "=", 2)[0], strings.SplitN(a, "=", 2)[0])
			return shinterp.ExitStatus(2)
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
			noteGap(hc, "awk", "flag:"+a[:2], a[:2])
			return shinterp.ExitStatus(2)
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
	src := strings.Join(progSrc, "\n")
	if feature, what := gawkExtension(src); feature != "" {
		noteGap(hc, "awk", feature, what)
		return shinterp.ExitStatus(2)
	}
	prog, err := parser.ParseProgram([]byte(src), nil)
	if err != nil {
		fmt.Fprintf(hc.Stderr, "awk: %v\n", err)
		return shinterp.ExitStatus(2)
	}
	cfg := &interp.Config{
		Stdin:      bytes.NewReader(stdin),
		Output:     hc.Stdout,
		Error:      hc.Stderr,
		Args:       rest,
		Vars:       vars,
		Environ:    envPairs(env),
		FileSystem: awkFS{hc.Dir},
		Chars:      true, // the machines run with a UTF-8 locale: lengths and positions count characters
	}
	if fsep != "" {
		if fsep == "t" {
			fsep = "\t"
		}
		cfg.Vars = append([]string{"FS", unescape(fsep)}, cfg.Vars...)
	}
	interp.ShellHook = func(code string, in io.Reader, out, errOut io.Writer) int {
		return runNested(ctx, code, nil, in, out, errOut, hc.Dir, env)
	}
	status, err := interp.ExecProgram(prog, cfg)
	if bud.limit != "" {
		return errLimit
	}
	if err != nil {
		fmt.Fprintf(hc.Stderr, "awk: %v\n", err)
		return shinterp.ExitStatus(2)
	}
	if status != 0 {
		return shinterp.ExitStatus(status)
	}
	return nil
}

// envPairs is ENVIRON's list: name, value, name, value.
func envPairs(env []string) []string {
	out := make([]string, 0, 2*len(env))
	for _, kv := range env {
		k, v, _ := strings.Cut(kv, "=")
		out = append(out, k, v)
	}
	return out
}
