// Copyright 2026 Kirill Scherba. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Command anytext-goals is the goals module of AnyText: what a person is trying to achieve, and the
// deeds that move it forward.
//
// The module owns nothing that belongs to the installation. Goals live in the installation's memory
// (memory_goal_* through the MCP gateway): the agent writes them there, and a person edits the same
// records here. Deeds are the module's own list — short things without a time slot, which change
// every day and would only clutter the memory's semantic search. The agent reaches them through this
// module's MCP tools (deed_add, deed_list, deed_close, deed_update).
package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// version is the module's own version.
const version = "0.1.5"

func main() {
	addr := flag.String("addr", "127.0.0.1:7880", "address to listen on (loopback only)")
	install := flag.String("install", "", "installation address (default: ANYTEXT_SELF or http://127.0.0.1:7787)")
	flag.Parse()

	self := strings.TrimRight(strings.TrimSpace(*install), "/")
	if self == "" {
		self = strings.TrimRight(os.Getenv("ANYTEXT_SELF"), "/")
	}
	if self == "" {
		self = "http://127.0.0.1:7787"
	}
	// The MCP gateway is the installation's business: a module that guesses 127.0.0.1:7711 works on one
	// machine only (docs/MODULES.md).
	proxy := strings.TrimRight(strings.TrimSpace(os.Getenv("ANYTEXT_MCP_PROXY")), "/")
	if proxy == "" {
		proxy = "http://127.0.0.1:7711"
	}
	settings := strings.TrimSpace(os.Getenv("ANYTEXT_MODULE_SETTINGS"))
	if settings == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			home = "."
		}
		settings = filepath.Join(home, ".config", "teonet", "anytext", "module-settings", "goals")
	}

	a := &app{
		gateway:  proxy,
		server:   "memory-store-mcp",
		deeds:    newDeedStore(filepath.Join(settings, "deeds.json")),
		settings: settings,
	}
	log.Printf("anytext-goals %s: %s, installation %s, gateway %s, deeds %s",
		version, *addr, self, proxy, a.deeds.path)
	log.Fatal(http.ListenAndServe(*addr, a.routes()))
}
