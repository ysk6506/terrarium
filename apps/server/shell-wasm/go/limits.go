//go:build wasip1

package main

import (
	"bytes"
	"errors"
	"io"
	"runtime"
	"runtime/debug"

	awk "github.com/benhoyt/goawk/interp"
	"mvdan.cc/sh/v3/interp"
)

// bud is what the line has used. Every limit counts something the module does itself, never the time the machine takes,
// so a line that runs away stops at the same statement, with the same writes done, wherever it runs (ADR-0196 2-가).
var bud struct {
	steps, out int64
	limit      string // "steps" | "output" | "memory" | "time" | "expansion": the first limit that stopped the line
	peakHeap   int64
	memEvery   int64
	expanded   int64
}

// errLimit stops the shell. It is a plain error on purpose: a limit is not an exit status the script may look at.
var errLimit = errors.New("a limit of the simulation was reached")

func trip(kind string) error {
	if bud.limit == "" {
		bud.limit = kind
	}
	return errLimit
}

func setupLimits() {
	bud.memEvery = 64
	// the collector keeps the heap near what the line needs, so that the memory limit counts live data
	debug.SetGCPercent(25)
	interp.StepHook = stepHook
	awk.StepHook = stepHook
}

// stepHook runs before every statement of the shell and at every turn of every loop of awk.
func stepHook() error {
	if bud.limit != "" {
		return errLimit
	}
	bud.steps++
	if job.Limits.Steps > 0 && bud.steps > job.Limits.Steps {
		return trip("steps")
	}
	if bud.steps%bud.memEvery == 0 {
		return checkMemory()
	}
	return nil
}

// checkMemory counts the live heap. Sampling every 64 steps costs almost nothing; once the heap is a good part of the
// limit every step is looked at, so a line that doubles a string cannot jump past it.
func checkMemory() error {
	if job.Limits.MemBytes <= 0 {
		return nil
	}
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	heap := int64(ms.HeapAlloc)
	if heap > job.Limits.MemBytes {
		runtime.GC()
		runtime.ReadMemStats(&ms)
		heap = int64(ms.HeapAlloc)
	}
	if heap > bud.peakHeap {
		bud.peakHeap = heap
	}
	if heap > job.Limits.MemBytes {
		return trip("memory")
	}
	if heap > job.Limits.MemBytes/8 {
		bud.memEvery = 1
	}
	return nil
}

// limitWriter counts what a stream carries and refuses more once the output limit is spent.
type limitWriter struct{ w *bytes.Buffer }

func (l limitWriter) Write(p []byte) (int, error) {
	if job.Limits.OutBytes > 0 && bud.out+int64(len(p)) > job.Limits.OutBytes {
		keep := job.Limits.OutBytes - bud.out
		if keep > 0 {
			l.w.Write(p[:keep]) // what fits is kept: the cut is at the same byte everywhere
			bud.out += keep
		}
		return 0, trip("output")
	}
	bud.out += int64(len(p))
	return l.w.Write(p)
}

// countedGlob counts the entries the line asked the host to list (the expansion of a glob can only be as big as that).
func countedGlob(n int) error {
	bud.expanded += int64(n)
	if job.Limits.Expansions > 0 && bud.expanded > job.Limits.Expansions {
		return trip("expansion")
	}
	return nil
}

var _ io.Writer = limitWriter{}
