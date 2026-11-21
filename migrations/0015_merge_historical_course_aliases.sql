-- Only the seven confirmed historical code pairs participate in this merge.
CREATE TABLE _confirmed_course_merges (old_id INTEGER PRIMARY KEY, course_id INTEGER NOT NULL);
INSERT INTO _confirmed_course_merges
SELECT old.id, canonical.id
FROM json_each('[["als","4-59"],["bysw","4-58"],["gszw","4-73"],["rcrt","4-64"],["xdrt","4-68"],["yswh","4-40"],["yyxxgl","4-72"]]') pair
JOIN courses old ON old.code=json_extract(pair.value,'$[0]')
JOIN courses canonical ON canonical.code=json_extract(pair.value,'$[1]') AND canonical.name=old.name;

UPDATE course_catalog_records SET course_id=(SELECT course_id FROM _confirmed_course_merges WHERE old_id=course_catalog_records.course_id)
WHERE course_id IN (SELECT old_id FROM _confirmed_course_merges);
UPDATE course_materials SET course_id=(SELECT course_id FROM _confirmed_course_merges WHERE old_id=course_materials.course_id)
WHERE course_id IN (SELECT old_id FROM _confirmed_course_merges);
UPDATE course_reviews SET course_id=(SELECT course_id FROM _confirmed_course_merges WHERE old_id=course_reviews.course_id)
WHERE course_id IN (SELECT old_id FROM _confirmed_course_merges);
UPDATE course_supplements SET course_id=(SELECT course_id FROM _confirmed_course_merges WHERE old_id=course_supplements.course_id)
WHERE course_id IN (SELECT old_id FROM _confirmed_course_merges);
UPDATE course_offerings SET course_id=(SELECT course_id FROM _confirmed_course_merges WHERE old_id=course_offerings.course_id)
WHERE course_id IN (SELECT old_id FROM _confirmed_course_merges);
UPDATE elective_course_facts SET course_id=(SELECT course_id FROM _confirmed_course_merges WHERE old_id=elective_course_facts.course_id)
WHERE course_id IN (SELECT old_id FROM _confirmed_course_merges);
UPDATE elective_course_offerings SET course_id=(SELECT course_id FROM _confirmed_course_merges WHERE old_id=elective_course_offerings.course_id)
WHERE course_id IN (SELECT old_id FROM _confirmed_course_merges);
UPDATE elective_credit_rules SET course_id=(SELECT course_id FROM _confirmed_course_merges WHERE old_id=elective_credit_rules.course_id)
WHERE course_id IN (SELECT old_id FROM _confirmed_course_merges);

INSERT INTO traffic_daily(day,page,target_id,views)
SELECT t.day,t.page,m.course_id,sum(t.views)
FROM traffic_daily t JOIN _confirmed_course_merges m ON m.old_id=t.target_id
WHERE t.page='course' GROUP BY t.day,t.page,m.course_id
ON CONFLICT(day,page,target_id) DO UPDATE SET views=views+excluded.views;
DELETE FROM traffic_daily WHERE page='course' AND target_id IN (SELECT old_id FROM _confirmed_course_merges);
UPDATE courses SET is_listed=0 WHERE id IN (SELECT old_id FROM _confirmed_course_merges);
DROP TABLE _confirmed_course_merges;
