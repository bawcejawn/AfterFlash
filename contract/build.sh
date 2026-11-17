#!/usr/bin/env bash
# Builds the PhotoShare Koinos contract without yarn.
#   ./build.sh          → build/release/contract.wasm + abi/photoshare-abi.json
#   ./build.sh --test   → also build/test/contract.wasm (start function exported for the mock VM)
set -euo pipefail
cd "$(dirname "$0")"
BIN=./node_modules/.bin
export PATH="$PWD/node_modules/.bin:$PATH"
PROTO=assembly/proto/photoshare.proto

# The protoc plugins read stdin with Node; on some CI runners that read can fail
# transiently with EAGAIN. Retry a few times before giving up.
retry() { local n=0; until "$@"; do n=$((n+1)); [[ $n -ge 4 ]] && return 1; echo "  retrying ($n)…"; sleep 2; done; }

echo "• ABI"
retry $BIN/protoc --plugin=protoc-gen-abi=./tools/koinos-abi-proto-gen --abi_out=abi/ $PROTO
node make-abi.cjs

echo "• AssemblyScript protobuf bindings"
retry $BIN/protoc --plugin=protoc-gen-as=./tools/as-proto-gen --as_out=. $PROTO
retry $BIN/protoc --plugin=protoc-gen-as=./tools/koinos-as-gen --as_out=assembly/ $PROTO

# Keepsake arguments/results are up to 48 KiB; the SDK's default system-call buffer is 1 KiB.
grep -q "setSystemBufferSize" assembly/index.ts || \
  sed -i.bak 's/^\(\s*\)const contractArgs = System.getArguments();/\1System.setSystemBufferSize(131072);\n\1const contractArgs = System.getArguments();/' assembly/index.ts
rm -f assembly/index.ts.bak
grep -q "setSystemBufferSize" assembly/index.ts || { echo "failed to patch index.ts"; exit 1; }

echo "• Compile"
ASC="node ./node_modules/assemblyscript/bin/asc assembly/index.ts --target release --use abort= --use BUILD_FOR_TESTING=0 --disable sign-extension --config asconfig.json"
mkdir -p build/release
$ASC --outFile build/release/contract.wasm
if [[ "${1:-}" == "--test" ]]; then
  mkdir -p build/test
  $ASC --exportStart _start --outFile build/test/contract.wasm
fi
(cd build/release && sha256sum contract.wasm | tee contract.wasm.sha256)

echo "• Site ABI module"
node -e "
const a=require('./abi/photoshare-abi.json');
require('fs').writeFileSync('../site/assets/js/photoshare-abi.js','// Generated from contract/assembly/proto/photoshare.proto by contract/build.sh — do not edit.\nexport default '+JSON.stringify({methods:a.methods,koilib_types:a.koilib_types})+';\n');"
