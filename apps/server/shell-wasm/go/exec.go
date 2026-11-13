//go:build wasip1

package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"

	"mvdan.cc/sh/v3/expand"
	"mvdan.cc/sh/v3/interp"
	"mvdan.cc/sh/v3/syntax"
)

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

// exportedEnv is the environment a child gets: the login environment in its own order, then what the line exported.
func exportedEnv(env expand.Environ) []string {
	rank := map[string]int{}
	for i, kv := range job.Env {
		rank[strings.SplitN(kv, "=", 2)[0]] = i + 1
	}
	var names []string
	vals := map[string]string{}
	env.Each(func(name string, vr expand.Variable) bool {
		if vr.Exported && vr.Kind == expand.String && vr.IsSet() {
			names = append(names, name)
			vals[name] = vr.Str
		}
		return true
	})
	sort.Slice(names, func(i, j int) bool {
		ri, rj := rank[names[i]], rank[names[j]]
		if (ri == 0) != (rj == 0) {
			return ri != 0
		}
		if ri != rj {
			return ri < rj
		}
		return names[i] < names[j]
	})
	out := make([]string, len(names))
	for i, n := range names {
		out[i] = n + "=" + vals[n]
	}
	return out
}

// readInput reads what a command is given on its standard input. A source that does not end (`/dev/zero`, `yes`) is a
// source the commands of the simulation cannot take whole: it counts as a flood of output.
func readInput(r io.Reader) ([]byte, error) {
	if r == nil {
		return nil, nil
	}
	cap := job.Limits.OutBytes
	if cap < 8<<20 {
		cap = 8 << 20
	}
	data, err := io.ReadAll(io.LimitReader(r, cap+1))
	if err != nil {
		return data, err
	}
	if int64(len(data)) > cap {
		return nil, trip("output")
	}
	return data, nil
}

// execHandler runs one command that is not a shell builtin or function.
func execHandler(ctx context.Context, args []string) error {
	hc := interp.HandlerCtx(ctx)
	if args[0] == "\x00cdfail" {
		fmt.Fprintln(hc.Stderr, args[1])
		return interp.ExitStatus(1)
	}
	in, err := readInput(hc.Stdin)
	if err != nil {
		return err
	}
	return dispatch(ctx, hc, args, exportedEnv(hc.Env), in)
}

// engineNames are the commands the module runs itself because they need its clock or its environment.
var engineNames = map[string]bool{"sleep": true, "timeout": true, "env": true, "printenv": true, "nohup": true}

// dispatch runs a command by name: inside the module when it needs the module's own state (the clock, the
// environment), in the host otherwise.
func dispatch(ctx context.Context, hc interp.HandlerContext, args, env []string, in []byte) error {
	name := args[0]
	// a command given by path: the directories of the usual commands lead to the same command
	if strings.HasPrefix(name, "/usr/") || strings.HasPrefix(name, "/bin/") || strings.HasPrefix(name, "/sbin/") {
		if dir, base := path.Split(name); base != "" && strings.Count(strings.Trim(dir, "/"), "/") <= 2 {
			name = base
		}
	}
	// an endless source read to its end by a command of the machine is a flood of output, not an empty file
	for _, a := range args[1:] {
		if a == "/dev/zero" || a == "/dev/urandom" || a == "/dev/random" {
			if !engineNames[name] && name != "awk" {
				return trip("output")
			}
		}
	}
	switch {
	case name == "awk":
		return runAwk(ctx, hc, args[1:], env, in)
	case name == "sh" || name == "bash":
		return runSh(ctx, hc, args[1:], env, in)
	case engineNames[name]:
		return runOwn(ctx, hc, name, args[1:], env, in)
	}
	return runHost(hc, args, env, in)
}

// runHost sends a command to the simulated machine and relays what it printed.
func runHost(hc interp.HandlerContext, args, env []string, in []byte) error {
	var r struct {
		Code   int `json:"code"`
		OutLen int `json:"outLen"`
	}
	raw, err := call(opExec, map[string]any{"argv": args, "cwd": hc.Dir, "env": env}, in, &r)
	if err != nil {
		return err
	}
	if r.OutLen > len(raw) {
		r.OutLen = len(raw)
	}
	if _, err := hc.Stdout.Write(raw[:r.OutLen]); err != nil {
		return errLimit
	}
	if _, err := hc.Stderr.Write(raw[r.OutLen:]); err != nil {
		return errLimit
	}
	if bud.limit != "" {
		return errLimit
	}
	if r.Code != 0 {
		return interp.ExitStatus(r.Code)
	}
	return nil
}

// runSh is `sh -c 'code' [name [args...]]` and `sh script [args...]`.
func runSh(ctx context.Context, hc interp.HandlerContext, args, env []string, stdin []byte) error {
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
	if st := runNested(ctx, code, params, bytes.NewReader(stdin), hc.Stdout, hc.Stderr, hc.Dir, env); st != 0 {
		return interp.ExitStatus(st)
	}
	return nil
}

