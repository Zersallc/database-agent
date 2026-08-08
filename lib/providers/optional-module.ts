/**
 * Loads a cloud SDK that may not be installed.
 *
 * Every cloud driver in this directory is optional. A deployment that runs on
 * Google Cloud installs the Google packages; one that runs on AWS installs the
 * AWS ones; a laptop running `npm run dev` installs neither and uses the memory
 * drivers. Making them hard dependencies would force every install to carry
 * every cloud's SDK, which is both slow and wrong.
 *
 * The `new Function` wrapper is deliberate: a bare `await import(specifier)`
 * with a non-literal specifier still gets picked up by the bundler, which then
 * tries to resolve packages that aren't installed and fails the build. Hiding
 * the import from static analysis keeps resolution where it belongs — at
 * runtime, on the machine that actually has the package.
 */

const runtimeImport = new Function("specifier", "return import(specifier)") as (
  specifier: string
) => Promise<Record<string, unknown>>;

export class MissingModuleError extends Error {
  constructor(
    readonly moduleName: string,
    readonly reason: string
  ) {
    super(
      `The '${moduleName}' package is required for ${reason} but is not installed. Run: npm install ${moduleName}`
    );
    this.name = "MissingModuleError";
  }
}

export async function optionalModule(
  moduleName: string,
  reason: string
): Promise<Record<string, unknown>> {
  try {
    return await runtimeImport(moduleName);
  } catch {
    throw new MissingModuleError(moduleName, reason);
  }
}
