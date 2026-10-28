-- Security review, 25 Oct. Pilot sign-up is open, so anyone can hold the publishable key and a session.
--
-- 1. Postgres grants EXECUTE on new functions to PUBLIC, and Supabase exposes public functions over /rpc.
--    approve_submission() and reject_submission() take the reviewer id as a parameter, so they must only be
--    callable by the server (secret key = service_role). Until now only RLS on the inner writes stopped a call.
revoke execute on function approve_submission(uuid, uuid, int, level_t, result_t) from public, anon, authenticated;
revoke execute on function reject_submission(uuid, uuid, text) from public, anon, authenticated;
grant execute on function approve_submission(uuid, uuid, int, level_t, result_t) to service_role;
grant execute on function reject_submission(uuid, uuid, text) to service_role;

-- 2. The views were readable with the publishable key and return more than CLAUDE.md rule 5 allows
--    (course, photo_path, ids, students with no approved work). The app reads them on the server with the
--    secret key and returns only the public fields, so the browser roles do not need them.
revoke select on leaderboard, leaderboard_by_year, public_works from anon, authenticated;
