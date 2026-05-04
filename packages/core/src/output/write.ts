export type OutputWriter = Pick<NodeJS.WriteStream, 'write'> & {
  /** Optional — used by handlers that switch behavior on TTY vs piped/redirected stdout. */
  isTTY?: boolean;
};

export function writeLine(writer: OutputWriter, contents: string): void {
  writer.write(contents.endsWith('\n') ? contents : `${contents}\n`);
}
