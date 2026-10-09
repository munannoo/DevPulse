// CLI scaffold only. Hook installation and review are not implemented yet.
const command = process.argv[2];

if (!command || command === '--help' || command === '-h') {
  console.log('DevPulse CLI scaffold\nPlanned commands: init, precommit, ping');
} else {
  console.error(`DevPulse CLI command is not implemented: ${command}`);
  process.exitCode = 1;
}
