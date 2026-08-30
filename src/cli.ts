#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { ForgeToolPackagesClient } from './client.js';
import { validateManifest } from './manifest.js';
import type { DeploymentEnvironment, ToolPackageManifest } from './types.js';

type Command = string;

const args = process.argv.slice(2);
const command = (args.shift() ?? 'help') as Command;

run(command, args).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function run(commandName: Command, commandArgs: string[]) {
  if (commandName === 'help' || commandName === '--help' || commandName === '-h') {
    printHelp();
    return;
  }

  const flags = parseFlags(commandArgs);
  if (commandName === 'validate') {
    const manifest = await readManifest(flags.manifest ?? 'tool-package.json');
    const validation = validateManifest(manifest);
    if (validation.valid) {
      console.log('Manifest is valid.');
      if (validation.warnings.length) console.log(JSON.stringify({ warnings: validation.warnings }, null, 2));
      return;
    }
    console.error(JSON.stringify({ errors: validation.errors, warnings: validation.warnings }, null, 2));
    process.exitCode = 1;
    return;
  }

  const client = createClient(flags);
  if (commandName === 'submit') {
    const response = await client.submitPackage(required(flags.packageId, '--package-id'));
    console.log(JSON.stringify(response, null, 2));
    return;
  }
  if (commandName === 'create-version') {
    const manifest = (await readManifest(flags.manifest ?? 'tool-package.json')) as ToolPackageManifest;
    const response = await client.createVersion(required(flags.packageId, '--package-id'), {
      artifactRef: flags.artifactRef ?? null,
      commitSha: flags.commitSha ?? null,
      environment: environment(flags.environment ?? 'DEVELOPMENT'),
      manifest,
      version: flags.version ?? manifest.version,
    });
    console.log(JSON.stringify(response, null, 2));
    return;
  }
  if (commandName === 'validate-version') {
    const response = await client.validateVersion(required(flags.versionId, '--version-id'));
    console.log(JSON.stringify(response, null, 2));
    return;
  }
  if (commandName === 'deploy-version') {
    const response = await client.deployVersion(
      required(flags.versionId, '--version-id'),
      environment(required(flags.environment, '--environment')),
      flags.reason,
    );
    console.log(JSON.stringify(response, null, 2));
    return;
  }
  throw new Error(`Unknown command: ${commandName}`);
}

async function readManifest(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

function createClient(flags: Record<string, string | undefined>) {
  return new ForgeToolPackagesClient({
    apiKey: required(flags.apiKey ?? process.env.FORGE_API_KEY, '--api-key or FORGE_API_KEY'),
    baseUrl: flags.baseUrl ?? process.env.FORGE_API_URL ?? 'http://localhost:4000/v1',
  });
}

function parseFlags(values: string[]) {
  const flags: Record<string, string | undefined> = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token?.startsWith('--')) continue;
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    const next = values[index + 1];
    if (!next || next.startsWith('--')) {
      flags[key] = 'true';
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return flags;
}

function required(value: string | undefined, flag: string) {
  if (!value) throw new Error(`${flag} is required.`);
  return value;
}

function environment(value: string): DeploymentEnvironment {
  if (value === 'DEVELOPMENT' || value === 'STAGING' || value === 'PRODUCTION') return value;
  throw new Error(`Unsupported environment: ${value}`);
}

function printHelp() {
  console.log(`Arveniq Forge SDK CLI

Usage:
  forge-tool validate --manifest tool-package.json
  forge-tool submit --package-id pkg_123
  forge-tool create-version --package-id pkg_123 --manifest tool-package.json --version 1.0.0 --commit-sha abc123
  forge-tool validate-version --version-id version_123
  forge-tool deploy-version --version-id version_123 --environment STAGING --reason "Release candidate"

Global flags:
  --base-url     Forge API base URL. Defaults to FORGE_API_URL or http://localhost:4000/v1.
  --api-key      Required scoped Forge API key. Defaults to FORGE_API_KEY.
`);
}
