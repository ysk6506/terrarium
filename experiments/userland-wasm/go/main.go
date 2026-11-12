//go:build wasip1

// terrarium-sh: the shell language of the simulated machines. mvdan/sh parses and runs the line; every command that is
// not a shell builtin goes back to the host (the TypeScript commands that read and change the simulated world), except
// `awk`, which runs inside the module (goawk). Files are the host's virtual file system; there is no other.
package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"strings"

	"mvdan.cc/sh/v3/expand"
	"mvdan.cc/sh/v3/interp"
	"mvdan.cc/sh/v3/syntax"
)

// Job is one command line plus everything the shell may see of the machine.
type Job struct {
	Line     string   `json:"line"`
	Cwd      string   `json:"cwd"`
	Env      []string `json:"env"`
	MaxSteps int      `json:"maxSteps"`
	MaxOut   int      `json:"maxOut"`
	Awk      string   `json:"awk"` // "go" runs goawk in the module, "ts" sends awk to the host like any command
	Seed     uint64   `json:"seed"`
}

type budget struct {
	steps, maxSteps int
	out, maxOut     int
	exceeded        string
}

// limitWriter counts what a stream carries and refuses more once the output budget is spent.
type limitWriter struct {
	w *bytes.Buffer
	b *budget
}

func (l limitWriter) Write(p []byte) (int, error) {
	if l.b.maxOut > 0 && l.b.out+len(p) > l.b.maxOut {
		l.b.exceeded = "output"
		return 0, io.ErrClosedPipe
	}
	l.b.out += len(p)
	return l.w.Write(p)
}

func main() {
	job, err := readJob()
	if err != nil {
		os.Exit(3)
	}
	var stdout, stderr bytes.Buffer
	b := &budget{maxSteps: job.MaxSteps, maxOut: job.MaxOut}
	code := run(job, b, &stdout, &stderr)
	hdr := map[string]any{"code": code, "outLen": stdout.Len(), "budget": b.exceeded}
	call(opDone, hdr, append(stdout.Bytes(), stderr.Bytes()...), nil)
}

func run(job Job, b *budget, stdout, stderr *bytes.Buffer) int {
	p := syntax.NewParser(syntax.Variant(syntax.LangBash))
	prog, err := p.Parse(strings.NewReader(job.Line), "")
	if err != nil {
		fmt.Fprintln(stderr, bashSyntax(job.Line, err))
		return 2
	}
	r, err := newRunner(job, b, nil, limitWriter{stdout, b}, limitWriter{stderr, b}, job.Cwd, nil)
	if err != nil {
		fmt.Fprintf(stderr, "bash: %v\n", err)
		return 2
	}
	ctx := context.Background()
	if job.Seed != 0 {
		if seed, perr := syntax.NewParser().Parse(strings.NewReader(fmt.Sprintf("RANDOM=%d", job.Seed%32768)), ""); perr == nil {
			r.Run(ctx, seed)
		}
	}
	err = r.Run(ctx, prog)
	return statusOf(err, b, stderr)
}

func statusOf(err error, b *budget, stderr io.Writer) int {
	var es interp.ExitStatus
	switch {
	case err == nil:
		return 0
	case errors.As(err, &es):
		return int(es)
	default:
		fmt.Fprintf(stderr, "bash: %v\n", err)
		if b.exceeded != "" {
			return 124
		}
		return 1
	}
}

