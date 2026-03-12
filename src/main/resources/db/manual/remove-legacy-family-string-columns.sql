-- Run this manually only after verifying every user/resource/attendance/event/announcement
-- row has the corresponding *_id fields populated and the application has been running on ids.

-- Optional safety checks
-- select count(*) from users where deacon_family_id is null and coalesce(deacon_family, '') <> 'SYSTEM';
-- select count(*) from attendance_records where family_base is not null and family_id is null;
-- select count(*) from grade_sheets where family_base is not null and family_id is null;
-- select count(*) from resource_files where family <> 'ALL' and family_id is null;
-- select count(*) from announcements where target_family <> 'ALL' and target_family_id is null;
-- select count(*) from events where target_family <> 'ALL' and target_family_id is null;

-- 1) Keep only id-based references and drop legacy text family columns.
alter table users
    drop column deacon_family,
    drop column deacon_family2,
    drop column deacon_family3,
    drop column deacon_family4;

alter table attendance_records
    drop column family_base;

alter table grade_sheets
    drop column family_base;

alter table resource_files
    drop column family;

alter table announcements
    drop column target_family;

alter table events
    drop column target_family;

-- 2) Optional hardening: enforce not-null where ids are required.
-- alter table users modify deacon_family_id bigint not null;
-- alter table grade_sheets modify family_id bigint not null;
