-- Seed generated from jadid_index_rubric_v0.3.xlsx (Types, Points, Settings sheets).
-- Re-run the generator after changing the workbook; do not edit points by hand.

insert into categories (code, name, yearly_cap) values
  ('scientific', 'Scientific', 100),
  ('innovation', 'Innovation', 100),
  ('social', 'Social', 100),
  ('personal_growth', 'Personal growth', 100);

insert into achievement_types (id, category_code, name, base_points, has_placement, proof_hint) values
  (1, 'scientific', 'Journal article', 12, false, 'DOI or journal page; check the journal''s index or list for its tier.'),
  (2, 'scientific', 'Conference paper or abstract', 5, false, 'Programme or proceedings page, or participation certificate.'),
  (3, 'scientific', 'Olympiad or academic competition', 4, true, 'Official results page; diploma or certificate number.'),
  (4, 'innovation', 'Patent (invention, utility model, industrial design)', 20, false, 'Patent number in the official registry.'),
  (5, 'innovation', 'Software or database registration certificate', 8, false, 'Certificate number in the official registry.'),
  (6, 'innovation', 'Startup project with a working product', 6, false, 'Reviewer-confirmed working product; program acceptance letter if any.'),
  (7, 'innovation', 'Grant received', 8, false, 'Award letter or the grantor''s official page.'),
  (8, 'innovation', 'Hackathon', 3, true, 'Organizer''s results page or certificate.'),
  (9, 'social', 'Volunteering (per certificate)', 2, false, 'Certificate from the organization.'),
  (10, 'social', 'Leading a student project or club', 5, false, 'Confirmation from the university or organization.'),
  (11, 'personal_growth', 'Professional course certificate', 1, false, 'Certificate number or verification link.'),
  (12, 'personal_growth', 'Book challenge (per book)', 2, false, 'Short written summary of the book.');

insert into rubric_points (type_id, level, result, points) values
  (1, 'university', 'confirmed', 12),
  (1, 'national', 'confirmed', 24),
  (1, 'international', 'confirmed', 48),
  (2, 'university', 'confirmed', 5),
  (2, 'national', 'confirmed', 10),
  (2, 'international', 'confirmed', 20),
  (3, 'university', 'participant', 2),
  (3, 'university', 'finalist', 4),
  (3, 'university', 'winner', 8),
  (3, 'national', 'participant', 4),
  (3, 'national', 'finalist', 8),
  (3, 'national', 'winner', 16),
  (3, 'international', 'participant', 8),
  (3, 'international', 'finalist', 16),
  (3, 'international', 'winner', 32),
  (4, 'national', 'confirmed', 40),
  (4, 'international', 'confirmed', 80),
  (5, 'national', 'confirmed', 16),
  (6, 'university', 'confirmed', 6),
  (6, 'national', 'confirmed', 12),
  (6, 'international', 'confirmed', 24),
  (7, 'university', 'confirmed', 8),
  (7, 'national', 'confirmed', 16),
  (7, 'international', 'confirmed', 32),
  (8, 'university', 'participant', 2),
  (8, 'university', 'finalist', 3),
  (8, 'university', 'winner', 6),
  (8, 'national', 'participant', 3),
  (8, 'national', 'finalist', 6),
  (8, 'national', 'winner', 12),
  (8, 'international', 'participant', 6),
  (8, 'international', 'finalist', 12),
  (8, 'international', 'winner', 24),
  (9, 'university', 'confirmed', 2),
  (9, 'national', 'confirmed', 4),
  (9, 'international', 'confirmed', 8),
  (10, 'university', 'confirmed', 5),
  (10, 'national', 'confirmed', 10),
  (11, 'university', 'confirmed', 1),
  (11, 'national', 'confirmed', 2),
  (11, 'international', 'confirmed', 4),
  (12, 'university', 'confirmed', 2);

-- Achievements dated before this day are not scored.
-- Decided by the team: 2023-09-01, so 4th-year bachelor students can add their earlier work.
insert into app_settings (key, value) values ('count_from', '2023-09-01');

-- Starter data. Faculty names are as given by the team.
insert into universities (name) values ('International Islamic Academy of Uzbekistan');
insert into faculties (university_id, name) values
  (1, 'Islamic Studies'),
  (1, 'Classical Oriental Philology'),
  (1, 'Islamic Economics and International Relations');

-- Sign-up is limited to verified emails on these domains (exact match).
-- If students or staff use a subdomain (for example student.iiau.uz), add it as its own row.
insert into allowed_email_domains (domain) values ('iiau.uz');
