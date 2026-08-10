#!/usr/bin/env bash
# Launch the kb MCP server.
#
# libggml-metal asserts on a non-empty residency set in its static destructor
# (ggml-org/llama.cpp#22593) and aborts at exit once embedding has run. The
# variable is read by libc getenv at module load, so it must be set before the
# process starts — assigning it inside server.ts is too late.
export GGML_METAL_NO_RESIDENCY="${GGML_METAL_NO_RESIDENCY:-1}"
exec bun "$(dirname "$0")/server.ts" "$@"