// ── sleep, timeout, env: the commands that need the module's clock and environment ──────────────────────────────────

func runOwn(ctx context.Context, hc interp.HandlerContext, name string, args, env []string, in []byte) error {
	switch name {
	case "sleep":
		return cmdSleep(ctx, hc, args)
	case "timeout":
		return cmdTimeout(ctx, hc, args, env, in)
	case "env":
		return cmdEnv(ctx, hc, args, env, in)
	case "printenv":
		return cmdPrintenv(hc, args, env)
	default: // nohup: output is not redirected when it is not a terminal, and nothing hangs up
		if len(args) == 0 {
			fmt.Fprintln(hc.Stderr, "nohup: missing operand\nTry 'nohup --help' for more information.")
			return interp.ExitStatus(125)
		}
		return dispatch(ctx, hc, args, env, in)
	}
}

// parseInterval reads a GNU time interval: a number with an optional suffix s, m, h or d (`inf` never ends).
func parseInterval(s string) (time.Duration, bool) {
	if s == "inf" || s == "infinity" {
		return time.Duration(1<<62 - 1), true
	}
	mult := 1.0
	if n := len(s); n > 0 {
		switch s[n-1] {
		case 's':
			s = s[:n-1]
		case 'm':
			mult, s = 60, s[:n-1]
		case 'h':
			mult, s = 3600, s[:n-1]
		case 'd':
			mult, s = 86400, s[:n-1]
		}
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil || f < 0 || s == "" || strings.ContainsAny(s, "xXnN") {
		return 0, false
	}
	return time.Duration(f * mult * float64(time.Second)), true
}

func cmdSleep(ctx context.Context, hc interp.HandlerContext, args []string) error {
	if len(args) == 0 {
		fmt.Fprint(hc.Stderr, "sleep: missing operand\nTry 'sleep --help' for more information.\n")
		return interp.ExitStatus(1)
	}
	var total time.Duration
	for _, a := range args {
		d, ok := parseInterval(a)
		if !ok {
			fmt.Fprintf(hc.Stderr, "sleep: invalid time interval ‘%s’\nTry 'sleep --help' for more information.\n", a)
			return interp.ExitStatus(1)
		}
		total += d
	}
	return passTime(ctx, hc, total)
}

// passTime lets simulated time go by: the module's clock moves, and the host moves the world with it before it
// answers the next question (an `until … do sleep 1; done` loop sees the world change). A line can use only as much
// world time as one `wait` may (and the run has left); asking for more uses what is left and stops the line.
func passTime(ctx context.Context, hc interp.HandlerContext, d time.Duration) error {
	left := time.Duration((job.Limits.WorldSeconds - elapsed()) * float64(time.Second))
	if job.Limits.WorldSeconds <= 0 || left <= 0 {
		noteGap(hc, "shell", "sleep", "sleep")
		return nil // the world cannot be moved from here: the call returns at once, and says so
	}
	over := d > left
	if over {
		d = left
	}
	t := time.NewTimer(d)
	select {
	case <-t.C:
	case <-ctx.Done():
		t.Stop()
		return nil
	}
	if over {
		return trip("time")
	}
	return nil
}

func cmdTimeout(ctx context.Context, hc interp.HandlerContext, args, env []string, in []byte) error {
	var kill time.Duration
	verbose, preserve := false, false
	i := 0
loop:
	for ; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "--":
			i++
			break loop
		case a == "-v" || a == "--verbose":
			verbose = true
		case a == "--preserve-status":
			preserve = true
		case a == "--foreground":
		case a == "-s" || a == "--signal":
			i++
		case strings.HasPrefix(a, "--signal=") || (strings.HasPrefix(a, "-s") && len(a) > 2):
		case a == "-k" || strings.HasPrefix(a, "--kill-after"):
			v := strings.TrimPrefix(a, "--kill-after=")
			if a == "-k" || a == "--kill-after" {
				i++
				if i < len(args) {
					v = args[i]
				}
			}
			d, ok := parseInterval(v)
			if !ok {
				fmt.Fprintf(hc.Stderr, "timeout: invalid time interval ‘%s’\nTry 'timeout --help' for more information.\n", v)
				return interp.ExitStatus(125)
			}
			kill = d
		case strings.HasPrefix(a, "-k") && len(a) > 2:
			d, ok := parseInterval(a[2:])
			if !ok {
				fmt.Fprintf(hc.Stderr, "timeout: invalid time interval ‘%s’\nTry 'timeout --help' for more information.\n", a[2:])
				return interp.ExitStatus(125)
			}
			kill = d
		case strings.HasPrefix(a, "-") && len(a) > 1:
			fmt.Fprintf(hc.Stderr, "timeout: invalid option -- '%s'\nTry 'timeout --help' for more information.\n", strings.TrimLeft(a, "-"))
			return interp.ExitStatus(125)
		default:
			break loop
		}
	}
	if len(args)-i < 2 {
		fmt.Fprint(hc.Stderr, "timeout: missing operand\nTry 'timeout --help' for more information.\n")
		return interp.ExitStatus(125)
	}
	dur, ok := parseInterval(args[i])
	if !ok {
		fmt.Fprintf(hc.Stderr, "timeout: invalid time interval ‘%s’\nTry 'timeout --help' for more information.\n", args[i])
		return interp.ExitStatus(125)
	}
	cmd := args[i+1:]
	tctx, cancel := ctx, context.CancelFunc(func() {})
	if dur > 0 {
		tctx, cancel = context.WithTimeout(ctx, dur)
	}
	defer cancel()
	err := dispatch(tctx, hc, cmd, env, in)
	if dur > 0 && tctx.Err() == context.DeadlineExceeded && ctx.Err() == nil && bud.limit == "" {
		if verbose {
			fmt.Fprintf(hc.Stderr, "timeout: sending signal TERM to command ‘%s’\n", cmd[0])
		}
		_ = kill
		if preserve {
			return interp.ExitStatus(143)
		}
		return interp.ExitStatus(124)
	}
	return err
}

