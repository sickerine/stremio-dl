declare module "*.css" {
  const content: string;
  export default content;
}

declare module "*.js" {
  const content: string;
  export default content;
}

declare namespace Bun {
  function spawn(cmd: string[], options?: { stdio?: Array<"ignore" | "pipe" | "inherit">; detached?: boolean }): { unref(): void };
}
