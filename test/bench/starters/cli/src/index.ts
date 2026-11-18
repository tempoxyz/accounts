const [command, ...args] = process.argv.slice(2)

switch (command) {
  case 'hello':
    console.log(`Hello, ${args[0] ?? 'world'}.`)
    break
  default:
    console.log(
      'Usage: acme <command>\n\nCommands:\n  hello [name]  Print a greeting',
    )
    process.exitCode = command ? 1 : 0
}