func cmdEnv(ctx context.Context, hc interp.HandlerContext, args, env []string, in []byte) error {
	cur := append([]string(nil), env...)
	i := 0
loop:
	for ; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "-i" || a == "-" || a == "--ignore-environment":
			cur = nil
		case a == "-u" || a == "--unset":
			i++
			if i < len(args) {
				cur = withoutVar(cur, args[i])
			}
		case strings.HasPrefix(a, "--unset="):
			cur = withoutVar(cur, strings.TrimPrefix(a, "--unset="))
		case a == "--":
			i++
			break loop
		case strings.HasPrefix(a, "-") && len(a) > 1 && !strings.Contains(a, "="):
			fmt.Fprintf(hc.Stderr, "env: invalid option -- '%s'\nTry 'env --help' for more information.\n", strings.TrimLeft(a, "-"))
			return interp.ExitStatus(125)
		case strings.Contains(a, "="):
			k, _, _ := strings.Cut(a, "=")
			cur = append(withoutVar(cur, k), a)
		default:
			break loop
		}
	}
	if i >= len(args) {
		for _, kv := range cur {
			fmt.Fprintln(hc.Stdout, kv)
		}
		return nil
	}
	return dispatch(ctx, hc, args[i:], cur, in)
}

func withoutVar(env []string, name string) []string {
	out := make([]string, 0, len(env))
	for _, kv := range env {
		if k, _, _ := strings.Cut(kv, "="); k != name {
			out = append(out, kv)
		}
	}
	return out
}

func cmdPrintenv(hc interp.HandlerContext, args, env []string) error {
	if len(args) == 0 {
		for _, kv := range env {
			fmt.Fprintln(hc.Stdout, kv)
		}
		return nil
	}
	code := 0
	for _, name := range args {
		found := false
		for _, kv := range env {
			if k, v, _ := strings.Cut(kv, "="); k == name {
				fmt.Fprintln(hc.Stdout, v)
				found = true
			}
		}
		if !found {
			code = 1
		}
	}
	if code != 0 {
		return interp.ExitStatus(code)
	}
	return nil
}

// ── files ───────────────────────────────────────────────────────────────────────────────────────────────────────────

type memFile struct{ *bytes.Reader }

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
	if job.Limits.OutBytes > 0 && int64(o.buf.Len()+len(p)) > 4*job.Limits.OutBytes {
		trip("output")
		return 0, io.ErrClosedPipe
	}
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

// zeroFile is /dev/zero: it never ends, so whatever reads it whole stops at the output limit.
type zeroFile struct{}

func (zeroFile) Read(p []byte) (int, error) { clear(p); return len(p), nil }
func (zeroFile) Write(p []byte) (int, error) { return len(p), nil }
func (zeroFile) Close() error                { return nil }

func openHandler(ctx context.Context, p string, flag int, perm os.FileMode) (io.ReadWriteCloser, error) {
	hc := interp.HandlerCtx(ctx)
	if p != "" && !path.IsAbs(p) {
		p = path.Join(hc.Dir, p)
	}
	p = path.Clean(p)
	switch p {
	case "/dev/null":
		return nullFile{}, nil
	case "/dev/zero":
		return zeroFile{}, nil
	case "/dev/stdout":
		return struct {
			io.Reader
			io.Writer
			io.Closer
		}{nullFile{}, hc.Stdout, nullFile{}}, nil
	case "/dev/stderr":
		return struct {
			io.Reader
			io.Writer
			io.Closer
		}{nullFile{}, hc.Stderr, nullFile{}}, nil
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
