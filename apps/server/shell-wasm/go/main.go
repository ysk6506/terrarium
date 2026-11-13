//go:build wasip1

// terrarium-sh: the shell language of the simulated machines. mvdan/sh parses and runs the line; every command that is
// not a shell builtin goes back to the host (the TypeScript commands that read and change the simulated world), except
// `awk` (goawk), `sleep`, `timeout` and `env`, which run inside the module. Files are the host's virtual file system;
// there is no other (ADR-0196, ADR-0200).
package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"strings"
	"time"

	"mvdan.cc/sh/v3/expand"
	"mvdan.cc/sh/v3/interp"
	"mvdan.cc/sh/v3/syntax"
)

// Limits are the only limits that decide a result: all of them count things (statements, bytes, simulated seconds), so
// the same line stops at the same place on every machine (ADR-0196 decision 2). Zero means no limit.
type Limits struct {
	Steps        int64   `json:"steps"`
	OutBytes     int64   `json:"outputBytes"`
	MemBytes     int64   `json:"memoryBytes"`
	WorldSeconds float64 `json:"worldSeconds"`
	Expansions   int64   `json:"expansions"`
}

// Job is one command line plus everything the shell may see of the machine.
type Job struct {
	Line   string   `json:"line"`
	Cwd    string   `json:"cwd"`
	Env    []string `json:"env"`
	Limits Limits   `json:"limits"`
	Seed   uint64   `json:"seed"`
}

var (
	job     Job
	started time.Time
)

func main() {
	var err error
	if job, err = readJob(); err != nil {
		os.Exit(3)
	}
	started = time.Now()
	setupLimits()
	var stdout, stderr bytes.Buffer
	code := run(&stdout, &stderr)
	hdr := map[string]any{
		"code": code, "outLen": stdout.Len(), "limit": bud.limit,
		"steps": bud.steps, "out": bud.out, "heap": bud.peakHeap, "t": elapsed(),
	}
	call(opDone, hdr, append(stdout.Bytes(), stderr.Bytes()...), nil)
}

// elapsed is the simulated time the line has used so far, in seconds: only sleeping moves the module's clock.
func elapsed() float64 { return float64(time.Since(started).Milliseconds()) / 1000 }

func run(stdout, stderr *bytes.Buffer) int {
	prog, err := syntax.NewParser(syntax.Variant(syntax.LangBash)).Parse(strings.NewReader(job.Line), "")
	if err != nil {
		fmt.Fprintln(stderr, bashSyntax(job.Line, err))
		return 2
	}
	out, errOut := limitWriter{stdout}, limitWriter{stderr}
	r, err := newRunner(nil, out, errOut, job.Cwd, nil, job.Env)
	if err != nil {
		fmt.Fprintf(stderr, "bash: %v\n", err)
		return 2
	}
	ctx := context.Background()
	if job.Seed != 0 {
		// $RANDOM is a sequence that depends on the situation and the number of the call, not on the machine
		if seed, perr := syntax.NewParser().Parse(strings.NewReader(fmt.Sprintf("RANDOM=%d", job.Seed%32768)), ""); perr == nil {
			r.Run(ctx, seed)
		}
	}
	err = r.Run(ctx, prog)
	interp.BgWait() // a background job the line did not wait for still finishes (in its turn)
	return statusOf(err, stderr)
}

func statusOf(err error, stderr io.Writer) int {
	var es interp.ExitStatus
	switch {
	case bud.limit != "":
		return 124 // like `timeout`: the line was stopped because it used too much; the host says what
	case err == nil:
		return 0
	case errors.As(err, &es):
		return int(es)
	default:
		fmt.Fprintf(stderr, "bash: %v\n", err)
		return 1
	}
}

// newRunner makes a shell whose commands, files and directories are the host's. `params` are the positional parameters.
func newRunner(stdin io.Reader, stdout, stderr io.Writer, dir string, params []string, env []string) (*interp.Runner, error) {
	setDir := func(r *interp.Runner) error { r.Dir = dir; return nil }
	opts := []interp.RunnerOption{
		interp.Env(expand.ListEnviron(env...)),
		setDir,
		interp.StdIO(stdin, stdout, stderr),
		interp.CallHandler(func(ctx context.Context, args []string) ([]string, error) { return reroute(args), nil }),
		interp.ExecHandlers(func(next interp.ExecHandlerFunc) interp.ExecHandlerFunc {
			return func(ctx context.Context, args []string) error { return execHandler(ctx, args) }
		}),
		interp.OpenHandler(openHandler),
		interp.ReadDirHandler2(func(ctx context.Context, p string) ([]fs.DirEntry, error) { return hostReadDir(p) }),
		interp.StatHandler(func(ctx context.Context, name string, follow bool) (fs.FileInfo, error) {
			s, err := hostStat(name, follow)
			if err != nil {
				return nil, err
			}
			return hostInfo{s}, nil
		}),
	}
	if params != nil {
		opts = append(opts, interp.Params(params...))
	}
	return interp.New(opts...)
}

// runNested runs `code` in a new shell inside this one (sh -c, awk's system()): same host, same budget.
func runNested(ctx context.Context, code string, params []string, stdin io.Reader, stdout, stderr io.Writer, dir string, env []string) int {
	prog, err := syntax.NewParser(syntax.Variant(syntax.LangBash)).Parse(strings.NewReader(code), "")
	if err != nil {
		fmt.Fprintln(stderr, bashSyntax(code, err))
		return 2
	}
	r, err := newRunner(stdin, stdout, stderr, dir, params, env)
	if err != nil {
		fmt.Fprintf(stderr, "bash: %v\n", err)
		return 2
	}
	return statusOf(r.Run(ctx, prog), stderr)
}
