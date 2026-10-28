// Demo data for the pilot: a handful of TEST students, a TEST reviewer and submissions in several academic
// years, created through the same server-side functions the API routes use (src/lib/db.ts and
// src/lib/submissions.ts), so it also exercises the SQL functions.
//
//   npm run seed:demo            create (removes earlier demo data first)
//   npm run seed:demo -- --clean remove all test data (every test-...@example.invalid user)
//   add --force to run when NODE_ENV=production
//
// Approvals go straight to approve_submission(), not through the app, so a running app shows them on the
// leaderboard after its cache refreshes (about 30 seconds).

import { approveSubmission, rejectSubmission } from "@/lib/db";
import { todayInTashkent } from "@/lib/validation";

import {
  cleanTestData,
  createTestReviewer,
  createTestStudent,
  fields,
  rubricChoices,
  samplePdf,
  submitThroughApiPath,
  type RubricChoice,
} from "./lib/test-data";

const args = new Set(process.argv.slice(2));

if (process.env.NODE_ENV === "production" && !args.has("--force")) {
  console.error("Refusing to run with NODE_ENV=production. Pass --force if you really mean it.");
  process.exit(1);
}

const STUDENTS = [
  "Aziza Karimova",
  "Bobur Rahimov",
  "Dilnoza Yusupova",
  "Jasur Tursunov",
  "Malika Saidova",
];

// [student index, rubric pick, date, outcome]. Dates span the current and two earlier academic years.
const today = todayInTashkent();
const PLAN: [number, number, string, "approve" | "reject" | "pending"][] = [
  [0, 0, "2026-09-20", "approve"],
  [0, 5, "2025-11-12", "approve"],
  [0, 9, "2024-12-03", "approve"],
  [1, 2, "2026-10-01", "approve"],
  [1, 7, "2025-03-15", "approve"],
  [2, 4, "2026-09-10", "approve"],
  [2, 1, "2025-05-20", "reject"],
  [3, 3, "2025-10-05", "approve"],
  [3, 6, today, "pending"],
  [4, 8, "2024-10-18", "approve"],
  [4, 0, "2026-10-10", "pending"],
];

async function seed() {
  const removed = await cleanTestData();
  if (removed) console.log(`removed ${removed} earlier test users`);

  const { rows } = await rubricChoices();
  // One choice per type, so the demo shows a mix of achievement types.
  const byType = new Map<number, RubricChoice>();
  for (const r of rows) if (!byType.has(r.type_id) || r.points > byType.get(r.type_id)!.points) byType.set(r.type_id, r);
  const picks = [...byType.values()];

  const reviewer = await createTestReviewer("reviewer", "Sinov Tekshiruvchi");
  console.log(`reviewer  ${reviewer.email}  password: ${reviewer.password}`);

  const students = [];
  for (const [i, name] of STUDENTS.entries()) {
    const student = await createTestStudent(String(i + 1), name, (i % 4) + 1);
    students.push(student);
    console.log(`student   ${student.email}  password: ${student.password}`);
  }

  for (const [n, [s, pick, date, outcome]] of PLAN.entries()) {
    const choice = picks[pick % picks.length];
    const title = `[TEST] ${choice.type_name} ${n + 1}`;
    const { issued, created } = await submitThroughApiPath(
      students[s].id,
      fields({
        type_id: choice.type_id,
        level: choice.level,
        result: choice.result,
        achievement_date: date,
        title,
        certificate_ref: `TEST-${n + 1}`,
      }),
      { bytes: samplePdf(`${title} ${date}`), name: `test-${n + 1}.pdf`, contentType: "application/pdf" },
    );
    if (!issued.ok) throw new Error(`upload-url refused: ${issued.code}`);
    if (!created?.ok) throw new Error(`submission refused: ${created?.code}`);

    if (outcome === "approve") {
      const res = await approveSubmission(created.id, reviewer.id, choice.type_id, choice.level, choice.result);
      if (!res.ok) throw new Error(`approve failed: ${res.message}`);
      console.log(`approved  ${title} (${date}): ${res.points_awarded} of ${res.rubric_points} points`);
    } else if (outcome === "reject") {
      const res = await rejectSubmission(created.id, reviewer.id, "TEST: hujjatda ism koʻrinmaydi.");
      if (!res.ok) throw new Error(`reject failed: ${res.message}`);
      console.log(`rejected  ${title} (${date})`);
    } else {
      console.log(`pending   ${title} (${date})`);
    }
  }
  console.log("done. Remove with: npm run seed:demo -- --clean");
}

async function main() {
  if (args.has("--clean")) {
    console.log(`removed ${await cleanTestData()} test users and their data`);
    return;
  }
  await seed();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
