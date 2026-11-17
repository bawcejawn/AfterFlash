// Adds koilib_types (protobuf JSON with original snake_case field names) to the ABI
// so koilib clients can use the same field names as the .proto file.
const fs = require('fs');
const path = require('path');
const protobuf = require('protobufjs');
const dir = __dirname;
const root = new protobuf.Root();
root.resolvePath = (origin, target) => {
  for (const base of [dir, path.join(dir, 'assembly/proto')]) {
    const p = path.join(base, target);
    if (fs.existsSync(p)) return p;
  }
  return target;
};
root.loadSync('assembly/proto/photoshare.proto', { keepCase: true });
const abi = JSON.parse(fs.readFileSync(path.join(dir, 'abi/photoshare-abi.json'), 'utf8'));
abi.koilib_types = root.toJSON();
// Normalise methods to the format koilib and Koinos explorers read
// (entry_point / argument / return / read_only), keeping the generator's keys too.
for (const m of Object.values(abi.methods)) {
  m.entry_point = m.entryPoint;
  m.argument = m.input;
  m.return = m.output;
  m.read_only = !!m.readOnly;
}
fs.writeFileSync(path.join(dir, 'abi/photoshare-abi.json'), JSON.stringify(abi, null, 2) + '\n');
console.log('abi with koilib_types written');