// newRunner makes a shell whose commands, files and directories are the host's. `params` are the positional parameters.
func newRunner(job Job, b *budget, stdin io.Reader, stdout, stderr io.Writer, dir string, params []string) (*interp.Runner, error) {
	setDir := func(r *interp.Runner) error { r.Dir = dir; return nil }
	opts := []interp.RunnerOption{
		interp.Env(expand.ListEnviron(job.Env...)),
		setDir,
		interp.StdIO(stdin, stdout, stderr),
		interp.CallHandler(func(ctx context.Context, args []string) ([]string, error) {
			b.steps++
			if b.maxSteps > 0 && b.steps > b.maxSteps {
				b.exceeded = "steps"
				return nil, errors.New("step budget exceeded")
			}
			return reroute(args), nil
		}),
		interp.ExecHandlers(func(next interp.ExecHandlerFunc) interp.ExecHandlerFunc {
			return func(ctx context.Context, args []string) error { return execHandler(ctx, job, b, args) }
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
func runNested(ctx context.Context, job Job, b *budget, code string, params []string, stdin io.Reader, stdout, stderr io.Writer, dir string) int {
	prog, err := syntax.NewParser(syntax.Variant(syntax.LangBash)).Parse(strings.NewReader(code), "")
	if err != nil {
		fmt.Fprintln(stderr, bashSyntax(code, err))
		return 2
	}
	r, err := newRunner(job, b, stdin, stdout, stderr, dir, params)
	if err != nil {
		fmt.Fprintf(stderr, "bash: %v\n", err)
		return 2
	}
	return statusOf(r.Run(ctx, prog), b, stderr)
}

// reroute sends the few shell builtins that would act on the module's own empty world (not the simulated machine) to
// the host: `kill` must stop a process of the machine, `command -v` and `type` must see the machine's commands.
func reroute(args []string) []string {
	out := append([]string(nil), args...)
	switch args[0] {
	case "printf":
		// the module's printf has no width/precision for %f and friends; the hand-written one matches GNU on those
		out[0] = "\x00printf"
	case "echo":
		// bash takes combined flags (-en); the module's echo takes them one by one
		if len(args) > 1 && len(args[1]) > 2 && strings.Trim(args[1][1:], "neE") == "" && args[1][0] == '-' {
			out[0] = "\x00echo"
		}
	case "cd":
		if msg := cdProblem(args); msg != "" {
			return []string{"\x00cdfail", msg}
		}
	case "kill":
		out[0] = "\x00kill"
	case "type":
		out[0] = "\x00type"
	case "command":
		if len(args) > 1 && (args[1] == "-v" || args[1] == "-V") {
			out = append([]string{"\x00command-v"}, args[2:]...)
		}
	}
	return out
}

// cdProblem returns bash's message when `cd` cannot go where it is told (the module's own wording differs).
func cdProblem(args []string) string {
	if len(args) < 2 || args[1] == "-" || strings.HasPrefix(args[1], "-") {
		return ""
	}
	target := args[1]
	if !path.IsAbs(target) {
		return "" // relative targets are resolved by the module, which knows the directory
	}
	s, err := hostStat(path.Clean(target), true)
	if err != nil {
		return "bash: cd: " + target + ": No such file or directory"
	}
	if s.Type != "d" {
		return "bash: cd: " + target + ": Not a directory"
	}
	return ""
}

// bashSyntax words a parse error the way bash does (`bash: syntax error near unexpected token ...`).
func bashSyntax(line string, err error) string {
	msg := err.Error()
	if i := strings.Index(msg, "reached EOF without closing quote `"); i >= 0 {
		q := msg[i+len("reached EOF without closing quote `"):]
		return "bash: unexpected EOF while looking for matching `" + q[:1] + "'"
	}
	var pe syntax.ParseError
	token := ""
	if i := strings.Index(msg, "`"); i >= 0 {
		if j := strings.Index(msg[i+1:], "`"); j >= 0 {
			token = msg[i+1 : i+1+j]
		}
	}
	if strings.Contains(msg, "must be followed by") && errors.As(err, &pe) && token != "" {
		rest := ""
		if col := int(pe.Pos.Col()) - 1 + len(token); pe.Pos.Line() == 1 && col <= len(line) {
			rest = strings.TrimSpace(line[col:])
		}
		if rest == "" {
			token = "newline"
		} else {
			token = strings.TrimRight(rest[:1+strings.IndexAny(rest[1:]+" ", " \t")], " ")
			for _, op := range []string{"&&", "||", ";;", "|", ";", "&", ")", "("} {
				if strings.HasPrefix(rest, op) {
					token = op
					break
				}
			}
		}
	}
	if token == "" {
		return "bash: " + msg
	}
	return "bash: syntax error near unexpected token `" + token + "'"
}

// execHandler runs one command that is not a shell builtin or function.
func execHandler(ctx context.Context, job Job, b *budget, args []string) error {
	hc := interp.HandlerCtx(ctx)
	if args[0] == "\x00cdfail" {
		fmt.Fprintln(hc.Stderr, args[1])
		return interp.ExitStatus(1)
	}
	var in []byte
	if hc.Stdin != nil {
		in, _ = io.ReadAll(hc.Stdin)
	}
	if args[0] == "awk" && job.Awk == "go" {
		// a program goawk cannot parse (gensub, an option it does not know) goes to the host awk, which answers
		// with its result or with the emulation-gap lines of ADR-0184
		if err := runAwk(ctx, job, b, hc, args[1:], in); !errors.Is(err, errAwkFallback) {
			return err
		}
	}
	if args[0] == "sh" || args[0] == "bash" {
		return runSh(ctx, job, b, hc, args[1:], in)
	}
	var r struct {
		Code   int `json:"code"`
		OutLen int `json:"outLen"`
	}
	raw, err := call(opExec, map[string]any{"argv": args, "cwd": hc.Dir}, in, &r)
	if err != nil {
		return err
	}
	hc.Stdout.Write(raw[:r.OutLen])
	hc.Stderr.Write(raw[r.OutLen:])
	if r.Code != 0 {
		return interp.ExitStatus(r.Code)
	}
	return nil
}

type memFile struct {
	*bytes.Reader
}

func (memFile) Write([]byte) (int, error) { return 0, io.ErrClosedPipe }
func (memFile) Close() error              { return nil }

type outFile struct {
	path       string
	appendMode bool
	buf        bytes.Buffer
	closed     bool
}

func (o *outFile) Read([]byte) (int, error) { return 0, io.EOF }
func (o *outFile) Write(p []byte) (int, error) {
	return o.buf.Write(p)
}
func (o *outFile) Close() error {
	if o.closed {
		return nil
	}
	o.closed = true
	return hostWrite(o.path, o.buf.Bytes(), o.appendMode)
}

type nullFile struct{}

func (nullFile) Read([]byte) (int, error)    { return 0, io.EOF }
func (nullFile) Write(p []byte) (int, error) { return len(p), nil }
func (nullFile) Close() error                { return nil }

func openHandler(ctx context.Context, p string, flag int, perm os.FileMode) (io.ReadWriteCloser, error) {
	hc := interp.HandlerCtx(ctx)
	if p != "" && !path.IsAbs(p) {
		p = path.Join(hc.Dir, p)
	}
	p = path.Clean(p)
	if p == "/dev/null" {
		return nullFile{}, nil
	}
	if flag&(os.O_WRONLY|os.O_RDWR) != 0 {
		appendMode := flag&os.O_APPEND != 0
		if err := hostWOpen(p, appendMode); err != nil {
			return nil, err
		}
		return &outFile{path: p, appendMode: appendMode}, nil
	}
	data, err := hostRead(p)
	if err != nil {
		return nil, err
	}
	return memFile{bytes.NewReader(data)}, nil
}

var _ = binary.LittleEndian

// runSh is `sh -c 'code' [name [args...]]` and `sh script [args...]`.
func runSh(ctx context.Context, job Job, b *budget, hc interp.HandlerContext, args []string, stdin []byte) error {
	for len(args) > 0 && strings.HasPrefix(args[0], "-") && args[0] != "-c" {
		args = args[1:]
	}
	var code string
	var params []string
	switch {
	case len(args) >= 2 && args[0] == "-c":
		code = args[1]
		params = args[2:]
	case len(args) >= 1 && args[0] != "-c":
		data, err := hostRead(path.Join(hc.Dir, args[0]))
		if err != nil {
			fmt.Fprintf(hc.Stderr, "bash: %s: No such file or directory\n", args[0])
			return interp.ExitStatus(127)
		}
		code, params = string(data), args[1:]
	default:
		code = string(stdin)
	}
	if len(params) > 0 {
		params = params[1:] // $0 is not a positional parameter
	}
	if st := runNested(ctx, job, b, code, params, bytes.NewReader(stdin), hc.Stdout, hc.Stderr, hc.Dir); st != 0 {
		return interp.ExitStatus(st)
	}
	return nil
}
