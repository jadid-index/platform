// Deletes uploaded-CV objects that are not some student's current file (src/lib/cv-file.ts, cleanupCvUploads()):
// uploads never finalized within an hour, files whose delete failed earlier, and files of deleted accounts.
// Safe to run at any time and repeatedly. The same job is the "Clean up" button on /admin/users
// (POST /api/admin/cv-files/cleanup).
//   npm run cleanup:cv-uploads
//   npm run cleanup:cv-uploads -- --minutes 120   (only pending uploads older than 120 minutes)
import { cleanupCvUploads, CV_UPLOAD_STALE_MINUTES } from "@/lib/cv-file";

const i = process.argv.indexOf("--minutes");
const minutes = i > 0 ? Number(process.argv[i + 1]) : CV_UPLOAD_STALE_MINUTES;
if (!Number.isInteger(minutes) || minutes < CV_UPLOAD_STALE_MINUTES) {
  console.error(`--minutes must be a whole number of at least ${CV_UPLOAD_STALE_MINUTES}`);
  process.exit(1);
}

cleanupCvUploads(minutes)
  .then((removed) => console.log(`Removed ${removed} CV object(s).`))
  .catch((error: unknown) => {
    console.error("cleanup failed", error instanceof Error ? error.message : error);
    process.exit(1);
  });
