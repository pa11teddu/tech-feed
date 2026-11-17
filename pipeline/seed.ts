import { createServiceSupabase } from "@/lib/db";
import { EnvError, loadPipelineEnv } from "@/lib/env";
import { Fetcher } from "./fetcher";
import { loadLocalEnv } from "./load-env";
import { PHASE1_SOURCES } from "./sources.seed";
import { formatVerificationTable, verifySources } from "./verify-sources";

/**
 * `npm run sources:verify`  fetch + parse every Phase 1 source and print a table.
 * `npm run seed`            verify, then upsert passing sources and OWNER_EMAIL.
 */
async function main(): Promise<number> {
  loadLocalEnv();
  const verifyOnly = process.argv.includes("--verify-only");

  const checks = await verifySources(PHASE1_SOURCES, new Fetcher());
  console.log("\nSource verification\n");
  console.log(formatVerificationTable(checks));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} sources parse.`);
  if (verifyOnly) return failed.length === 0 ? 0 : 1;

  const env = loadPipelineEnv({ db: true, llm: false });
  const db = createServiceSupabase(env.SUPABASE_URL ?? "", env.SUPABASE_SERVICE_ROLE_KEY ?? "");
  const passing = checks.filter((c) => c.ok).map((c) => c.source);
  const { error } = await db.from("sources").upsert(passing, { onConflict: "url" });
  if (error) throw new Error(`seeding sources failed: ${error.message}`);
  console.log(`Seeded ${passing.length} sources (skipped ${failed.length} failing).`);

  if (env.OWNER_EMAIL) {
    const owner = await db.from("app_owner").upsert({ email: env.OWNER_EMAIL.toLowerCase() });
    if (owner.error) throw new Error(`seeding app_owner failed: ${owner.error.message}`);
    console.log(`app_owner set to ${env.OWNER_EMAIL.toLowerCase()}.`);
  } else {
    console.log("OWNER_EMAIL not set; app_owner unchanged.");
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof EnvError ? err.message : err);
    process.exit(1);
  },
);
