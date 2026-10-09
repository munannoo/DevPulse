// Keep this guard compatible with old Node so setup failures stay understandable.
var parts = process.versions.node.split('.').map(Number);
var supported = (parts[0] === 20 && parts[1] >= 19) || (parts[0] === 22 && parts[1] >= 13) || parts[0] >= 24;
if (!supported) {
  console.error('DevPulse build tools require Node 20.19+, 22.13+, or 24+. Detected Node ' + process.versions.node + '. Update Node on PATH and restart your terminal/VS Code. F5 can use VS Code\'s bundled runtime.');
  process.exit(1);
}
