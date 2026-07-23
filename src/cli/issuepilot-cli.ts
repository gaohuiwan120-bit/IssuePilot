#!/usr/bin/env node
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadDotEnv, maskSecret } from "../config/load-env.js";
import { resolveModelConfig, ModelConfigError } from "../session/model-config.js";
import {
  IssueOrchestrator,
  loadGoldenFiles,
  prepareWorkCopy,
} from "../session/issue-orchestrator.js";
import { ApprovalService } from "../security/approval.js";
import { defaultStateDir } from "../artifacts/store.js";

function usage(): never {
  console.log(`IssuePilot CLI (MVP)

Usage:
  npm run issuepilot -- run --repo <path> --issue <file.md> [options]
  npm run issuepilot -- status --repo <path> --task <taskId>
  npm run issuepilot -- approve --repo <path> --task <taskId> --yes|--no
  npm run issuepilot -- artifacts --repo <path> --task <taskId>

Options for run:
  --provider mock|deepseek   (default: mock or ISSUEPILOT_PROVIDER)
  --model <id>
  --dry-run                  Stop before checkpoint/patch
  --allow-patch              Allow checkpoint+patch (default: false)
  --approve                  Auto-approve RepairPlan
  --task <id>
  --image <docker-image>
  --golden-fixed <dir>       Map golden fixed files into patch (fixture E2E)
  --work-copy <dir>          Copy --repo into work-copy first (protect fixtures)
  --repro-cmd <json>         JSON argv list, e.g. '[["node","test/x.js"]]'
  --expect-fail <json>       expectedFailure JSON
  --test-cmd <json>          testCommands JSON

Safety defaults: no patch, no commit, no push, no real PR, mock provider.
`);
  process.exit(1);
}

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  return args[i + 1];
}

function has(args: string[], name: string): boolean {
  return args.includes(name);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (!cmd || cmd === "-h" || cmd === "--help") usage();

  loadDotEnv(process.cwd());

  if (cmd === "run") {
    const repoArg = arg(args, "--repo");
    const issueFile = arg(args, "--issue");
    if (!repoArg || !issueFile) usage();
    let repo = resolve(repoArg);
    const workCopy = arg(args, "--work-copy");
    if (workCopy) {
      const dest = resolve(workCopy);
      prepareWorkCopy(repo, dest);
      repo = dest;
      console.log(`work copy: ${repo}`);
    }
    if (!existsSync(issueFile)) {
      console.error(`issue file not found: ${issueFile}`);
      process.exit(2);
    }
    const body = readFileSync(issueFile, "utf8");
    const provider = arg(args, "--provider") || process.env.ISSUEPILOT_PROVIDER || "mock";
    try {
      const cfg = resolveModelConfig({
        cwd: process.cwd(),
        provider,
        model: arg(args, "--model"),
        requireLiveKey: provider === "deepseek",
      });
      console.log(
        `model: provider=${cfg.provider} model=${cfg.model} key=${cfg.apiKeyPresent ? maskSecret(cfg.apiKey) : "(n/a)"}`,
      );
    } catch (e) {
      if (e instanceof ModelConfigError) {
        console.error(`${e.code}: ${e.message}`);
        process.exit(3);
      }
      throw e;
    }

    const goldenFixed = arg(args, "--golden-fixed");
    const goldenFiles = goldenFixed ? loadGoldenFiles(resolve(goldenFixed), repo) : undefined;
    const reproCmd = arg(args, "--repro-cmd");
    const expectFail = arg(args, "--expect-fail");
    const testCmd = arg(args, "--test-cmd");
    const autoApprove = has(args, "--approve");

    const orchestrator = new IssueOrchestrator({
      taskId: arg(args, "--task"),
      repositoryPath: repo,
      issueBody: body,
      provider,
      model: arg(args, "--model"),
      dryRun: has(args, "--dry-run"),
      allowPatch: has(args, "--allow-patch"),
      autoApprove,
      approvalService: new ApprovalService({
        defaultDenyHigh: true,
        resolver: autoApprove ? async () => "approved" : undefined,
      }),
      goldenFiles,
      image: arg(args, "--image"),
      reproduceCommands: reproCmd ? JSON.parse(reproCmd) : undefined,
      expectedFailure: expectFail ? JSON.parse(expectFail) : undefined,
      testCommands: testCmd ? JSON.parse(testCmd) : undefined,
      skipDockerAvailabilityCheck: has(args, "--skip-docker-check"),
    });

    const onSig = () => {
      orchestrator.interrupt("SIGINT");
      console.error("interrupted — state preserved");
    };
    process.on("SIGINT", onSig);

    const result = await orchestrator.run();
    process.off("SIGINT", onSig);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success || result.stage === "approve" || has(args, "--dry-run") ? 0 : 1);
  }

  if (cmd === "status") {
    const repo = resolve(arg(args, "--repo") || process.cwd());
    const taskId = arg(args, "--task");
    if (!taskId) usage();
    const p = join(defaultStateDir(repo), "tasks", `${taskId}.json`);
    if (!existsSync(p)) {
      console.error(`state not found: ${p}`);
      process.exit(2);
    }
    console.log(readFileSync(p, "utf8"));
    return;
  }

  if (cmd === "approve") {
    const repo = resolve(arg(args, "--repo") || process.cwd());
    const taskId = arg(args, "--task");
    if (!taskId) usage();
    const yes = has(args, "--yes");
    const no = has(args, "--no");
    if (!yes && !no) usage();
    const dir = join(defaultStateDir(repo), "tasks");
    mkdirSync(dir, { recursive: true });
    const decisionPath = join(dir, `${taskId}.approval-decision.json`);
    writeFileSync(
      decisionPath,
      JSON.stringify({ taskId, approved: yes, at: new Date().toISOString() }, null, 2),
    );
    console.log(`wrote ${decisionPath}`);
    return;
  }

  if (cmd === "artifacts") {
    const repo = resolve(arg(args, "--repo") || process.cwd());
    const taskId = arg(args, "--task");
    if (!taskId) usage();
    const out = join(repo, "outputs", taskId);
    console.log(out);
    return;
  }

  usage();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
